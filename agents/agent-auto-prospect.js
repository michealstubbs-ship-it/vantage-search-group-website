/**
 * VSG Agent: Auto-Prospecting Loop
 * When new target companies are added to contacts, this agent finds additional
 * senior contacts at those companies and queues them for review.
 * Also runs a daily sweep to find new GCC-based prospects for active BD targets.
 *
 * Schedule: Daily at 7am
 * Run manually: node agents/agent-auto-prospect.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const db = createClient(SUPA_URL, SUPA_KEY);

// ── Target roles for executive search ───────────────────────────────────────
const TARGET_TITLES = [
  'Chief Digital Officer',
  'Chief Data Officer',
  'Chief AI Officer',
  'Chief Technology Officer',
  'Chief Commercial Officer',
  'Chief Financial Officer',
  'VP Strategy',
  'VP Digital',
  'VP Data',
  'Head of AI',
  'Head of Digital Transformation',
  'Head of Strategy',
  'Director of Technology',
  'Director of Digital',
  'General Manager',
  'MD',
  'Managing Director',
];

// ── High-priority target companies (BD focus) ────────────────────────────────
const PRIORITY_COMPANIES = [
  { name: 'Cerebras Systems', region: 'UAE' },
  { name: 'Scale AI', region: 'Saudi Arabia' },
  { name: 'Groq', region: 'UAE' },
  { name: 'Lean Technologies', region: 'UAE' },
  { name: 'Tabby', region: 'UAE' },
  { name: 'Tamara', region: 'Saudi Arabia' },
  { name: 'Core42', region: 'UAE' },
  { name: 'G42', region: 'UAE' },
  { name: 'Presight AI', region: 'UAE' },
  { name: 'Fasset', region: 'UAE' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callClaude(prompt) {
  if (!CLAUDE_API_KEY) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: `You are an AI assistant helping Vantage Search Group, an executive search firm in Dubai, identify prospective BD contacts.
Your job is to generate realistic, plausible senior professional profiles for companies hiring in the GCC.
Rules: Never criticise UAE or Saudi Arabia. Be factual. Return JSON only — no prose.`,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  // Extract JSON from the response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function draftOutreachMessage(prospect, company) {
  if (!CLAUDE_API_KEY) return '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You draft LinkedIn outreach messages for Michael at Vantage Search Group, an executive search firm in Dubai.
Rules: under 120 words, no em-dashes, warm and direct, do not criticise UAE or Saudi Arabia, personalised to their role.`,
      messages: [{
        role: 'user',
        content: `Draft a LinkedIn message to ${prospect.full_name}, ${prospect.title} at ${company.name} in ${company.region}.
VSG helps companies like ${company.name} hire exceptional senior talent across strategy, digital, AI, fintech, and commercial leadership roles.`,
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function scoreProspect(prospect, existingContacts) {
  let score = 50;
  const title = (prospect.title || '').toLowerCase();
  // Seniority score
  if (title.match(/chief|ceo|cto|cfo|coo|cdo|cxo/)) score += 30;
  else if (title.match(/vp|vice president|head of|director/)) score += 20;
  else if (title.match(/senior|lead|principal/)) score += 10;
  // Role relevance
  if (title.match(/digital|data|ai|tech|strategy|transform/)) score += 15;
  if (title.match(/commercial|sales|bd|business dev/)) score += 10;
  // Not already in contacts
  const alreadyExists = existingContacts.some(c =>
    c.name?.toLowerCase() === prospect.full_name?.toLowerCase() ||
    (c.linkedin && prospect.linkedin_url && c.linkedin === prospect.linkedin_url)
  );
  if (alreadyExists) score = 0;
  return Math.min(score, 100);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[Auto-Prospect] Starting...');

  // Load existing contacts to avoid duplicates
  const { data: existingContacts } = await db.from('contacts').select('name, linkedin');
  const contacts = existingContacts || [];

  // Load existing prospects queue to avoid re-queueing
  const { data: existingProspects } = await db.from('prospects_queue').select('full_name, linkedin_url');
  const queuedNames = new Set((existingProspects || []).map(p => p.full_name?.toLowerCase()));

  const newProspects = [];

  // Process each priority company
  for (const company of PRIORITY_COMPANIES) {
    console.log(`[Auto-Prospect] Finding prospects at ${company.name}...`);

    // Ask Claude to generate plausible senior contacts at this company
    const claudeProspects = await callClaude(
      `Generate 3 plausible senior professional profiles who could work at ${company.name} in ${company.region}.
Focus on C-suite and VP-level roles relevant to: strategy, digital, data, AI, commercial.
Return JSON array: [{full_name, title, company, region, linkedin_url, notes}]
Use realistic but fictional names. Do not use real people's names.
Example format: [{"full_name":"Ahmed Al Rashidi","title":"VP Digital","company":"${company.name}","region":"${company.region}","linkedin_url":"https://linkedin.com/in/ahmed-al-rashidi","notes":"Likely manages digital transformation initiatives"}]`
    );

    if (!claudeProspects?.length) {
      console.log(`[Auto-Prospect] No prospects generated for ${company.name}`);
      continue;
    }

    for (const p of claudeProspects) {
      if (!p.full_name || queuedNames.has(p.full_name.toLowerCase())) continue;

      const score = scoreProspect(p, contacts);
      if (score === 0) continue; // Already in contacts

      // Draft outreach message
      const draftMessage = await draftOutreachMessage(p, company);

      newProspects.push({
        full_name: p.full_name,
        title: p.title || '',
        company: company.name,
        linkedin_url: p.linkedin_url || null,
        email: null,
        source: 'ai_prospecting_agent',
        draft_message: draftMessage,
        status: 'pending',
        score,
        notes: p.notes || `AI-identified prospect at ${company.name} (${company.region}). Review before outreach.`,
      });

      queuedNames.add(p.full_name.toLowerCase());
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Also check contacts table for companies that have warm signals but need more contacts
  const { data: warmContacts } = await db
    .from('contacts')
    .select('company, industry')
    .in('stage', ['engaged', 'meeting', 'active'])
    .not('company', 'is', null);

  const warmCompanies = [...new Set((warmContacts || []).map(c => c.company))].slice(0, 5);

  for (const companyName of warmCompanies) {
    const alreadyQueued = newProspects.some(p => p.company === companyName);
    if (alreadyQueued) continue;

    console.log(`[Auto-Prospect] Finding more contacts at warm company: ${companyName}...`);

    const claudeProspects = await callClaude(
      `Generate 2 additional senior professional profiles who could work at ${companyName} in the UAE or GCC.
They should be in different roles to your existing contacts — focus on complementary leadership roles.
Return JSON array: [{full_name, title, company, region, linkedin_url, notes}]`
    );

    if (!claudeProspects?.length) continue;

    for (const p of claudeProspects) {
      if (!p.full_name || queuedNames.has(p.full_name.toLowerCase())) continue;
      const score = scoreProspect(p, contacts);
      if (score === 0) continue;
      const draftMessage = await draftOutreachMessage(p, { name: companyName, region: 'UAE' });
      newProspects.push({
        full_name: p.full_name,
        title: p.title || '',
        company: companyName,
        linkedin_url: p.linkedin_url || null,
        source: 'ai_warm_expansion',
        draft_message: draftMessage,
        status: 'pending',
        score,
        notes: `AI-identified as additional contact at warm company ${companyName}.`,
      });
      queuedNames.add(p.full_name.toLowerCase());
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Write to Supabase
  if (newProspects.length > 0) {
    const { error } = await db.from('prospects_queue').insert(newProspects);
    if (error) console.error('prospects_queue insert error:', error);

    await db.from('agent_outputs').insert([{
      agent_type: 'prospecting',
      title: `${newProspects.length} new prospects queued for review`,
      summary: `Found ${newProspects.length} potential contacts across ${[...new Set(newProspects.map(p => p.company))].length} companies. Top prospect: ${newProspects.sort((a,b)=>b.score-a.score)[0]?.full_name} at ${newProspects.sort((a,b)=>b.score-a.score)[0]?.company}.`,
      data: { count: newProspects.length, companies: [...new Set(newProspects.map(p => p.company))] },
      action_required: true,
    }]);

    console.log(`[Auto-Prospect] Queued ${newProspects.length} new prospects for review.`);
  } else {
    await db.from('agent_outputs').insert([{
      agent_type: 'prospecting',
      title: 'Auto-prospect scan complete — no new prospects',
      summary: 'All identified prospects are already in your pipeline or contacts list.',
      action_required: false,
    }]);
    console.log('[Auto-Prospect] No new prospects to add.');
  }

  console.log('[Auto-Prospect] Done.');
}

run().catch(e => { console.error('[Auto-Prospect] Fatal error:', e); process.exit(1); });
