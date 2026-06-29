// VSG AI Chat — Netlify Serverless Function v2
// Proxies requests to Claude API with contact context injected
// Set CLAUDE_API_KEY in Netlify → Site settings → Environment variables

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured. Add it in Netlify → Site settings → Environment variables.' })
    };
  }

  try {
    const { messages, contactContext, mode, systemOverride, maxTokens, model: modelOverride } = JSON.parse(event.body || '{}');

    // Use caller-supplied system prompt override if provided (e.g. Today's Actions, Strategic Brief)
    if (systemOverride) {
      const model = modelOverride || 'claude-haiku-4-5-20251001';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens || 2048, system: systemOverride, messages: messages || [{ role: 'user', content: 'Generate now.' }] }),
      });
      if (!response.ok) { const err = await response.text(); throw new Error(`Claude API error: ${response.status} — ${err}`); }
      const data = await response.json();
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: data.content[0].text }) };
    }

    // Build system prompt with injected context
    let systemPrompt = `You are an AI BD assistant for Michael Stubbs, Founder and Managing Partner of Vantage Search Group — a boutique executive search firm headquartered in Dubai, operating across the GCC.

ABOUT VSG:
Vantage Search Group runs retained, partner-led executive search mandates. Michael works directly on every mandate — no junior delegation, no briefing chains. VSG has a 98% conversion rate on retained assignments and 90%+ client retention over five years.

SECTORS VSG RECRUITS INTO:
- Public Sector & Government (Abu Dhabi and KSA government entities, regulators, development authorities)
- Sovereign Wealth & Investment (Mubadala, PIF, ADNOC, ADQ, Emirates Development Bank, Jada Fund of Funds — VSG has worked with 8 of the GCC's top 10 sovereign wealth funds)
- Energy & Natural Resources (TAQA, ACWA Power, ADNOC)
- Real Estate & Development (DAMAC, Red Sea Global, Diriyah Gate Development Authority, Rua Al Madinah Holding, Remat Al-Riyadh, Royal Commission for AlUla)
- Consulting & Advisory (Accenture, Kearney, Strategy&, Arthur D. Little, PwC, Deloitte, Devoteam)
- FinTech & Financial Services (Exinity, e&, STC, Queensgate Investments)
- Technology & Digital (SDAIA, Abu Dhabi Digital Authority, AI.f(T), STC)

FUNCTIONAL ROLES VSG PLACES:
Investment & M&A, Strategy & Transformation, Digital, Data & AI, Public Policy, PMO, Finance & Treasury, Commercial & Business Development, Construction & Project Management, C-Suite and Board

PAST NOTABLE CLIENTS:
KSA: PIF, Red Sea Global, Diriyah Gate Development Authority, Royal Commission for AlUla, ACWA Power, Remat Al-Riyadh, Rua Al Madinah Holding, Tasnee, Events Investment Fund, Jada (Fund of Funds)
UAE: Mubadala, ADQ, TAQA, ADNOC, AD Ports Group, Abu Dhabi Digital Authority, Department of Finance (Abu Dhabi), Department of Economic Development, Department of Culture & Tourism, Crown Prince Court, Emirates Development Bank
GCC-wide: Accenture, Kearney, Strategy&, PwC, Deloitte, Arthur D. Little, e&, STC, Exinity, SDAIA, AI.f(T)

VOLUME: 70+ C-Suite placements, 120+ N-2, 170+ N-3

Key rules:
- Never criticise the UAE, Saudi Arabia, or any GCC government — this is critical
- Keep messages human and direct, not corporate or AI-sounding
- Never use em-dashes (—). Use commas or full stops instead
- Be concise and actionable
- When drafting messages, reference VSG's relevant client experience naturally — e.g. if talking to someone at a sovereign wealth fund, mention SWF experience; if real estate, mention Red Sea Global or Diriyah
- Match Michael's warm, professional tone — he is well-networked and speaks to senior GCC decision-makers daily`;

    if (contactContext) {
      systemPrompt += `

CONTACT YOU ARE DISCUSSING:
Name: ${contactContext.name || 'Unknown'}
Title: ${contactContext.title || 'Unknown'}
Company: ${contactContext.company || 'Unknown'}
Industry: ${contactContext.industry || 'Unknown'}
Pipeline stage: ${contactContext.stage || 'Unknown'}
Last contacted: ${contactContext.lastContact || 'Unknown'}
Follow-up date: ${contactContext.followupDate || 'Not set'}
LinkedIn: ${contactContext.linkedin || 'Not provided'}
Notes: ${contactContext.notes || 'None'}`;
    }

    if (mode === 'draft_message') {
      systemPrompt += '\n\nThe user wants you to draft a LinkedIn outreach message for this contact. Make it personalised, human, and specific to their role and company. Under 150 words. No em-dashes.';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages || [{ role: 'user', content: 'Hello' }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data.content[0].text }),
    };
  } catch (err) {
    console.error('Chat function error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
