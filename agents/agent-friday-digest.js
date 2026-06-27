/**
 * VSG Agent: Friday BD Performance Digest
 * Pulls this week's outcomes, signals actioned, new connections, and meetings booked.
 * Sends a concise BD performance summary to agent_outputs (surfaces on dashboard).
 *
 * Schedule: Every Friday at 4pm
 * Run manually: node agents/agent-friday-digest.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const db = createClient(SUPA_URL, SUPA_KEY);

async function callClaude(system, user) {
  if (!CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system, messages: [{ role: 'user', content: user }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function run() {
  console.log('[Friday Digest] Building weekly BD summary...');
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const weekAgoDate = weekAgo.slice(0, 10);

  // Pull this week's data in parallel
  const [outcomesRes, signalsRes, connectionsRes, actionsRes] = await Promise.all([
    db.from('outcomes').select('*').gte('created_at', weekAgo),
    db.from('company_signals').select('company_name, signal_type, title').eq('actioned', true).gte('created_at', weekAgo),
    db.from('linkedin_outreach').select('full_name, company, status, date_connected').gte('date_connected', weekAgoDate),
    db.from('todays_actions').select('*').gte('created_at', weekAgo).limit(1)
  ]);

  const outcomes = outcomesRes.data || [];
  const signalsActioned = signalsRes.data || [];
  const newConnections = connectionsRes.data || [];

  const meetings = outcomes.filter(o => o.outcome === 'meeting_booked');
  const replies = outcomes.filter(o => o.outcome === 'replied');
  const mandates = outcomes.filter(o => o.outcome === 'mandate_won');

  // Build data summary for Claude
  const summaryData = `
WEEK IN NUMBERS:
- Meetings booked: ${meetings.length}${meetings.length ? ' (' + meetings.map(o => o.contact_name + ' at ' + (o.company || '?')).join(', ') + ')' : ''}
- Replies received: ${replies.length}${replies.length ? ' (' + replies.map(o => o.contact_name).join(', ') + ')' : ''}
- Mandates won: ${mandates.length}
- Signals actioned: ${signalsActioned.length}
- New LinkedIn connections: ${newConnections.length}${newConnections.length ? ' (' + newConnections.slice(0, 3).map(c => c.full_name).join(', ') + (newConnections.length > 3 ? '...' : '') + ')' : ''}
- Total outcomes logged: ${outcomes.length}
`;

  let narrative = '';
  try {
    narrative = await callClaude(
      `You are writing Michael Stubbs' Friday BD performance digest at Vantage Search Group, a boutique executive search firm in Dubai. Be honest and direct — celebrate wins, flag if a week was quiet, and give one specific recommendation for next week. Tone: like a smart colleague giving a frank Friday debrief. Under 150 words. No em-dashes. Never criticise UAE, Saudi, or any GCC government.`,
      `Write this week's BD performance summary based on:\n${summaryData}\nInclude: a headline verdict on the week, 2-3 specific observations, and one concrete recommendation for next week.`
    );
  } catch (e) {
    narrative = `Week summary: ${meetings.length} meetings booked, ${replies.length} replies, ${newConnections.length} new connections, ${signalsActioned.length} signals worked.`;
  }

  await db.from('agent_outputs').insert({
    agent_type: 'friday_digest',
    title: `BD Week in Review — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    summary: narrative + `\n\n📊 By the numbers:\n${meetings.length} meetings · ${replies.length} replies · ${mandates.length} mandates · ${newConnections.length} new connections · ${signalsActioned.length} signals actioned`,
    action_required: false,
    data: {
      meetings: meetings.length,
      replies: replies.length,
      mandates: mandates.length,
      connections: newConnections.length,
      signals_actioned: signalsActioned.length,
      week_ending: new Date().toISOString().slice(0, 10)
    }
  });

  console.log(`[Friday Digest] Done — ${meetings.length} meetings, ${replies.length} replies, ${newConnections.length} connections this week.`);
}

run().catch(e => { console.error('[Friday Digest] Fatal:', e); process.exit(1); });
