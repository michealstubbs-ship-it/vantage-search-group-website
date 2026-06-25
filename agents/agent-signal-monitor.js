/**
 * VSG Agent: Company Signal Monitor
 * Searches for hiring, funding, expansion and leadership news on target companies.
 * Writes signals to Supabase company_signals and agent_outputs.
 *
 * Schedule: Every Monday at 8am
 * Run manually: node agents/agent-signal-monitor.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

const db = createClient(SUPA_URL, SUPA_KEY);

// ── Target companies — update this list as your BD pipeline evolves ──────────
const TARGET_COMPANIES = [
  'Cerebras Systems',
  'Scale AI',
  'Groq',
  'Mistral AI',
  'Core42',
  'G42',
  'Presight AI',
  'Lean Technologies',
  'Tabby',
  'Tamara',
  'Fasset',
  'Rain Financial',
  'Hyperpay',
  'Checkout.com',
  'Mastercard UAE',
  'Visa UAE',
  'ADIB',
  'FAB Digital',
  'Emirates NBD Digital',
  'stc pay',
  'STC Group',
  'Majid Al Futtaim',
  'Chalhoub Group',
  'PIF',
  'Mubadala',
  'ADQ',
  'ADIA',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function searchWeb(query) {
  if (!BRAVE_API_KEY) {
    console.warn('[Signal Monitor] BRAVE_SEARCH_API_KEY not set — using mock data');
    return [];
  }
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=5&freshness=pw`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY } }
    );
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.warn(`Search failed for "${query}":`, e.message);
    return [];
  }
}

async function callClaude(systemPrompt, userMessage) {
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
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

function classifySignal(title, description) {
  const text = (title + ' ' + description).toLowerCase();
  if (text.match(/fund|rais|series|invest|million|billion|unicorn|valuat/)) return 'funding';
  if (text.match(/hir|recruit|talent|headcount|expand.*team|grow.*team|job|position|vac/)) return 'hiring';
  if (text.match(/ceo|cto|cfo|coo|chief|appoint|join.*as|named.*head|new.*director|promo/)) return 'leadership_change';
  if (text.match(/ipo|list|public|stock|shares|nasdaq|tadawul/)) return 'ipo';
  if (text.match(/expan|open.*office|new market|launch|region|enter/)) return 'expansion';
  return 'news';
}

function scoreSignal(type, title) {
  const scores = { funding: 90, ipo: 85, hiring: 75, leadership_change: 70, expansion: 65, news: 40 };
  let score = scores[type] || 40;
  const t = title.toLowerCase();
  if (t.match(/uae|dubai|saudi|riyadh|gcc|gulf|middle east|abu dhabi/)) score += 15;
  if (t.match(/ai|fintech|digital|tech/)) score += 5;
  return Math.min(score, 100);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[Signal Monitor] Starting weekly signal scan...');

  const signals = [];
  const now = new Date().toISOString();

  // Check which companies we've already processed this week to avoid duplicates
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentSignals } = await db
    .from('company_signals')
    .select('company_name, title')
    .gte('created_at', weekAgo);
  const recentTitles = new Set((recentSignals || []).map(s => s.title));

  for (const company of TARGET_COMPANIES) {
    console.log(`[Signal Monitor] Scanning: ${company}`);

    const queries = [
      `${company} hiring GCC 2026`,
      `${company} funding expansion Middle East 2026`,
      `${company} UAE Saudi Arabia news 2026`,
    ];

    for (const q of queries) {
      const results = await searchWeb(q);
      for (const result of results.slice(0, 2)) {
        const title = result.title || '';
        const description = result.description || '';
        if (!title || recentTitles.has(title)) continue;

        const signalType = classifySignal(title, description);
        const importance = scoreSignal(signalType, title + ' ' + description) >= 70 ? 'high' : 'medium';

        // Only add high-relevance signals
        if (importance !== 'high' && signalType === 'news') continue;

        signals.push({
          company_name: company,
          signal_type: signalType,
          title: title.slice(0, 200),
          summary: description.slice(0, 400),
          source_url: result.url || null,
          importance,
          actioned: false,
        });
        recentTitles.add(title);
      }
    }

    // Rate limit — don't hammer the search API
    await new Promise(r => setTimeout(r, 300));
  }

  // If no search API, generate a weekly briefing using Claude from existing contact data
  if (signals.length === 0 && CLAUDE_API_KEY) {
    const { data: contacts } = await db.from('contacts').select('company, stage').not('company', 'is', null);
    const warmCompanies = [...new Set(
      (contacts || []).filter(c => ['engaged','meeting','active'].includes(c.stage)).map(c => c.company)
    )].slice(0, 10);

    const briefing = await callClaude(
      `You are an AI research assistant for Vantage Search Group, an executive search firm in Dubai.
Your job is to produce a concise weekly BD briefing about the GCC tech, fintech and AI market.
Focus on: hiring trends, funding news, company expansions into UAE/Saudi.
Never criticise UAE, Saudi Arabia or any GCC government.
Keep it factual and actionable. Under 200 words.`,
      `Write a brief weekly market briefing for an executive recruiter in Dubai focused on AI and fintech companies.
Warm pipeline companies include: ${warmCompanies.join(', ') || 'various tech/fintech firms'}.
Include any relevant trends about hiring in GCC for senior digital, data, AI, and commercial roles.`
    );

    if (briefing) {
      await db.from('agent_outputs').insert([{
        agent_type: 'signal_monitor',
        title: `Weekly BD Briefing — ${new Date().toLocaleDateString('en-GB', { day:'numeric',month:'short',year:'numeric' })}`,
        summary: briefing,
        action_required: false,
      }]);
      console.log('[Signal Monitor] Wrote weekly briefing (no search API configured).');
      return;
    }
  }

  // Write signals to Supabase
  if (signals.length > 0) {
    const { error } = await db.from('company_signals').insert(signals);
    if (error) console.error('company_signals insert error:', error);

    // Write a summary to agent_outputs
    const highSignals = signals.filter(s => s.importance === 'high');
    await db.from('agent_outputs').insert([{
      agent_type: 'signal_monitor',
      title: `Weekly scan: ${signals.length} signals found across ${TARGET_COMPANIES.length} companies`,
      summary: highSignals.length > 0
        ? `High priority: ${highSignals.slice(0, 3).map(s => s.company_name + ' — ' + s.signal_type).join('; ')}`
        : `${signals.length} medium-priority signals detected. Check Companies tab for details.`,
      data: { total: signals.length, high: highSignals.length, companies_scanned: TARGET_COMPANIES.length },
      action_required: highSignals.length > 0,
    }]);

    console.log(`[Signal Monitor] Wrote ${signals.length} signals (${highSignals.length} high priority).`);
  } else {
    await db.from('agent_outputs').insert([{
      agent_type: 'signal_monitor',
      title: 'Weekly signal scan complete — no new signals',
      summary: `Scanned ${TARGET_COMPANIES.length} companies. No new high-priority signals this week.`,
      action_required: false,
    }]);
    console.log('[Signal Monitor] No new signals this week.');
  }

  console.log('[Signal Monitor] Done.');
}

run().catch(e => { console.error('[Signal Monitor] Fatal error:', e); process.exit(1); });
