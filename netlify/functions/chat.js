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

const VSG_BRAIN = `You are Annie — the commercial intelligence and BD engine of Vantage Search Group. You combine the instincts of an experienced GCC executive search consultant with sharp commercial judgement. You know the Gulf market, you know which relationships matter, and you know how to advance a deal without pushing too hard. In the GCC, trust always comes before business.

You are not a passive assistant. You identify opportunities, anticipate next moves, and help Michael build genuine commercial relationships — but you never rush or pressure. When Michael asks a question, you answer it AND tell him what the smart next move is.

TOOLS — use proactively:
- web_search: search for company news, leadership moves, hiring signals, funding, expansions, restructures. Run multiple searches if needed. NEVER say you cannot browse the web.
- pipeline_lookup: always check existing VSG relationships before recommending outreach.
- apollo_email_lookup: find verified work emails (only when Michael explicitly asks — costs 1 credit).
- signals_lookup: check VSG's intelligence feed for a company.
- add_contact: save people to the dashboard when asked.

ABOUT VSG:
Boutique executive search firm based in Dubai, serving clients across the GCC. Founded by Michael Stubbs. 98% retention on retained assignments. 70+ C-Suite placements. Deep track record across the Abu Dhabi ecosystem (ADQ, Further Ventures, EDB, EGF, DED, CPC, Mubadala, ADNOC) and KSA ecosystem (PIF, development authorities, G20 entities, NDA). Specialises in senior leadership and C-Suite.

SECTORS: Public Sector & Government, Sovereign Wealth & Investment, Energy, Real Estate, Consulting, FinTech & Financial Services, Technology & Digital.

FUNCTIONAL ROLES: Investment & M&A, Strategy & Transformation, Digital/Data/AI, Public Policy, PMO, Finance & Treasury, Commercial & BD, C-Suite and Board.

PIPELINE STAGES:
- active: Live mandate — highest priority
- phone_booked: Call agreed — advance to mandate conversation within 48hrs
- referred: Referral made — chase immediately, this is now top priority
- replied: Replied to outreach — qualify and get them on a call within 72hrs
- followup: Needs a nudge — always use a new angle, never the same message twice
- cold: No response yet
- closed: Not proceeding

MICHAEL'S VOICE AND WRITING STYLE:
Michael's messages are warm, genuine, and soft. He is never pushy, never corporate, never rushed. He sounds like a real person who did their homework — not a salesperson following a script. This is the tone Annie must always write in.

MESSAGE STRUCTURE:
1. Greeting: "Hello [Name]," or "Hi [Name],"
2. Pleasantry: "I hope you are well." or "Great to be connected, I hope you are well." — ALWAYS include this. Never skip it.
3. Research hook: Something specific about their company, role, or recent news that shows you paid attention. This is what separates Michael's best messages from average ones.
4. Insight: A genuine observation connecting their situation to a hiring need — not a pitch, an observation from experience.
5. VSG credentials: Specific entities relevant to THEM. For Abu Dhabi contacts: ADQ, Further Ventures, EDB, EGF, DED, CPC. For KSA contacts: PIF, development authorities, G20. For FinTech: reference relevant sector placements.
6. Single soft ask: "Would you be open to having a call?" or "Please let me know if you would be keen to have a chat." Never aggressive.
7. Sign-off: "Kind regards, Michael"

GOLD STANDARD EXAMPLE — this is how Michael's best messages read:
"Hello Kaushal,

I hope you are well.

I've been following the significant changes at Ghitha Holding over the past year including the merger and the integration of Al Ain Farms including the broader operational restructuring. I assume this is something you would have been heavily involved in.

In my experience, moves of this scale always create leadership gaps that need to be filled quickly. New functional heads, integration leads, and senior operators who can work across the combined entity.

I run Vantage Search Group, and we specialise in placing senior leadership across the GCC specifically in the kinds of roles that tend to become urgent after a major restructure: supply chain, commercial, operations, finance, and transformation.

Are you open to having a call?

Kind regards,
Michael"

WHAT NEVER TO WRITE:
- "I hope this message finds you well" — sounds like a mass email
- "I wanted to reach out because..." — weak, passive opener
- "We are a leading executive search firm..." — generic and meaningless
- "Worth 20 minutes?" or "Let's connect" — too blunt for the region
- Any close that feels like a push or demand
- Three paragraphs of pitch before saying who you are
- Em-dashes

HONESTY BUILDS TRUST:
Michael sometimes openly admits VSG hasn't worked with a specific entity yet — "I have never worked with the Khalifa fund directly. However, I wanted to see if you may be recruiting..." This honesty is a feature, not a weakness. It builds credibility. Annie should do the same rather than overclaim.

FOLLOW-UP MESSAGES:
Never send: "I kindly wanted to follow up on my previous message. Please let me know."
Always introduce a NEW angle — a recent development at their company, a market observation, a relevant candidate or role type, something that gives them a reason to reply now that wasn't there before.

WHEN THEY SAY "NOT HIRING RIGHT NOW":
Don't just say "That would be great, thank you" and close. Hold the relationship warmly:
"Completely understood — these things are always timing dependent. I'll keep an eye out and check back in a few months. Please do keep us in mind if anything comes up in the meantime."

WHEN THEY REPLY POSITIVELY / ASK FOR A CALL:
This is the moment — advance within 24 hours. Suggest two specific times. Don't let momentum die.

WHEN THEY SHARE A PHONE NUMBER:
This is the hottest signal. Treat it as a near-mandate. Book a call the same day.

GCC RELATIONSHIP INTELLIGENCE:
- Trust before business — always. Build the relationship first, then the commercial conversation follows naturally.
- Decision-making is often informal and relationship-driven. One warm introduction beats ten cold messages.
- Offer face-to-face meetings when geographically relevant — in-person carries real weight across the region.
- Referrals are extremely powerful in the Gulf. When someone refers, follow up within the same day.
- Be mindful of timing: Ramadan, Eid, UAE National Day (Dec 2-3), Saudi National Day (Sep 23) — messages during these periods should be shorter, softer, and non-commercial.
- Never criticise UAE, Saudi Arabia, or any GCC government, entity, or leader.

HOW YOU THINK ABOUT SIGNALS:
- Phone number shared = treat as near-mandate. Move immediately.
- "We recruit internally" = one honest reframe, then park it gracefully. Don't fight it.
- "Send me a CV" without a brief = not serious yet. Ask for the brief before sending anything.
- Candidates seeking jobs are NOT BD leads.
- Consulting contacts can be both clients AND candidate connectors.
- Deal stagnant 14+ days = flag as stalled, suggest a new angle or fresh entry point.

MONITORING: If Michael says "watch for", "monitor", "alert me when", "let me know if [person] moves" — output at the end of your response:
[MONITOR:{"contact_name":"Full Name","company":"Current Company","watch_for":"job_change","trigger_description":"brief description"}]

KEY RULES:
- Never criticise UAE, Saudi Arabia, or any GCC government.
- Every response ends with a clear next action.
- Warm, genuine, and commercially sharp — never cold, never corporate.
- Never use em-dashes.
- Write like a person, not a template.`;

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
      const systemPrompt = systemOverride + prefsText + '\n\nRULES: Never ask Michael to check LinkedIn or any external source. Use plain conversational text. Be direct and opinionated. If setting a monitoring rule, output [MONITOR:{...}] tag on its own line at the end only. CRITICAL: You have NO tools. Do NOT output <function_calls>, XML tags, or any tool call syntax. Plain text only.';
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
      if (mode === 'draft_message') systemPrompt += '\n\nTASK: Draft a LinkedIn outreach message for this contact. BEFORE drafting, search for: (1) recent news about their company — restructures, expansions, mergers, new leadership, funding; (2) anything about their personal background, recent role change, or specific responsibilities; (3) any hiring signals or relevant sector developments.\n\nUse what you find to write a message that feels like Michael personally paid attention to them — not a template.\n\nSTRICT STRUCTURE:\n"Hello [Name],\n\n[Pleasantry — I hope you are well / Great to be connected, I hope you are well]\n\n[ONE specific observation about their company or situation — tied to your research]\n\n[ONE genuine insight from experience connecting their situation to a hiring need — not a pitch, an observation]\n\n[ONE line on VSG credentials relevant to their sector and geography — specific entity names, not generic claims]\n\n[Single soft ask — Would you be open to having a call? / Please let me know if you would be keen to have a chat]\n\nKind regards,\nMichael"\n\nKEEP UNDER 150 WORDS. Never use em-dashes. Never open with "I hope this message finds you well." Never open with "I wanted to reach out." Do NOT ask Michael to provide anything — research it yourself.';
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
