// qualify-leads.js
// For each contact in linkedin_leads, searches for company signals (funding, hiring, size)
// then uses Claude to score 1-5, produce a conversation hook, explain why they were originally
// contacted, and draft a suggested follow-up message.
// Called from the LinkedIn Leads panel "Qualify All" button.

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!CLAUDE_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'CLAUDE_API_KEY not set' }) };

  const db = createClient(SUPA_URL, SUPA_KEY);

  const body = JSON.parse(event.body || '{}');
  const forceRequalify = body.force === true;

  let query = db.from('linkedin_leads')
    .select('id,full_name,title,company,reply_summary,linkedin_url,days_since_reply')
    .order('days_since_reply', { ascending: true })
    .limit(30);

  if (!forceRequalify) {
    query = query.is('qualified_at', null);
  }

  const { data: leads, error } = await query;
  if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  if (!leads || leads.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ qualified: 0, message: 'No leads to qualify' }) };

  let qualified = 0;

  for (const lead of leads) {
    try {
      // 1. Fetch original company signals from Supabase (why we contacted them)
      let originalSignals = '';
      if (lead.company) {
        const { data: signals } = await db
          .from('company_signals')
          .select('signal_type,title,summary,created_at,importance')
          .ilike('company_name', `%${lead.company}%`)
          .order('created_at', { ascending: false })
          .limit(3);

        if (signals && signals.length > 0) {
          originalSignals = signals
            .map(s => `[${s.signal_type || 'Signal'}] ${s.title || ''}: ${(s.summary || '').substring(0, 120)}`)
            .join('\n');
        }
      }

      // 2. Fresh Brave search context
      let searchContext = '';
      if (BRAVE_KEY && lead.company) {
        const searches = await Promise.allSettled([
          braveFetch(`${lead.company} funding investment hiring 2025 2026`, 'news'),
          braveFetch(`${lead.company} jobs open roles hiring`, 'web'),
        ]);
        const snippets = searches
          .filter(r => r.status === 'fulfilled')
          .flatMap(r => r.value.slice(0, 3).map(s => `${s.title}: ${s.description || s.snippet || ''}`))
          .join('\n');
        if (snippets) searchContext = `\n\nFresh search results about ${lead.company}:\n${snippets}`;
      }

      // 3. Ask Claude to qualify + generate outreach_reason + suggested_message
      const prompt = `You are a qualification analyst for Vantage Search Group, a boutique executive search firm in the GCC.

Assess whether this LinkedIn contact is worth pursuing for executive placement mandates.

CONTACT:
- Name: ${lead.full_name}
- Title: ${lead.title || 'Unknown'}
- Company: ${lead.company || 'Unknown'}
- Their reply summary: ${lead.reply_summary || 'No reply yet'}
- Days since reply: ${lead.days_since_reply || 'Unknown'}

ORIGINAL SIGNALS (why Vantage Search Group first reached out to this person):
${originalSignals || 'No historical signals found in database.'}
${searchContext}

Score this contact 1-5 for commercial pursuit priority:
5 = Strong pursue — funded/growing company, hiring actively, senior decision-maker with budget
4 = Good pursue — established company, some hiring signals, warm relationship potential
3 = Nurture — worth staying warm, no immediate opportunity but future potential
2 = Low priority — small/early company, no signals, limited immediate opportunity
1 = Pass — no fit, company too small/inactive, not worth time right now

Return ONLY a JSON object with these exact keys:
{
  "score": <1-5 integer>,
  "label": "Pursue" | "Nurture" | "Pass",
  "notes": "<20-30 word honest assessment of why this score — mention company stage, hiring signals, or lack thereof>",
  "hook": "<20-30 word suggested conversation angle based on what you found — specific, not generic. If Pass, write null>",
  "outreach_reason": "<1-2 sentences explaining the specific signal that originally drove outreach to this person — e.g. 'Company posted 3 senior finance roles in Q1' or 'ADGM registered 2 new entities in their sector'. If no signals found, write null>",
  "suggested_message": "<A short, specific LinkedIn message (60-100 words) to send this warm lead. It must: reference the original signal or fresh finding, acknowledge their reply warmly, and move toward a commercial conversation — asking if they have hiring needs or if they would be open to a brief call. Do NOT use generic openers. If score is 1-2, write null>"
}

No markdown. No explanation outside the JSON.`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          message