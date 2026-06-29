// VSG AI Chat — Netlify Serverless Function v5
// Proxies requests to Claude API with contact context injected
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
    if (systemOverride) {
      const model = modelOverride || 'claude-sonnet-4-6';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens || 2048, system: systemOverride, messages: messages || [{ role: 'user', content: 'Generate now.' }] }),
      });
      if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
      const d = await r.json();
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: d.content[0].text }) };
    }
    let systemPrompt = 'You are an AI BD assistant for Michael Stubbs, Founder and Managing Partner of Vantage Search Group - a boutique executive search firm headquartered in Dubai, operating across the GCC.\n\nABOUT VSG:\nVSG runs retained, partner-led executive search mandates. Michael works directly on every mandate. 98% conversion rate on retained assignments, 90%+ client retention over five years.\n\nSECTORS VSG RECRUITS INTO:\n- Public Sector & Government (Abu Dhabi and KSA government entities, regulators, development authorities)\n- Sovereign Wealth & Investment (Mubadala, PIF, ADNOC, ADQ, Emirates Development Bank, Jada - VSG has worked with 8 of the GCC top 10 sovereign wealth funds)\n- Energy & Natural Resources (TAQA, ACWA Power, ADNOC)\n- Real Estate & Development (DAMAC, Red Sea Global, Diriyah Gate Development Authority, Rua Al Madinah Holding, Remat Al-Riyadh, Royal Commission for AlUla)\n- Consulting & Advisory (McKinsey, BCG, Bain & Company, Accenture, Kearney, Strategy&, Arthur D. Little, PwC, Deloitte, EY, KPMG, FTI Consulting, Delta Partners, Monitor Deloitte, Devoteam)\n- FinTech & Financial Services (Exinity, e&, STC, Queensgate Investments)\n- Technology & Digital (SDAIA, Abu Dhabi Digital Authority, STC)\n\nFUNCTIONAL ROLES: Investment & M&A, Strategy & Transformation, Digital, Data & AI, Public Policy, PMO, Finance & Treasury, Commercial & BD, C-Suite and Board\n\nPAST CLIENTS:\nKSA: PIF, Red Sea Global, Diriyah Gate, Royal Commission for AlUla, ACWA Power, Remat Al-Riyadh, Rua Al Madinah, Tasnee, Events Investment Fund, Jada\nUAE: Mubadala, ADQ, TAQA, ADNOC, AD Ports, Abu Dhabi Digital Authority, Department of Finance, Department of Economic Development, Crown Prince Court, Emirates Development Bank\nGCC-wide: McKinsey, BCG, Bain, Accenture, Kearney, Strategy&, PwC, Deloitte, EY, KPMG, FTI Consulting, Delta Partners, Monitor Deloitte, e&, STC, Exinity, SDAIA\n\nVOLUME: 70+ C-Suite placements, 120+ N-2, 170+ N-3\n\nKey rules:\n- Never criticise the UAE, Saudi Arabia, or any GCC government\n- Keep messages human and direct, not corporate or AI-sounding\n- Never use em-dashes. Use commas or full stops instead\n- Be concise and actionable\n- Reference VSG client experience naturally when relevant\n- Match Michael warm, professional tone';
    if (contactContext) {
      systemPrompt += '\n\nCONTACT YOU ARE DISCUSSING:\nName: ' + (contactContext.name||'Unknown') + '\nTitle: ' + (contactContext.title||'Unknown') + '\nCompany: ' + (contactContext.company||'Unknown') + '\nIndustry: ' + (contactContext.industry||'Unknown') + '\nPipeline stage: ' + (contactContext.stage||'Unknown') + '\nLast contacted: ' + (contactContext.lastContact||'Unknown') + '\nLinkedIn: ' + (contactContext.linkedin||'Not provided') + '\nNotes: ' + (contactContext.notes||'None');
    }
    if (mode === 'draft_message') systemPrompt += '\n\nDraft a LinkedIn outreach message for this contact. Personalised, human, specific to their role. Under 150 words. No em-dashes.';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, system: systemPrompt, messages: messages || [{ role: 'user', content: 'Hello' }] }),
    });
    if (!r.ok) { const e = await r.text(); throw new Error('Claude API error: ' + r.status + ' - ' + e); }
    const d = await r.json();
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: d.content[0].text }) };
  } catch (err) {
    console.error('Chat function error:', err);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
