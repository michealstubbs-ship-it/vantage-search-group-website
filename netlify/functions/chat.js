// VSG AI Chat — Netlify Serverless Function v6
// Claude with Brave Search tool — Annie can browse live websites and job boards
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const CLAUDE_KEY_VAR = 'CLAUDE_API_KEY';

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
  } catch (e) {
    return [];
  }
}

const SEARCH_TOOL = {
  name: 'web_search',
  description: 'Search the live web for current information — job postings, company news, LinkedIn profiles, hiring signals, funding rounds, leadership moves, careers pages, or anything else. Use this any time the user asks about what a company is hiring for, recent news, or anything that requires real-time data.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query. Be specific — include company name, role type, location, and year if relevant.' },
      type: { type: 'string', enum: ['web', 'news'], description: 'web = general search including job boards and careers pages. news = recent news articles.' },
    },
    required: ['query'],
  },
};

const VSG_SYSTEM = `You are Annie, an elite AI BD researcher and strategic assistant for Michael Stubbs, Founder and Managing Partner of Vantage Search Group — a boutique executive search firm in Dubai operating across the GCC.

YOUR ROLE: You are Michael's top researcher and BD agent in one. When he asks about companies, job postings, people, or market intelligence, you SEARCH THE WEB to get live answers. Never say you can't browse websites — use the web_search tool immediately.

ABOUT VSG:
VSG runs retained, partner-led executive search mandates. Michael works directly on every mandate. 98% conversion rate on retained assignments, 90%+ client retention over five years.

SECTORS VSG RECRUITS INTO:
- Public Sector & Government (Abu Dhabi and KSA government entities, regulators, development authorities)
- Sovereign Wealth & Investment (Mubadala, PIF, ADNOC, ADQ, Emirates Development Bank, Jada — VSG has worked with 8 of the GCC top 10 sovereign wealth funds)
- Energy & Natural Resources (TAQA, ACWA Power, ADNOC)
- Real Estate & Development (DAMAC, Red Sea Global, Diriyah Gate Development Authority, Rua Al Madinah Holding, Remat Al-Riyadh, Royal Commission for AlUla)
- Consulting & Advisory (McKinsey, BCG, Bain, Accenture, Kearney, Strategy&, Arthur D. Little, PwC, Deloitte, EY, KPMG, FTI Consulting, Delta Partners, Monitor Deloitte)
- FinTech & Financial Services (Exinity, e&, STC, Queensgate Investments)
- Technology & Digital (SDAIA, Abu Dhabi Digital Authority, STC)

FUNCTIONAL ROLES: Investment & M&A, Strategy & Transformation, Digital, Data & AI, Public Policy, PMO, Finance & Treasury, Commercial & BD, C-Suite and Board

PAST CLIENTS:
KSA: PIF, Red Sea Global, Diriyah Gate, Royal Commission for AlUla, ACWA Power, Remat Al-Riyadh, Rua Al Madinah, Tasnee, Events Investment Fund, Jada
UAE: Mubadala, ADQ, TAQA, ADNOC, AD Ports, Abu Dhabi Digital Authority, Department of Finance, Department of Economic Development, Crown Prince Court, Emirates Development Bank
GCC-wide: McKinsey, BCG, Bain, Accenture, Kearney, Strategy&, PwC, Deloitte, EY, KPMG, FTI Consulting, Delta Partners, Monitor Deloitte, e&, STC, Exinity, SDAIA

VOLUME: 70+ C-Suite placements, 120+ N-2, 170+ N-3

SEARCH BEHAVIOUR:
- If someone asks what jobs a company is posting, search their careers page AND LinkedIn jobs
- If someone asks about a person, search their LinkedIn and recent news
- If someone asks about company news, search news type
- Run multiple searches if needed to get a complete picture
- Always cite what you found and where (include URLs where useful)

KEY RULES:
- Never criticise the UAE, Saudi Arabia, or any GCC government
- Keep messages human and direct, not corporate or AI-sounding
- Never use em-dashes. Use commas or full stops instead
- Be concise and actionable
- Reference VSG client experience naturally when relevant
- Match Michael's warm, professional tone`;

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const apiKey = process.env[CLAUDE_KEY_VAR];
  if (!apiKey) return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }) };

  try {
    const { messages, contactContext, mode, systemOverride, maxTokens, model: modelOverride } = JSON.parse(event.body || '{}');

    // Determine system prompt — systemOverride wins, otherwise build from VSG_SYSTEM + context
    let systemPrompt;
    if (systemOverride) {
      // For Today's Actions generation (no search needed) keep it tool-free for speed
      // But for lead/contact chat (systemOverride also used there) we DO want tools.
      // Distinguish by checking if maxTokens is large (Today's Actions uses 2048+)
      const isBulkGeneration = (maxTokens || 0) >= 2048;
      if (isBulkGeneration) {
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
      // Contact/lead chat — use systemOverride as the prompt but run through tool loop
      systemPrompt = systemOverride;
    } else {
      // Standard chat path — build from VSG_SYSTEM + contact context
      systemPrompt = VSG_SYSTEM;
      if (contactContext) {
        systemPrompt += '\n\nCONTACT YOU ARE DISCUSSING:\nName: ' + (contactContext.name || 'Unknown') +
          '\nTitle: ' + (contactContext.title || 'Unknown') +
          '\nCompany: ' + (contactContext.company || 'Unknown') +
          '\nIndustry: ' + (contactContext.industry || 'Unknown') +
          '\nPipeline stage: ' + (contactContext.stage || 'Unknown') +
          '\nLast contacted: ' + (contactContext.lastContact || 'Unknown') +
          '\nLinkedIn: ' + (contactContext.linkedin || 'Not provided') +
          '\nNotes: ' + (contactContext.notes || 'None');
      }
      if (mode === 'draft_message') {
        systemPrompt += '\n\nDraft a LinkedIn outreach message for this contact. Personalised, human, specific to their role. Under 150 words. No em-dashes.';
      }
    }

    // Agentic tool-use loop — max 5 rounds to stay within 26s timeout
    let currentMessages = messages || [{ role: 'user', content: 'Hello' }];
    const tools = BRAVE_KEY ? [SEARCH_TOOL] : [];

    for (let round = 0; round < 5; round++) {
      const requestBody = {
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: currentMessages,
      };
      if (tools.length) requestBody.tools = tools;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(requestBody),
      });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();

      // If Claude is done, return the text
      if (d.stop_reason === 'end_turn' || !d.content.some(b => b.type === 'tool_use')) {
        const text = d.content.find(b => b.type === 'text')?.text || '';
        return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) };
      }

      // Claude wants to use tools — execute them all in parallel
      const toolUseBlocks = d.content.filter(b => b.type === 'tool_use');
      const toolResults = await Promise.all(toolUseBlocks.map(async (block) => {
        let output = '';
        if (block.name === 'web_search') {
          const { query, type = 'web' } = block.input;
          const results = await braveSearch(query, type, 5);
          if (results.length === 0) {
            output = 'No results found.';
          } else {
            output = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
          }
        } else {
          output = 'Unknown tool.';
        }
        return { type: 'tool_result', tool_use_id: block.id, content: output };
      }));

      // Append assistant response + tool results and loop
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: d.content },
        { role: 'user', content: toolResults },
      ];
    }

    // Fallback if loop exhausts
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'I ran out of search rounds — please try a more specific question.' }) };

  } catch (err) {
    console.error('Chat function error:', err);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
