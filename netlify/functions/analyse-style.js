// analyse-style.js
// Reads sent LinkedIn outreach messages, extracts writing style with Claude, saves to annie_memory

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const SUPA_HDR = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  if (!CLAUDE_KEY) return {
    statusCode: 500,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' })
  };

  try {
    // Fetch up to 40 sent outreach messages that have a custom_welcome_msg
    const msgRes = await fetch(
      `${SUPA_URL}/rest/v1/linkedin_outreach?select=full_name,company,custom_welcome_msg&custom_welcome_msg=not.is.null&order=date_connected.desc&limit=40`,
      { headers: SUPA_HDR }
    );
    if (!msgRes.ok) throw new Error('Could not fetch messages from Supabase (HTTP ' + msgRes.status + ')');
    const messages = await msgRes.json();

    // Filter out blanks and very short messages
    const valid = (messages || []).filter(m => m.custom_welcome_msg && m.custom_welcome_msg.trim().length > 40);

    if (valid.length < 3) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: `Only ${valid.length} sent messages found in the system. At least 3 are needed to build a style profile.`
        })
      };
    }

    // Format for Claude — take up to 25 messages
    const sample = valid.slice(0, 25);
    const msgBlock = sample.map((m, i) =>
      `[Message ${i + 1}${m.full_name ? ' to ' + m.full_name : ''}${m.company ? ' at ' + m.company : ''}]\n${m.custom_welcome_msg.trim()}`
    ).join('\n\n---\n\n');

    // Ask Claude to extract a style profile
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are analysing LinkedIn outreach messages written by a senior recruitment consultant in the GCC. Your job is to extract a precise style guide that another AI can use to write new messages that sound exactly like this person — not generic, not corporate, genuinely like them.

Study these messages carefully and write a style profile covering:
- Greeting and pleasantry style (how they open, exact phrasing)
- Sentence length and rhythm
- Tone (warm, formal, direct, soft — be specific)
- How they introduce themselves and their firm
- How they connect to the prospect (research, credentials, specific entities they name)
- How they close and what their ask looks like
- Phrases they consistently use or avoid
- Any distinctive patterns worth replicating

Be specific. Quote examples from the messages where helpful. Keep it under 200 words.

MESSAGES:
${msgBlock}`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude API error: ' + claudeRes.status);
    const claudeData = await claudeRes.json();
    const styleProfile = claudeData.content?.[0]?.text?.trim();
    if (!styleProfile) throw new Error('No style profile returned from Claude');

    // Upsert into annie_memory (key = style_rules)
    const checkRes = await fetch(`${SUPA_URL}/rest/v1/annie_memory?key=eq.style_rules`, { headers: SUPA_HDR });
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      await fetch(`${SUPA_URL}/rest/v1/annie_memory?key=eq.style_rules`, {
        method: 'PATCH',
        headers: SUPA_HDR,
        body: JSON.stringify({ value: styleProfile })
      });
    } else {
      await fetch(`${SUPA_URL}/rest/v1/annie_memory`, {
        method: 'POST',
        headers: SUPA_HDR,
        body: JSON.stringify({ key: 'style_rules', value: styleProfile })
      });
    }

    // Also update the firm_settings writing_style field if firm_id provided
    try {
      const { firm_id } = JSON.parse(event.body || '{}');
      if (firm_id) {
        await fetch(`${SUPA_URL}/rest/v1/firm_settings?firm_id=eq.${firm_id}`, {
          method: 'PATCH',
          headers: SUPA_HDR,
          body: JSON.stringify({ writing_style: styleProfile, updated_at: new Date().toISOString() })
        });
      }
    } catch (_) { /* firm_id optional — ignore */ }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, style: styleProfile, messages_analysed: sample.length })
    };

  } catch (err) {
    console.error('analyse-style error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
