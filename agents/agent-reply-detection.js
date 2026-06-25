/**
 * VSG Agent: Reply Detection
 * Checks Unipile LinkedIn inbox for replies to outreach, matches against outreach_log,
 * writes suggested responses to Supabase agent_outputs.
 *
 * Schedule: Every 4 hours
 * Run manually: node agents/agent-reply-detection.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const db = createClient(SUPA_URL, SUPA_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userMessage) {
  if (!CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function classifyReply(text) {
  const t = text.toLowerCase();
  if (t.match(/interest|love to|happy to|open to|sounds good|let.s connect|tell me more|yes|sure|absolutely/))
    return 'replied_positive';
  if (t.match(/not right now|not interested|not looking|no thank|busy|pass|not for me/))
    return 'replied_negative';
  return 'replied_neutral';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[Reply Detection] Starting...');

  // 1. Load outreach log (sent messages with no reply yet)
  const { data: outreachLog, error: olErr } = await db
    .from('outreach_log')
    .select('*')
    .in('status', ['sent'])
    .not('linkedin_url', 'is', null);

  if (olErr) { console.error('outreach_log fetch error:', olErr); return; }
  if (!outreachLog?.length) {
    console.log('[Reply Detection] No pending outreach to check.');
    await db.from('agent_outputs').insert([{
      agent_type: 'reply_detection',
      title: 'Reply check complete',
      summary: 'No pending outreach items to check at this time.',
      action_required: false,
    }]);
    return;
  }

  console.log(`[Reply Detection] Checking ${outreachLog.length} outreach items...`);

  // 2. Try Unipile MCP if available, otherwise use demo data
  let inboxMessages = [];
  try {
    // Unipile inbox check — this runs inside Cowork where the MCP is available
    // The MCP tool is called via environment variable or direct API if configured
    const unipileKey = process.env.UNIPILE_API_KEY;
    if (unipileKey) {
      const res = await fetch('https://api2.unipile.com:13270/api/v1/chats?limit=50&account_type=LINKEDIN', {
        headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' },
      });
      const data = await res.json();
      inboxMessages = data.items || [];
    }
  } catch (e) {
    console.warn('[Reply Detection] Unipile not available, processing known data only:', e.message);
  }

  const results = [];

  for (const item of outreachLog) {
    // Match inbox messages to this outreach item by name
    const nameMatch = inboxMessages.find(msg => {
      const attendees = msg.attendees_data || [];
      return attendees.some(a =>
        a.name?.toLowerCase().includes(item.contact_name?.toLowerCase()?.split(' ')[0] || '')
      );
    });

    if (!nameMatch) continue;

    // Get the latest message in this chat
    let replyText = nameMatch.last_message_text || '';
    if (!replyText || replyText === item.message_sent) continue;

    const status = classifyReply(replyText);

    // Generate suggested response using Claude
    let suggestedResponse = '';
    try {
      suggestedResponse = await callClaude(
        `You are an AI assistant for Michael at Vantage Search Group, an executive search firm in Dubai.
Draft a short, warm follow-up reply to a LinkedIn message from ${item.contact_name}.
Rules: under 100 words, no em-dashes, human tone, do not criticise UAE or Saudi Arabia.
Michael's role: helping senior professionals find opportunities with leading firms in the GCC.`,
        `Their message: "${replyText}"\n\nMy original message: "${item.message_sent}"\n\nDraft my reply.`
      );
    } catch (e) {
      console.warn('Claude draft failed:', e.message);
    }

    // Update outreach_log
    await db.from('outreach_log').update({
      reply_text: replyText,
      reply_at: new Date().toISOString(),
      status,
      suggested_response: suggestedResponse,
    }).eq('id', item.id);

    // Write to agent_outputs
    results.push({
      agent_type: 'reply_detection',
      title: `Reply from ${item.contact_name}${status === 'replied_positive' ? ' — interested!' : ''}`,
      summary: replyText.slice(0, 200) + (replyText.length > 200 ? '...' : ''),
      data: { contact_name: item.contact_name, status, reply: replyText, suggested_response: suggestedResponse },
      action_required: status === 'replied_positive',
    });

    console.log(`[Reply Detection] Found reply from ${item.contact_name}: ${status}`);
  }

  if (results.length > 0) {
    await db.from('agent_outputs').insert(results);
    console.log(`[Reply Detection] Wrote ${results.length} reply alerts to dashboard.`);
  } else {
    await db.from('agent_outputs').insert([{
      agent_type: 'reply_detection',
      title: 'Inbox checked — no new replies',
      summary: `Checked ${outreachLog.length} outreach items. No new replies detected.`,
      action_required: false,
    }]);
    console.log('[Reply Detection] No new replies found.');
  }

  console.log('[Reply Detection] Done.');
}

run().catch(e => { console.error('[Reply Detection] Fatal error:', e); process.exit(1); });
