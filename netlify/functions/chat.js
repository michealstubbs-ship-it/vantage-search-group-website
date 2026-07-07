// VSG AI Chat — Netlify Serverless Function v8
// Full agentic Annie: web search + Apollo email lookup + Supabase read/write + signals
const BRAVE_KEY  = process.env.BRAVE_SEARCH_API_KEY;
const APOLLO_KEY = process.env.APOLLO_API_KEY;
const SUPA_URL   = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY   = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const SUPA_HDR   = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

// Context cache - reused across warm Lambda invocations
let _ctxCache = { prefs: '', pipeline: '', memory: '', ts: 0 };
const CTX_TTL  = 5 * 60 * 1000;

async function supaGet(path) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: SUPA_HDR });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}
async function supaInsert(table, data) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, { method: 'POST', headers: SUPA_HDR, body: JSON.stringify(data) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}
async function supaUpdate(table, filter, data) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: SUPA_HDR, body: JSON.stringify(data) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function braveSearch(query, type = 'web', count = 5) {
  if (!BRAVE_KEY) return [];
  try {
    const endpoint = type === 'news'
      ? `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pm`
      : `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(endpoint, { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY } });
    if (!res.ok) return [];
    const data = await res.json();
    const results = type === 'news' ? (data.results || []) : (data.web?.results || []);
    return results.map(r => ({ title: r.title || '', url: r.url || '', snippet: r.description || r.extra_snippets?.[0] || r.snippet || '' }));
  } catch { return []; }
}

async function loadAnnieMemory() {
  const rows = await supaGet('annie_memory?select=key,value&order=key');
  if (!rows || !rows.length) return '';
  const labels = { priority_targets: 'Priority BD targets', sectors_focus: 'Sectors to focus on', current_strategy: 'Current VSG strategy', style_rules: "Michael's communication style", relationship_notes: 'Relationship notes', sectors_avoid: 'Sectors/companies to avoid', recent_wins: 'Recent wins', open_mandates: 'Open mandates' };
  const parts = rows.filter(r => r.value && r.value.trim()).map(r => `${labels[r.key] || r.key}: ${r.value}`);
  return parts.length ? "\n\n--- ANNIE'S MEMORY ---\n" + parts.join('\n') + '\n--- END MEMORY ---' : '';
}
async function loadPreferences() {
  const prefs = await supaGet('user_preferences?order=confidence.desc&limit=20');
  if (!prefs || !prefs.length) return '';
  const grouped = {};
  for (const p of prefs) { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(`- ${p.preference_key}: ${p.preference_value}`); }
  return '\n\nMICHAEL\'S KNOWN PREFERENCES:\n' + Object.entries(grouped).map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`).join('\n\n');
}
async function loadPipelineContext() {
  const hot = await supaGet('contacts?stage=in.(active,phone_booked,referred,followup)&order=updated_at.desc&limit=12&select=name,title,company,stage,next_action,notes');
  if (!hot || !hot.length) return '';
  const stageLabel = { active: 'ACTIVE MANDATE', phone_booked: 'PHONE BOOKED', referred: 'REFERRAL PENDING', followup: 'FOLLOW UP' };
  const lines = hot.map(c => { const note = c.notes ? c.notes.split('\n').slice(-1)[0] : ''; return `[${stageLabel[c.stage] || c.stage}] ${c.name} — ${c.title || ''} at ${c.company || 'Unknown'}${c.next_action ? ' | Next: ' + c.next_action : ''}${note ? ' | Last: ' + note.substring(0, 80) : ''}`; });
  return '\n\nLIVE PIPELINE:\n' + lines.join('\n');
}
async function loadContext() {
  const now = Date.now();
  if (_ctxCache.ts && (now - _ctxCache.ts) < CTX_TTL) return { prefsText: _ctxCache.prefs, pipelineText: _ctxCache.pipeline, memoryText: _ctxCache.memory };
  const [prefsText, pipelineText, memoryText] = await Promise.all([loadPreferences(), loadPipelineContext(), loadAnnieMemory()]);
  _ctxCache = { prefs: prefsText, pipeline: pipelineText, memory: memoryText, ts: now };
  return { prefsText, pipelineText, memoryText };
}

const TOOLS = [
  { name: 'web_search', description: 'Search the live web for current information — company news, job postings, funding rounds, LinkedIn profiles, leadership moves, hiring signals. Use proactively. Run multiple searches if needed. Never say you cannot browse.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Specific search query.' }, type: { type: 'string', enum: ['web', 'news'] } }, required: ['query'] } },
  { name: 'pipeline_lookup', description: 'Look up a contact or company in the VSG pipeline. Use when asked about existing relationships, deal status, notes, or follow-up history.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name or company to look up.' } }, required: ['query'] } },
  { name: 'apollo_email_lookup', description: 'Find the verified work email for a named person at a company. Only use when Michael explicitly asks for an email. Costs 1 Apollo credit.', input_schema: { type: 'object', properties: { name: { type: 'string' }, organization_name: { type: 'string' } }, required: ['name', 'organization_name'] } },
  { name: 'signals_lookup', description: 'Look up intelligence signals for a company from the VSG monitoring system — news, funding, leadership changes, hiring.', input_schema: { type: 'object', properties: { company_name: { type: 'string' } }, required: ['company_name'] } },
  { name: 'add_contact', description: 'Add a new contact to the VSG dashboard, or update an existing contact email or notes. Use when Michael says "add this person" or "save this contact" or after finding an email.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'update_email', 'update_notes'] }, name: { type: 'string' }, company: { type: 'string' }, title: { type: 'string' }, email: { type: 'string' }, linkedin: { type: 'string' }, industry: { type: 'string' }, notes: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['action', 'name'] } },
];

async function executeTool(name, input, searchLog) {
  if (name === 'web_search') {
    const { query, type = 'web' } = input;
    searchLog.push(query);
    const results = await braveSearch(query, type, 5);
    if (!results.length) return 'No results found for: ' + query;
    return results.map((r, i) => `[${i+1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  }
  if (name === 'pipeline_lookup') {
    const q = encodeURIComponent(`%${input.query}%`);
    const contacts = await supaGet(`contacts?or=(name.ilike.${q},company.ilike.${q})&order=updated_at.desc&limit=6&select=name,title,company,stage,email,next_action,notes,last_contact,linkedin`);
    if (!contacts || !contacts.length) return `No contacts found matching "${input.query}".`;
    return contacts.map(c => `${c.name} — ${c.title || 'Unknown'} at ${c.company || 'Unknown'}\nStage: ${c.stage || 'prospect'} | Email: ${c.email || 'Not set'} | Last contact: ${c.last_contact || 'Never'}\nLinkedIn: ${c.linkedin || 'Not set'}\nNext action: ${c.next_action || 'None'}\nNotes: ${(c.notes || 'None').substring(0, 200)}`).join('\n\n---\n\n');
  }
  if (name === 'apollo_email_lookup') {
    if (!APOLLO_KEY) return 'Apollo API key (APOLLO_API_KEY) not configured in Netlify environment variables.';
    try {
      const res = await fetch('https://api.apollo.io/api/v1/people/match', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': APOLLO_KEY }, body: JSON.stringify({ name: input.name, organization_name: input.organization_name, reveal_personal_emails: false, reveal_phone_number: false }) });
      if (!res.ok) return `Apollo lookup failed (HTTP ${res.status}).`;
      const data = await res.json();
      const person = data.person;
      if (!person || !person.email) return `No verified email found for ${input.name} at ${input.organization_name}.`;
      return [`Email: ${person.email} (${person.email_status || 'unknown'})`, `Title: ${person.title || 'Unknown'}`, `LinkedIn: ${person.linkedin_url || 'Not found'}`, `Location: ${person.formatted_address || person.country || 'Unknown'}`].join('\n');
    } catch (e) { return `Apollo error: ${e.message}`; }
  }
  if (name === 'signals_lookup') {
    const q = encodeURIComponent(`%${input.company_name}%`);
    const signals = await supaGet(`company_signals?company_name=ilike.${q}&order=created_at.desc&limit=8&select=company_name,signal_type,title,summary,importance,created_at,named_contact,named_contact_title`);
    if (!signals || !signals.length) return `No intelligence signals found for "${input.company_name}".`;
    return signals.map(s => `[${(s.importance||'medium').toUpperCase()}] ${s.signal_type?.toUpperCase()} — ${s.title} (${s.created_at?.substring(0,10)||'?'})${s.summary?'\n'+s.summary.substring(0,200):''}${s.named_contact?'\nContact: '+s.named_contact+(s.named_contact_title?' ('+s.named_contact_title+')':''):''}`).join('\n\n---\n\n');
  }
  if (name === 'add_contact') {
    const { action, name: contactName, company, title, email, linkedin, industry, notes, priority } = input;
    try {
      if (action === 'update_email' || action === 'update_notes') {
        const q = encodeURIComponent(`%${contactName}%`);
        const existing = await supaGet(`contacts?name=ilike.${q}&limit=1&select=id,name,email,notes`);
        if (!existing || !existing.length) return `No contact found matching "${contactName}".`;
        const c = existing[0];
        const patch = { updated_at: new Date().toISOString().substring(0,10) };
        if (action === 'update_email' && email) patch.email = email;
        if (action === 'update_notes' && notes) patch.notes = (c.notes ? c.notes + '\n' : '') + notes;
        await supaUpdate('contacts', `id=eq.${c.id}`, patch);
        return `Updated ${c.name}: ${action === 'update_email' ? 'email set to ' + email : 'notes appended'}.`;
      }
      if (action === 'add') {
        const q = encodeURIComponent(`%${contactName}%`);
        const existing = await supaGet(`contacts?name=ilike.${q}&limit=1&select=id,name`);
        if (existing && existing.length) return `Contact "${existing[0].name}" already exists in the dashboard.`;
        const maxRes = await supaGet('contacts?select=id&order=id.desc&limit=1');
        const maxId = (maxRes && maxRes.length) ? (maxRes[0].id + 1) : Date.now();
        const today = new Date().toISOString().substring(0,10);
        const result = await supaInsert('contacts', { id: maxId, name: contactName, company: company||null, title: title||null, email: email||null, linkedin: linkedin||null, industry: industry||null, notes: notes||null, priority: priority||'medium', source: 'annie', stage: 'prospect', contact_type: 'client', created_at: today, updated_at: today });
        if (!result) return `Failed to add "${contactName}".`;
        return `Added "${contactName}" (${title||'Unknown'} at ${company||'Unknown'}) to the VSG dashboard.`;
      }
    } catch (e) { return `add_contact error: ${e.message}`; }
  }
  return 'Unknown tool: ' + name;
}

const VSG_BRAIN = `You are Annie — the commercial brain of Vantage Search Group. You think and act like a best-in-class Head of Sales, Head of Commercial Growth, and Head of BD combined. Your mandate: convert leads into mandates and mandates into placements.

You are not a passive assistant. You chase leads, identify blockers, recommend angles, and push deals forward. When Michael asks a question, you answer it AND tell him what the next commercial move should be.

TOOLS — use them aggressively:
- web_search: search live web for company news, job postings, funding, leadership moves. Run multiple searches. NEVER say you cannot browse.
- pipeline_lookup: check VSG's existing relationships before recommending outreach.
- apollo_email_lookup: find verified work emails (only when explicitly asked — costs 1 credit).
- signals_lookup: check VSG's intelligence feed for a company.
- add_contact: save people to the dashboard when asked.

ABOUT VSG:
Boutique executive search firm, Dubai, GCC. Michael Stubbs is Founder and Managing Partner. 98% retention on retained assignments. 70+ C-Suite placements.

SECTORS: Public Sector & Government, Sovereign Wealth & Investment (Mubadala, PIF, ADNOC, ADQ), Energy, Real Estate, Consulting, FinTech & Financial Services, Technology & Digital.

FUNCTIONAL ROLES: Investment & M&A, Strategy & Transformation, Digital/Data/AI, Public Policy, PMO, Finance & Treasury, Commercial & BD, C-Suite and Board.

PIPELINE STAGES:
- active: Live mandate — highest priority
- phone_booked: Call agreed — convert to mandate conversation within 48hrs
- referred: Referral made — chase immediately
- replied: Replied to outreach — qualify and advance
- followup: Needs a nudge
- cold: No response yet
- closed: Not proceeding

HOW YOU THINK:
- Phone number shared = hottest signal. Book a call that day.
- "We recruit internally" = close it, move on.
- Referral made = referral is now the priority.
- Candidates (job-seekers) are NOT BD leads.
- Consulting contacts can be both clients AND connectors.

COMMERCIAL RULES:
- Every warm reply should advance to a phone call within 72 hours.
- Every phone call should advance to a mandate conversation within 2 weeks.
- Deal stagnant 14+ days = flag as stalled.

MONITORING: If Michael says "watch for", "monitor", "alert me when", "let me know if [person] moves" — output at end of response:
[MONITOR:{"contact_name":"Full Name","company":"Current Company","watch_for":"job_change","trigger_description":"brief description"}]

KEY RULES:
- Never criticise UAE, Saudi Arabia, or any GCC government.
- Keep language human, direct, warm — not corporate.
- Never use em-dashes.
- Be concise. Every response has a clear next action.
- No excessive bullet points — use prose where natural.`;

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }) };

  try {
    const { messages, contactContext, mode, systemOverride, maxTokens, model: modelOverride, extraContext, isContactChat: isContactChatFlag } = JSON.parse(event.body || '{}');

    // PATH 1: Bulk generation (Today's Actions, digest) — no tools, fast
    if (systemOverride && (maxTokens || 0) >= 2048) {
      const model = modelOverride || 'claude-sonnet-4-6';
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: maxTokens, system: systemOverride, messages: messages || [{ role: 'user', content: 'Generate now.' }] }) });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: d.content[0].text }) };
    }

    // PATH 2: Fast contact/lead/action chat — Haiku, no tools
    const useContactPath = isContactChatFlag === true || (systemOverride && (maxTokens || 0) > 0 && (maxTokens || 0) < 2048);
    if (useContactPath) {
      const prefsText = _ctxCache.ts ? _ctxCache.prefs : await loadPreferences();
      const systemPrompt = systemOverride + prefsText + '\n\nRULES: Never ask Michael to check LinkedIn or any external source. Use plain conversational text. Be direct and opinionated. If setting a monitoring rule, output [MONITOR:{...}] tag on its own line at the end only.';
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, system: systemPrompt, messages: messages || [{ role: 'user', content: 'Hello' }] }) });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: d.content?.[0]?.text || '' }) };
    }

    // PATH 3: Full agentic Annie — Sonnet + all tools + full context
    const { prefsText, pipelineText, memoryText } = await loadContext();
    let systemPrompt;
    if (systemOverride) {
      systemPrompt = systemOverride + prefsText + pipelineText + memoryText;
    } else {
      systemPrompt = VSG_BRAIN + prefsText + pipelineText + memoryText;
      if (extraContext) systemPrompt += '\n\nCURRENT CONTEXT: ' + extraContext;
      if (contactContext) {
        systemPrompt += '\n\nCONTACT CONTEXT:\nName: ' + (contactContext.name||'Unknown') + '\nTitle: ' + (contactContext.title||'Unknown') + '\nCompany: ' + (contactContext.company||'Unknown') + '\nStage: ' + (contactContext.stage||'Unknown') + '\nLinkedIn: ' + (contactContext.linkedin||'Not provided') + '\nEmail: ' + (contactContext.email||'Not provided') + '\nNotes: ' + (contactContext.notes||'None');
      }
      if (mode === 'draft_message') systemPrompt += '\n\nDraft a LinkedIn outreach message for this contact. Personalised, human, specific to their role. Under 150 words. No em-dashes.';
    }

    const searchLog = [];
    let currentMessages = messages || [{ role: 'user', content: 'Hello' }];
    let finalText = '';
    const model = modelOverride || 'claude-sonnet-4-6';

    for (let round = 0; round < 6; round++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 1800, system: systemPrompt, messages: currentMessages, tools: TOOLS }) });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();
      const textBlock = d.content.find(b => b.type === 'text');
      if (textBlock) finalText = textBlock.text;
      if (d.stop_reason === 'end_turn' || !d.content.some(b => b.type === 'tool_use')) break;
      const toolUseBlocks = d.content.filter(b => b.type === 'tool_use');
      const toolResults = await Promise.all(toolUseBlocks.map(async (block) => ({ type: 'tool_result', tool_use_id: block.id, content: await executeTool(block.name, block.input, searchLog) })));
      currentMessages = [...currentMessages, { role: 'assistant', content: d.content }, { role: 'user', content: toolResults }];
    }

    // Fire-and-forget logging
    const userMsg = (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    const userMsgText = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg);
    Promise.allSettled([
      supaInsert('interaction_log', { interaction_type: 'annie_chat', contact_name: contactContext?.name||null, contact_company: contactContext?.company||null, user_message: userMsgText.substring(0,500), ai_response: finalText.substring(0,500), search_queries: searchLog.length ? searchLog : null, metadata: { searches_run: searchLog.length } }),
      (async () => {
        if (!userMsgText || userMsgText.length < 10) return;
        const lr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, messages: [{ role: 'user', content: `Extract 0-2 preference patterns from: "${userMsgText.substring(0,300)}". Return JSON array [{"category":"research|messaging|pipeline|prioritisation","preference_key":"snake_case","preference_value":"what this tells us","example":"concrete example"}] or []. No markdown.` }] }) });
        if (!lr.ok) return;
        const ld = await lr.json();
        const raw = ld.content?.[0]?.text?.trim() || '[]';
        let patterns; try { patterns = JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()); } catch { return; }
        if (!Array.isArray(patterns) || !patterns.length) return;
        for (const p of patterns) {
          if (!p.category || !p.preference_key || !p.preference_value) continue;
          const upRes = await fetch(`${SUPA_URL}/rest/v1/user_preferences?category=eq.${encodeURIComponent(p.category)}&preference_key=eq.${encodeURIComponent(p.preference_key)}`, { method: 'PATCH', headers: { ...SUPA_HDR, 'Prefer': 'return=representation' }, body: JSON.stringify({ preference_value: p.preference_value, last_observed: new Date().toISOString(), example: p.example, updated_at: new Date().toISOString() }) });
          const updated = await upRes.json();
          if (!updated || !updated.length) await supaInsert('user_preferences', { ...p, confidence: 1, last_observed: new Date().toISOString() });
          else await fetch(`${SUPA_URL}/rest/v1/user_preferences?category=eq.${encodeURIComponent(p.category)}&preference_key=eq.${encodeURIComponent(p.preference_key)}`, { method: 'PATCH', headers: SUPA_HDR, body: JSON.stringify({ confidence: (updated[0].confidence||1)+1 }) });
        }
      })(),
    ]).catch(() => {});

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: finalText || 'No response generated.', searches: searchLog }) };

  } catch (err) {
    console.error('Chat function error:', err);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
