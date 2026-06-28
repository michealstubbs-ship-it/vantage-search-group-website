/**
 * VSG Agent: Dormant Reactivation
 * Finds warm contacts (engaged/meeting/active stage) untouched for 90+ days,
 * generates personalised re-engagement messages and surfaces them in Today's Actions.
 *
 * Schedule: Every Monday at 7am
 * Run manually: node agents/agent-dormant-reactivation.js
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
  console.log('[Dormant Reactivation] Starting weekly scan...');
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

  const { data: dormant } = await db
    .from('contacts')
    .select('id, name, title, company, stage, last_contact, notes, linkedin')
    .in('stage', ['engaged', 'meeting', 'active', 'followup'])
    .lt('last_contact', cutoff)
    .order('last_contact', { ascending: true })
    .limit(20);

  if (!dormant || dormant.length === 0) {
    console.log('[Dormant Reactivation] No dormant contacts found.');
    return;
  }

  console.log(`[Dormant Reactivation] Found ${dormant.length} dormant contacts`);

  for (const c of dormant) {
    const daysSince = Math.floor((Date.now() - new Date(c.last_contact)) / 864e5);
    console.log(`  → ${c.name} (${c.company}) — ${daysSince}d since last contact`);
    try {
      const msg = await callClaude(
        `You are writing a re-engagement message on behalf of Michael Stubbs at Vantage Search Group, a boutique executive search firm in Dubai. This is a warm contact who has gone quiet. The message should feel natural and personal — like picking up where you left off, not a cold restart. Under 55 words. Specific, curious, no corporate language. No em-dashes. No mention of how long it's been. End with an easy open question.`,
        `Write a re-engagement message to ${c.name}, ${c.title || 'senior professional'} at ${c.company || 'their company'}. Last stage was "${c.stage}" — they were a warm contact. Context/notes: ${c.notes ? c.notes.slice(0, 200) : 'No notes on file'}. Make it feel like a genuine check-in.`
      );
      await db.from('company_signals').insert({
        company_name: c.company || c.name,
        signal_type: 'news',
        title: `Re-engage ${c.name} — dormant ${daysSince} days`,
        summary: `${c.name} (${c.stage} stage) has been quiet for ${daysSince} days. Re-engagement draft:\n\n"${msg}"\n\nLast contact: ${c.last_contact}. CONTACT: ${c.name}, ${c.title || ''} at ${c.company || ''}`,
        importance: daysSince > 120 ? 'high' : 'medium',
        actioned: false
      });
    } catch (e) { console.error(`Error for ${c.name}:`, e.message); }
    await new Promise(r => setTimeout(r, 600));
  }

  // Summary to agent_outputs
  await db.from('agent_outputs').insert({
    agent_type: 'dormant_reactivation',
    title: `Dormant reactivation: ${dormant.length} contacts flagged`,
    summary: `${dormant.length} warm contacts haven't been touched in 90+ days. Re-engagement messages drafted and queued in Today's Actions for review. Top dormant: ${dormant.slice(0, 3).map(c => c.name + ' (' + Math.floor((Date.now() - new Date(c.last_contact)) / 864e5) + 'd)').join(', ')}`,
    action_required: true,
    data: { count: dormant.length, cutoff_days: 90 }
  });

  console.log(`[Dormant Reactivation] Done — ${dormant.length} contacts queued.`);
}

run().catch(e => { console.error('[Dormant Reactivation] Fatal:', e); process.exit(1); });
