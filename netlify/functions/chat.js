// VSG AI Chat — Netlify Serverless Function
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
    const { messages, contactContext, mode } = JSON.parse(event.body || '{}');

    // Build system prompt with injected context
    let systemPrompt = `You are an AI BD assistant for Michael at Vantage Search Group, a boutique executive search firm in the GCC (UAE, Saudi Arabia, Qatar).

Michael recruits senior professionals for: strategy, transformation, digital, data & AI, investments, commercial, PMO — primarily for financial institutions, sovereign wealth funds, fintech companies, and AI firms across the GCC.

Key rules:
- Never criticise the UAE, Saudi Arabia, or any GCC government — this is critical
- Keep messages human and direct, not corporate or AI-sounding
- Never use em-dashes (—). Use commas or full stops instead
- Be concise and actionable
- When drafting messages, match Michael's warm, professional tone`;

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
