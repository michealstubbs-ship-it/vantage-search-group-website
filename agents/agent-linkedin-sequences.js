/**
 * VSG Agent: LinkedIn Sequence Automation
 * After a connection is accepted, auto-generates a 3-touch follow-up sequence:
 *   Day 1  — warm welcome message
 *   Day 14 — value-add (relevant insight or article)
 *   Day 30 — soft ask
 *
 * Messages are written to linkedin_outreach.custom_welcome_msg and flagged pending_send.
 * Michael reviews and approves before anything is sent.
 *
 * Schedule: Nightly at 1:30am (runs after the main outreach agent)
 * Run manually: node agents/agent-linkedin-sequences.js
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
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system, messages: [{ role: 'user', content: user }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function run() {
  console.log('[LinkedIn Sequences] Starting...');
  const today = new Date().toISOString().slice(0, 10);

  // Load connected contacts with no welcome_sent yet (Day 1 welcome)
  const { data: newConnections } = await db
    .from('linkedin_outreach')
    .select('*')
    .eq('status', 'connected')
    .is('welcome_sent', null)
    .not('date_connected', 'is', null);

  for (const c of newConnections || []) {
    console.log(`[Sequences] Day 1 welcome for ${c.full_name}`);
    try {
      const msg = await callClaude(
        `You are writing a LinkedIn welcome message on behalf of Michael Stubbs at Vantage Search Group, a boutique executive search firm in Dubai. Michael has just connected with this person. The message should be warm, specific, short (under 50 words), and feel human — not like a sales pitch. No em-dashes. Never say "I'd love to connect" (they're already connected). Never mention VSG's track record or boast about placements.`,
        `Write a brief welcome message to ${c.full_name}${c.title ? ', ' + c.title : ''}${c.company ? ' at ' + c.company : ''}. Acknowledge the connection, show genuine curiosity about their work, and end with an easy open question. Source of connection: ${c.source || 'LinkedIn outreach'}.`
      );
      await db.from('linkedin_outreach').update({
        custom_welcome_msg: msg,
        welcome_sent: today,
        notes: (c.notes || '') + `\n[Day 1 welcome queued ${today}]`
      }).eq('id', c.id);
      // Surface in company_signals so Today's Actions picks it up for review
      await db.from('company_signals').insert({
        company_name: c.company || 'LinkedIn',
        signal_type: 'news',
        title: `Review welcome message for ${c.full_name} (new connection)`,
        summary: `Draft welcome message ready for your review:\n\n"${msg}"\n\nCONTACT: ${c.full_name}${c.title ? ', ' + c.title : ''}`,
        importance: 'high',
        actioned: false
      });
    } catch (e) { console.error(`Day 1 error for ${c.full_name}:`, e.message); }
    await new Promise(r => setTimeout(r, 500));
  }

  // Day 14 — value add (connections with welcome_sent 14 days ago, no follow_up_sent)
  const d14ago = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: day14 } = await db
    .from('linkedin_outreach')
    .select('*')
    .eq('status', 'connected')
    .eq('welcome_sent', d14ago)
    .is('follow_up_sent', null);

  for (const c of day14 || []) {
    console.log(`[Sequences] Day 14 value-add for ${c.full_name}`);
    try {
      const msg = await callClaude(
        `You are writing a Day 14 LinkedIn follow-up on behalf of Michael Stubbs at Vantage Search Group. This is a value-add message — share a relevant insight, observation, or piece of intel about the GCC market that would genuinely be useful to this person. Under 60 words. No pitch. No em-dashes. End with a soft open question about their priorities.`,
        `Write a Day 14 follow-up message to ${c.full_name}${c.title ? ', ' + c.title : ''}${c.company ? ' at ' + c.company : ''}. Focus on something relevant to their sector in the GCC. Make it feel like a useful note from someone who follows the market, not a sales touchpoint.`
      );
      await db.from('linkedin_outreach').update({ follow_up_sent: today }).eq('id', c.id);
      await db.from('company_signals').insert({
        company_name: c.company || 'LinkedIn',
        signal_type: 'news',
        title: `Review Day 14 follow-up for ${c.full_name}`,
        summary: `Draft Day 14 value-add message:\n\n"${msg}"\n\nCONTACT: ${c.full_name}${c.title ? ', ' + c.title : ''}`,
        importance: 'medium',
        actioned: false
      });
    } catch (e) { console.error(`Day 14 error for ${c.full_name}:`, e.message); }
    await new Promise(r => setTimeout(r, 500));
  }

  // Day 30 — soft ask (connections with welcome_sent 30 days ago, follow_up_sent not null, no reply)
  const d30ago = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { data: day30 } = await db
    .from('linkedin_outreach')
    .select('*')
    .eq('status', 'connected')
    .eq('welcome_sent', d30ago)
    .not('follow_up_sent', 'is', null)
    .is('date_replied', null);

  for (const c of day30 || []) {
    console.log(`[Sequences] Day 30 soft ask for ${c.full_name}`);
    try {
      const msg = await callClaude(
        `You are writing a Day 30 LinkedIn soft ask on behalf of Michael Stubbs at Vantage Search Group. This is the third and final touch. It should be warm, natural, and make a soft ask about their hiring plans or whether it makes sense to have a brief conversation. Under 55 words. Specific, curious, no corporate language. No em-dashes. No boasting about VSG.`,
        `Write a Day 30 soft ask to ${c.full_name}${c.title ? ', ' + c.title : ''}${c.company ? ' at ' + c.company : ''}. Reference that you've connected and been in touch. Ask if they have any senior hiring on the horizon or if it makes sense to find 15 minutes. Keep it light.`
      );
      await db.from('company_signals').insert({
        company_name: c.company || 'LinkedIn',
        signal_type: 'news',
        title: `Review Day 30 soft ask for ${c.full_name}`,
        summary: `Draft Day 30 soft ask message:\n\n"${msg}"\n\nCONTACT: ${c.full_name}${c.title ? ', ' + c.title : ''}`,
        importance: 'high',
        actioned: false
      });
    } catch (e) { console.error(`Day 30 error for ${c.full_name}:`, e.message); }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[LinkedIn Sequences] Done. Day 1: ${(newConnections||[]).length}, Day 14: ${(day14||[]).length}, Day 30: ${(day30||[]).length}`);
}

run().catch(e => { console.error('[LinkedIn Sequences] Fatal:', e); process.exit(1); });
