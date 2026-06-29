// qualify-leads.js
// For each contact in linkedin_leads, searches for company signals (funding, hiring, size)
// then uses Claude to score 1-5, produce a conversation hook, explain why they were originally
// contacted, and draft a suggested follow-up message.
// Called from the LinkedIn Leads panel "Qualify All" button.

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;

const SUPA_HEADERS = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function supaSelect(table, params = '') {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}${params}`, {
    headers: SUPA_HEADERS,
  });
  if (!res.ok) throw new Error(`Supabase select failed: ${await res.text()}`);
  return res.json();
}

async function supaUpdate(table, id, data) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: SUPA_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase update failed: ${await res.text()}`);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!CLAUDE_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'CLAUDE_API_KEY not set' }) };

  const body = JSON.parse(event.body || '{}');
  const forceRequalify = body.force === true;

  // Fetch leads
  const qualifiedFilter = forceRequalify ? '' : '&qualified_at=is.null';
  const leadsParams = `?select=id,full_name,title,company,notes,linkedin_url,status&order=created_at.asc&limit=30${qualifiedFilter}`;

  let leads;
  try {
    leads = await supaSelect('linkedin_leads', leadsParams);
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }

  if (!leads || leads.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ qualified: 0, message: 'No leads to qualify' }) };
  }

  let qualified = 0;

  for (const lead of leads) {
    try {
      // 1. Fetch original company signals
      let originalSignals = '';
      if (lead.company) {
        const companyEncoded = encodeURIComponent(`%${lead.company}%`);
        const signals = await supaSelect('company_signals',
          `?select=signal_type,title,summary,created_at,importance&company_name=ilike.${companyEncoded}&order=created_at.desc&limit=3`
        );
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
- Status: ${lead.status || 'Unknown'}
- Notes: ${lead.notes || 'None'}

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
  "suggested_message": "<A short, specific LinkedIn message (60-100 words) to send this warm lead. CRITICAL: This person is a potential CLIENT, not a candidate. Vantage Search Group wants to WIN THEIR HIRING MANDATE — they should be asked whether their company or team has senior hiring needs that VSG could support. Do NOT suggest they are a candidate or ask them to refer others. The message must: acknowledge their reply warmly, reference something specific about their company or role, and move toward asking if they have open senior roles VSG could help fill. Do NOT use generic openers. If score is 1-2, write null>"
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
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();
      const raw = data.content?.[0]?.text || '';
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      await supaUpdate('linkedin_leads', lead.id, {
        qualification_score: parsed.score,
        qualification_notes: parsed.notes || null,
        qualification_hooks: parsed.hook || null,
        outreach_reason: parsed.outreach_reason || null,
        suggested_message: parsed.suggested_message || null,
        qualified_at: new Date().toISOString(),
      });

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
