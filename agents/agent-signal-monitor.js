/**
 * VSG Agent: Company Signal Monitor
 * Searches for hiring, funding, expansion and leadership news on target companies.
 * Enriches each signal with a role-matched contact (CTO for tech signals, CFO for finance, etc.)
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

// ── Role mapping by signal type and keyword ───────────────────────────────────
// Returns the most commercially relevant title to search for given a signal
function getRoleTarget(signalType, title, description) {
  const text = (title + ' ' + description).toLowerCase();

  if (signalType === 'hiring') {
    // Match the hiring function to the right senior buyer
    if (text.match(/engineer|tech|software|data|ai|ml|platform|infrastructure|devops|cloud/))
      return 'Chief Technology Officer OR VP Engineering OR Head of Engineering';
    if (text.match(/finance|cfo|treasury|risk|compliance|audit/))
      return 'CFO OR Chief Financial Officer OR VP Finance';
    if (text.match(/product|design|ux|ui/))
      return 'Chief Product Officer OR VP Product OR Head of Product';
    if (text.match(/commercial|sales|revenue|growth|business development/))
      return 'Chief Commercial Officer OR VP Sales OR Head of Business Development';
    if (text.match(/operations|ops|supply chain|logistics/))
      return 'COO OR Chief Operating Officer OR VP Operations';
    if (text.match(/people|hr|talent|human resources/))
      return 'Chief People Officer OR VP People OR Head of Talent';
    // Generic hiring — go for the COO or CEO as decision maker
    return 'COO OR CEO OR Chief Operating Officer';
  }

  if (signalType === 'funding' || signalType === 'ipo') {
    return 'CFO OR Chief Financial Officer OR CEO';
  }

  if (signalType === 'leadership_change') {
    return 'CEO OR Managing Director OR Country Manager';
  }

  if (signalType === 'expansion') {
    return 'CEO OR COO OR Country Manager OR Regional Director';
  }

  return 'CEO OR Managing Director OR Chief Executive';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function searchWeb(query, type = 'news') {
  if (!BRAVE_API_KEY) {
    console.warn('[Signal Monitor] BRAVE_SEARCH_API_KEY not set — skipping search');
    return [];
  }
  try {
    const endpoint = type === 'web'
      ? `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`
      : `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=5&freshness=pw`;
    const res = await fetch(endpoint, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY },
    });
    const data = await res.json();
    return type === 'web' ? (data.web?.results || []) : (data.results || []);
  } catch (e) {
    console.warn(`Search failed for "${query}":`, e.message);
    return [];
  }
}

async function callClaude(systemPrompt, userMessage, maxTokens = 400) {
  if (!CLAUDE_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (e) {
    console.warn('[Signal Monitor] Claude call failed:', e.message);
    return null;
  }
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

// ── Role-matched contact enrichment ──────────────────────────────────────────
// Searches for the most relevant senior person at a company given the signal type,
// then uses Claude to extract their name, title, and LinkedIn URL from search snippets.
async function findRoleMatchedContact(company, signalType, signalTitle, signalDescription) {
  if (!BRAVE_API_KEY || !CLAUDE_API_KEY) return null;

  const roleQuery = getRoleTarget(signalType, signalTitle, signalDescription);
  const searchQuery = `${company} ${roleQuery} LinkedIn site:linkedin.com/in OR site:${company.toLowerCase().replace(/\s+/g, '')}.com/team`;

  console.log(`[Signal Monitor] Finding role-matched contact for ${company} (${signalType}): ${roleQuery}`);

  const results = await searchWeb(searchQuery, 'web');
  if (!results.length) return null;

  const snippets = results.slice(0, 4).map(r =>
    `Title: ${r.title || ''}\nURL: ${r.url || ''}\nSnippet: ${r.description || ''}`
  ).join('\n\n');

  const extracted = await callClaude(
    `You are extracting a specific person's details from web search results.
Return ONLY a JSON object with these exact keys: name, title, linkedin_url.
- name: their full name (string or null)
- title: their job title (string or null)
- linkedin_url: their LinkedIn profile URL starting with https://www.linkedin.com/in/ (string or null)
If you cannot find a real named person with confidence, return {"name":null,"title":null,"linkedin_url":null}.
Return ONLY the JSON. No explanation. No markdown.`,
    `Company: ${company}
Looking for: ${roleQuery}
Signal context: ${signalTitle}

Search results:
${snippets}

Extract the most senior relevant person's details.`
  );

  if (!extracted) return null;

  try {
    const cleaned = extracted.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.name) return null;
    console.log(`[Signal Monitor] Found: ${parsed.name} (${parsed.title}) at ${company}`);
    return {
      name: parsed.name || null,
      title: parsed.title || null,
      linkedin_url: parsed.linkedin_url || null,
    };
  } catch (e) {
    console.warn(`[Signal Monitor] Could not parse contact JSON for ${company}:`, e.message);
    return null;
  }
}

// ── Monitoring rules: check user-defined watch rules for named contacts ───────
// Called at the end of each run. For each active rule, searches for the trigger
// (e.g. "Anas moved company") and fires a signal + Today's Action if found.
async function checkMonitoringRules() {
  if (!BRAVE_API_KEY || !CLAUDE_API_KEY) return;

  const { data: rules, error } = await db
    .from('monitoring_rules')
    .select('*')
    .eq('active', true);

  if (error || !rules || rules.length === 0) {
    console.log('[Signal Monitor] No active monitoring rules to check.');
    return;
  }

  console.log(`[Signal Monitor] Checking ${rules.length} monitoring rules...`);

  for (const rule of rules) {
    try {
      // Search for the specific trigger
      const query = `${rule.contact_name}${rule.company ? ' ' + rule.company : ''} ${rule.watch_for}`;
      const results = await searchWeb(query, 'web');
      const newsResults = await searchWeb(query, 'news');
      const allResults = [...results.slice(0, 3), ...newsResults.slice(0, 2)];

      if (allResults.length === 0) {
        await db.from('monitoring_rules').update({ last_checked_at: new Date().toISOString() }).eq('id', rule.id);
        continue;
      }

      const snippets = allResults.map(r => `${r.title || ''}: ${r.description || r.snippet || ''}`).join('\n');

      // Ask Claude: has the trigger actually fired?
      const assessment = await callClaude(
        `You are assessing whether a specific monitoring trigger has been met based on search results.
Return ONLY a JSON object: {"triggered": true/false, "evidence": "<one sentence of what you found, or null if not triggered>"}
No markdown. No explanation.`,
        `MONITORING RULE:
Person: ${rule.contact_name}
Company: ${rule.company || 'Unknown'}
Watch for: ${rule.watch_for}
Trigger description: ${rule.trigger_description || rule.watch_for}

SEARCH RESULTS:
${snippets}

Has the trigger been met? Only return triggered:true if there is clear evidence in the search results.`
      );

      await db.from('monitoring_rules').update({ last_checked_at: new Date().toISOString() }).eq('id', rule.id);

      if (!assessment) continue;
      const cleaned = assessment.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.triggered && parsed.evidence) {
        console.log(`[Signal Monitor] 🚨 Monitoring rule triggered: ${rule.contact_name} — ${parsed.evidence}`);

        // Write a company signal
        await db.from('company_signals').insert([{
          company_name: rule.company || rule.contact_name,
          signal_type: 'monitoring_rule',
          title: `Watch alert: ${rule.contact_name} — ${rule.watch_for}`,
          summary: `${parsed.evidence}\n\nOriginal rule: ${rule.watch_for}${rule.trigger_description ? ' | ' + rule.trigger_description : ''}`,
          importance: 'high',
          actioned: false,
          named_contact: rule.contact_name,
          named_contact_linkedin: rule.linkedin_url || null,
        }]);

        // Update rule — increment trigger count, record when
        await db.from('monitoring_rules').update({
          triggered_at: new Date().toISOString(),
          trigger_count: (rule.trigger_count || 0) + 1,
        }).eq('id', rule.id);
      }
    } catch (e) {
      console.warn(`[Signal Monitor] Error checking rule for ${rule.contact_name}:`, e.message);
    }

    await new Promise(r => setTimeout(r, 400));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[Signal Monitor] Starting weekly signal scan...');

  const signals = [];

  // Check which companies we've already processed this week to avoid duplicates
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fortnightAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentSignals } = await db
    .from('company_signals')
    .select('company_name, signal_type, title, actioned')
    .gte('created_at', weekAgo);
  const recentTitles = new Set((recentSignals || []).map(s => s.title));

  // Also check recently actioned signals (14 days) — don't re-surface same company+type
  const { data: actionedSignals } = await db
    .from('company_signals')
    .select('company_name, signal_type')
    .eq('actioned', true)
    .gte('created_at', fortnightAgo);
  const recentlyActioned = new Set(
    (actionedSignals || []).map(s => `${(s.company_name||'').toLowerCase()}::${s.signal_type}`)
  );
  console.log(`[Signal Monitor] ${recentTitles.size} recent titles, ${recentlyActioned.size} recently-actioned combos to skip`);

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

        // Skip if same company+type was already actioned within 14 days
        const actionedKey = `${company.toLowerCase()}::${signalType}`;
        if (recentlyActioned.has(actionedKey)) {
          console.log(`[Signal Monitor] Skipping ${company} (${signalType}) — actioned recently`);
          continue;
        }

        // Enrich with role-matched contact
        const contact = await findRoleMatchedContact(company, signalType, title, description);

        signals.push({
          company_name: company,
          signal_type: signalType,
          title: title.slice(0, 200),
          summary: description.slice(0, 400),
          source_url: result.url || null,
          importance,
          actioned: false,
          named_contact: contact?.name || null,
          named_contact_title: contact?.title || null,
          named_contact_linkedin: contact?.linkedin_url || null,
        });
        recentTitles.add(title);
      }
    }

    // Rate limit — don't hammer the search API
    await new Promise(r => setTimeout(r, 400));
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

    const enriched = signals.filter(s => s.named_contact).length;
    const highSignals = signals.filter(s => s.importance === 'high');
    await db.from('agent_outputs').insert([{
      agent_type: 'signal_monitor',
      title: `Weekly scan: ${signals.length} signals found, ${enriched} with role-matched contacts`,
      summary: highSignals.length > 0
        ? `High priority: ${highSignals.slice(0, 3).map(s => s.company_name + ' — ' + s.signal_type + (s.named_contact ? ' (contact: ' + s.named_contact + ')' : '')).join('; ')}`
        : `${signals.length} signals detected. Check Companies tab for details.`,
      data: { total: signals.length, high: highSignals.length, enriched, companies_scanned: TARGET_COMPANIES.length },
      action_required: highSignals.length > 0,
    }]);

    console.log(`[Signal Monitor] Wrote ${signals.length} signals (${highSignals.length} high priority, ${enriched} enriched with contacts).`);
  } else {
    await db.from('agent_outputs').insert([{
      agent_type: 'signal_monitor',
      title: 'Weekly signal scan complete — no new signals',
      summary: `Scanned ${TARGET_COMPANIES.length} companies. No new high-priority signals this week.`,
      action_required: false,
    }]);
    console.log('[Signal Monitor] No new signals this week.');
  }

  // ── Check user-defined monitoring rules (always runs, after main scan) ──────
  await checkMonitoringRules();

  console.log('[Signal Monitor] Done.');
}

run().catch(e => { console.error('[Signal Monitor] Fatal error:', e); process.exit(1); });
