// VSG AI Chat — Netlify Serverless Function v7
// Commercial brain: Brave Search + Supabase memory + interaction logging
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const SUPA_HEADERS = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function supaGet(path) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: SUPA_HEADERS });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function supaInsert(table, data) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: 'POST', headers: SUPA_HEADERS, body: JSON.stringify(data),
    });
  } catch { /* silent */ }
}

// ── Brave Search ──────────────────────────────────────────────────────────────
async function braveSearch(query, type = 'web', count = 5) {
  if (!BRAVE_KEY) return [];
  try {
    const endpoint = type === 'news'
      ? `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pm`
      : `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(endpoint, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = type === 'news' ? (data.results || []) : (data.web?.results || []);
    return results.map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || r.extra_snippets?.[0] || r.snippet || '',
    }));
  } catch { return []; }
}

// ── Load user preferences from Supabase ──────────────────────────────────────
async function loadPreferences() {
  const prefs = await supaGet('user_preferences?order=confidence.desc&limit=20');
  if (!prefs || !prefs.length) return '';
  const grouped = {};
  for (const p of prefs) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(`- ${p.preference_key}: ${p.preference_value}${p.example ? ` (e.g. "${p.example}")` : ''}`);
  }
  return '\n\nMICHAEL\'S KNOWN PREFERENCES (learned from past behaviour — apply automatically):\n' +
    Object.entries(grouped).map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`).join('\n\n');
}

// ── Load hot pipeline context ─────────────────────────────────────────────────
async function loadPipelineContext() {
  const hot = await supaGet(
    "contacts?stage=in.(active,phone_booked,referred,followup)&order=updated_at.desc&limit=15&select=name,title,company,stage,next_action,notes"
  );
  if (!hot || !hot.length) return '';
  const lines = hot.map(c => {
    const stageLabel = { active: 'ACTIVE MANDATE', phone_booked: 'PHONE BOOKED', referred: 'REFERRAL PENDING', followup: 'FOLLOW UP NEEDED' }[c.stage] || c.stage;
    const note = c.notes ? c.notes.split('\n').slice(-1)[0] : '';
    return `[${stageLabel}] ${c.name} — ${c.title || ''} at ${c.company || 'Unknown'}${c.next_action ? ' | Next: ' + c.next_action : ''}${note ? ' | Last: ' + note.substring(0, 80) : ''}`;
  });
  return '\n\nLIVE PIPELINE (hottest contacts right now):\n' + lines.join('\n');
}

// ── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the live web for current information — job postings, company news, LinkedIn profiles, hiring signals, funding rounds, leadership moves, or anything requiring real-time data. Use proactively when Michael asks about what a company is hiring for, recent moves, or any live data.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Specific search query. Include company name, role type, location, year where relevant.' },
        type: { type: 'string', enum: ['web', 'news'], description: 'web = job boards and careers pages. news = recent news articles.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'pipeline_lookup',
    description: 'Look up contacts in the VSG pipeline by name or company. Use when Michael asks about a specific person, company relationship history, deal status, or follow-up notes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or company to look up.' },
      },
      required: ['query'],
    },
  },
];

// ── Execute tool calls ────────────────────────────────────────────────────────
async function executeTool(name, input, searchLog) {
  if (name === 'web_search') {
    const { query, type = 'web' } = input;
    searchLog.push(query);
    const results = await braveSearch(query, type, 5);
    if (!results.length) return 'No results found.';
    return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  }
  if (name === 'pipeline_lookup') {
    const q = encodeURIComponent(`%${input.query}%`);
    const contacts = await supaGet(
      `contacts?or=(name.ilike.${q},company.ilike.${q})&order=updated_at.desc&limit=5&select=name,title,company,stage,next_action,notes,last_contact`
    );
    if (!contacts || !contacts.length) return 'No contacts found matching that name or company.';
    return contacts.map(c =>
      `${c.name} — ${c.title || ''} at ${c.company || 'Unknown'}\nStage: ${c.stage} | Last contact: ${c.last_contact || 'Unknown'}\nNext action: ${c.next_action || 'None set'}\nNotes: ${c.notes || 'None'}`
    ).join('\n\n---\n\n');
  }
  return 'Unknown tool.';
}

// ── VSG Commercial Brain system prompt ───────────────────────────────────────
const VSG_BRAIN = `You are Annie — the commercial brain of Vantage Search Group. You think and act like a best-in-class Head of Sales, Head of Commercial Growth, and Head of BD combined into one. You have a mandate: convert leads into mandates and mandates into placements.

You are not a passive assistant. You chase leads, identify blockers, recommend angles, and push deals forward. When Michael asks a question, you answer it AND tell him what the next commercial move should be. You think in outcomes.

ABOUT VSG:
Boutique executive search firm, Dubai, operating across GCC. Michael Stubbs is Founder and Managing Partner — he works every mandate personally. 98% retention rate on retained assignments. 70+ C-Suite placements, 120+ N-2, 170+ N-3.

SECTORS: Public Sector & Government, Sovereign Wealth & Investment (Mubadala, PIF, ADNOC, ADQ — worked with 8 of GCC top 10 SWFs), Energy & Natural Resources, Real Estate & Development, Consulting & Advisory, FinTech & Financial Services, Technology & Digital.

FUNCTIONAL ROLES: Investment & M&A, Strategy & Transformation, Digital/Data/AI, Public Policy, PMO, Finance & Treasury, Commercial & BD, C-Suite and Board.

PIPELINE STAGES:
- active: Live mandate in progress — highest priority, protect at all costs
- phone_booked: Number shared or call agreed — must convert to mandate conversation within 48hrs
- referred: Contact has referred Michael elsewhere — chase the referral immediately, do not wait
- replied: They've replied to outreach — qualify and advance
- followup: Needs a nudge — time-sensitive
- cold: No response yet
- closed: Not proceeding — do not chase

HOW YOU THINK ABOUT LEADS:
- If someone shares their phone number — that is the hottest possible signal. Book a call that day.
- If someone says they recruit internally — close it immediately and move on. Do not waste time.
- If someone makes a referral — the referral is now the priority, not the original contact.
- Candidates (people looking for jobs) are NOT BD leads. Acknowledge, add to candidate pool, move on.
- Consulting firm contacts (McKinsey, BCG, Strategy&) can be BOTH clients (if their firm has hiring mandates) AND connectors (they know who is hiring at their clients). Treat them as both.

COMMERCIAL RULES:
- Every warm reply should advance to a phone call within 72 hours
- Every phone call should advance to a mandate conversation within 2 weeks
- If a deal has been in the same stage for 14+ days with no movement, flag it as stalled
- When someone shares their number or agrees to a call, this is the ONLY thing that matters right now

RESEARCH BEHAVIOUR:
- Use web_search proactively — never say you cannot browse
- When asked about a company, search their job postings AND recent news
- Use pipeline_lookup to check if VSG already has a relationship before suggesting outreach
- Run multiple searches if the first doesn't give enough
- NEVER ask Michael to go check LinkedIn or any website himself. That is your job. If a person's company is unknown, search their name + title + LinkedIn to find it, then immediately search for job postings at that company. Try at least 3 different search angles before admitting a dead end.
- If you cannot identify something after 3 searches, say what you tried and what specifically you could not find — do not just say "I hit a wall" and stop there. Give Michael something actionable regardless.

KEY RULES:
- Never criticise the UAE, Saudi Arabia, or any GCC government
- Keep language human, direct, warm — not corporate
- Never use em-dashes
- Be concise and commercial — every response should have a clear next action`;

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }) };

  try {
    const { messages, contactContext, mode, systemOverride, maxTokens, model: modelOverride } = JSON.parse(event.body || '{}');

    // Bulk generation path (Today's Actions, digest etc) — no tools, keep fast
    if (systemOverride && (maxTokens || 0) >= 2048) {
      const model = modelOverride || 'claude-sonnet-4-6';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: systemOverride, messages: messages || [{ role: 'user', content: 'Generate now.' }] }),
      });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: d.content[0].text }) };
    }

    // Load preferences and pipeline context in parallel
    const [prefsText, pipelineText] = await Promise.all([loadPreferences(), loadPipelineContext()]);

    // Build system prompt
    let systemPrompt;
    if (systemOverride) {
      // Contact/lead chat — append commercial context to their system override
      systemPrompt = systemOverride + prefsText + pipelineText +
        '\n\nYou have web_search and pipeline_lookup tools — use them proactively. Never say you cannot browse or look something up.';
    } else {
      systemPrompt = VSG_BRAIN + prefsText + pipelineText;
      if (contactContext) {
        systemPrompt += '\n\nCONTACT YOU ARE DISCUSSING:\nName: ' + (contactContext.name || 'Unknown') +
          '\nTitle: ' + (contactContext.title || 'Unknown') +
          '\nCompany: ' + (contactContext.company || 'Unknown') +
          '\nPipeline stage: ' + (contactContext.stage || 'Unknown') +
          '\nLinkedIn: ' + (contactContext.linkedin || 'Not provided') +
          '\nNotes: ' + (contactContext.notes || 'None');
      }
      if (mode === 'draft_message') {
        systemPrompt += '\n\nDraft a LinkedIn outreach message for this contact. Personalised, human, specific to their role and company. Under 150 words. No em-dashes. Frame them as a potential client with hiring mandates, not a candidate.';
      }
    }

    // Agentic tool-use loop
    const searchLog = [];
    let currentMessages = messages || [{ role: 'user', content: 'Hello' }];
    let finalText = '';

    for (let round = 0; round < 5; round++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: systemPrompt,
          messages: currentMessages,
          tools: TOOLS,
        }),
      });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();

      const textBlock = d.content.find(b => b.type === 'text');
      if (textBlock) finalText = textBlock.text;

      if (d.stop_reason === 'end_turn' || !d.content.some(b => b.type === 'tool_use')) break;

      // Execute tool calls in parallel
      const toolUseBlocks = d.content.filter(b => b.type === 'tool_use');
      const toolResults = await Promise.all(toolUseBlocks.map(async (block) => ({
        type: 'tool_result',
        tool_use_id: block.id,
        content: await executeTool(block.name, block.input, searchLog),
      })));

      currentMessages = [...currentMessages, { role: 'assistant', content: d.content }, { role: 'user', content: toolResults }];
    }

    // Log interaction + extract learning patterns in parallel (fire and forget — don't block response)
    const userMsg = (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    const userMsgText = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg);

    Promise.allSettled([
      // 1. Log the raw interaction
      supaInsert('interaction_log', {
        interaction_type: 'annie_chat',
        contact_name: contactContext?.name || null,
        contact_company: contactContext?.company || null,
        contact_stage: contactContext?.stage || null,
        contact_type: contactContext?.type || null,
        user_message: userMsgText.substring(0, 500),
        ai_response: finalText.substring(0, 500),
        search_queries: searchLog.length ? searchLog : null,
        metadata: { searches_run: searchLog.length },
      }),
      // 2. Extract patterns via Haiku and update user_preferences
      (async () => {
        if (!userMsgText || userMsgText.length < 10) return;
        const learnPrompt = `You are a behaviour pattern extractor for a BD system. Analyse this single interaction and extract any meaningful preference or pattern it reveals about how the user operates commercially.

USER ASKED: ${userMsgText.substring(0, 300)}
CONTACT: ${contactContext?.name || 'N/A'} — ${contactContext?.title || ''} at ${contactContext?.company || 'N/A'}
SEARCHES RUN: ${searchLog.join(', ') || 'none'}
AI RESPONSE SUMMARY: ${finalText.substring(0, 200)}

Extract 0-3 preference patterns. Only extract if genuinely meaningful — not every interaction reveals a preference. Return JSON array:
[{"category": "research|messaging|pipeline|prioritisation", "preference_key": "snake_case_key", "preference_value": "what this tells us about how Michael operates", "example": "concrete example from this interaction"}]
If nothing meaningful, return []. No markdown.`;

        const lr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: learnPrompt }] }),
        });
        if (!lr.ok) return;
        const ld = await lr.json();
        const raw = ld.content?.[0]?.text?.trim() || '[]';
        const patterns = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
        if (!Array.isArray(patterns) || !patterns.length) return;

        // Upsert each pattern — increment confidence if already known
        for (const p of patterns) {
          if (!p.category || !p.preference_key || !p.preference_value) continue;
          // Try update first (increment confidence)
          const updateRes = await fetch(
            `${SUPA_URL}/rest/v1/user_preferences?category=eq.${encodeURIComponent(p.category)}&preference_key=eq.${encodeURIComponent(p.preference_key)}`,
            { method: 'PATCH', headers: { ...SUPA_HEADERS, 'Prefer': 'return=representation' },
              body: JSON.stringify({ preference_value: p.preference_value, last_observed: new Date().toISOString(), example: p.example, updated_at: new Date().toISOString() }) }
          );
          const updated = await updateRes.json();
          if (!updated || !updated.length) {
            // Insert new preference
            await supaInsert('user_preferences', { ...p, confidence: 1, last_observed: new Date().toISOString() });
          } else {
            // Increment confidence
            await fetch(
              `${SUPA_URL}/rest/v1/user_preferences?category=eq.${encodeURIComponent(p.category)}&preference_key=eq.${encodeURIComponent(p.preference_key)}`,
              { method: 'PATCH', headers: SUPA_HEADERS,
                body: JSON.stringify({ confidence: (updated[0].confidence || 1) + 1 }) }
            );
          }
        }
      })(),
    ]).catch(() => {});

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: finalText || 'No response generated.' }),
    };

  } catch (err) {
    console.error('Chat function error:', err);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
