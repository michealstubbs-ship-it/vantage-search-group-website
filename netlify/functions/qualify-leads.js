// qualify-leads.js
// For each contact in linkedin_leads, searches for company signals (funding, hiring, size)
// then uses Claude to score 1-5 and produce a conversation hook.
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

  // Fetch all linkedin_leads — qualify all or requalify if requested
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
      // Build search context from Brave if available
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
        if (snippets) searchContext = `\n\nSearch results about ${lead.company}:\n${snippets}`;
      }

      // Ask Claude to score and produce a hook
      const prompt = `You are a qualification analyst for Vantage Search Group, a boutique executive search firm in the GCC.

Assess whether this LinkedIn contact is worth pursuing for executive placement mandates.

CONTACT:
- Name: ${lead.full_name}
- Title: ${lead.title || 'Unknown'}
- Company: ${lead.company || 'Unknown'}
- Their reply summary: ${lead.reply_summary || 'No reply yet'}
- Days since reply: ${lead.days_since_reply || 'Unknown'}
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
  "hook": "<20-30 word suggested conversation hook based on what you found — specific, not generic. If Pass, write null>"
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
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();
      const raw = data.content?.[0]?.text || '';
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      await db.from('linkedin_leads').update({
        qualification_score: parsed.score,
        qualification_notes: parsed.notes || null,
        qualification_hooks: parsed.hook || null,
        qualified_at: new Date().toISOString(),
      }).eq('id', lead.id);

      qualified++;
    } catch (e) {
      console.error(`[qualify-leads] Error qualifying ${lead.full_name}:`, e.message);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ qualified, total: leads.length }),
  };
};

async function braveFetch(query, type = 'news') {
  try {
    const endpoint = type === 'news'
      ? `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=3&freshness=pm`
      : `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`;
    const res = await fetch(endpoint, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
    });
    const data = await res.json();
    return type === 'news' ? (data.results || []) : (data.web?.results || []);
  } catch (e) {
    return [];
  }
}
