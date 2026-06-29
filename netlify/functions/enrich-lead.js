// enrich-lead.js — all sources run in parallel with 6s timeout each
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const UNIPILE_KEY = process.env.UNIPILE_API_KEY || 'zMwbwlhB.myGGJ3jwk5K0gRuagit2tBK6o8NIGlHISDyoWDgHoJo=';
const UNIPILE_BASE = process.env.UNIPILE_BASE_URL || 'https://api53.unipile.com:18305';
const UNIPILE_ACCOUNT = process.env.UNIPILE_ACCOUNT_ID || 'eFhbX6emR-68eQkgzPq77g';
const APOLLO_KEY = process.env.APOLLO_API_KEY;

// Fetch with auto-abort after ms milliseconds
function fetchWithTimeout(url, options, ms = 6000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .then(r => { clearTimeout(id); return r; })
    .catch(e => { clearTimeout(id); throw e; });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const body = JSON.parse(event.body || '{}');
  const { name, company, title, linkedin_url, company_domain } = body;
  if (!name && !company) return { statusCode: 200, headers, body: JSON.stringify({ context: '' }) };

  const identifier = extractLinkedInIdentifier(linkedin_url);
  const companySlug = company ? company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;
  const firstName = (name || '').split(' ')[0].toLowerCase();

  const [profileResult, companyResult, peopleResult, apolloResult, newsResult, jobsResult] = await Promise.allSettled([
    // 1. Unipile profile
    identifier ? fetchWithTimeout(`${UNIPILE_BASE}/api/v1/users/${identifier}?account_id=${UNIPILE_ACCOUNT}`, {
      headers: { 'X-API-KEY': UNIPILE_KEY, 'Accept': 'application/json' },
    }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),

    // 2. Unipile company
    companySlug ? fetchWithTimeout(`${UNIPILE_BASE}/api/v1/linkedin/company/${companySlug}?account_id=${UNIPILE_ACCOUNT}`, {
      headers: { 'X-API-KEY': UNIPILE_KEY, 'Accept': 'application/json' },
    }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),

    // 3. Unipile people at company
    company ? fetchWithTimeout(`${UNIPILE_BASE}/api/v1/linkedin/search?account_id=${UNIPILE_ACCOUNT}&limit=10`, {
      method: 'POST',
      headers: { 'X-API-KEY': UNIPILE_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ api: 'classic', category: 'people', advanced_keywords: { company } }),
    }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),

    // 4. Apollo people search
    APOLLO_KEY && company ? apolloPeopleSearch(company_domain || company).catch(() => null) : Promise.resolve(null),

    // 5. Brave news
    BRAVE_KEY && company ? braveFetch(`${company} funding hiring growth 2025 2026`, 'news').catch(() => []) : Promise.resolve([]),

    // 6. Brave jobs
    BRAVE_KEY && company ? braveFetch(`${company} jobs open roles hiring executives`, 'web').catch(() => []) : Promise.resolve([]),
  ]);

  const sections = [];

  // Profile
  const p = profileResult.status === 'fulfilled' ? profileResult.value : null;
  if (p && p.first_name) {
    const parts = [`LIVE LINKEDIN PROFILE — ${p.first_name} ${p.last_name}:`];
    if (p.headline) parts.push(`  Headline: ${p.headline}`);
    if (p.location) parts.push(`  Location: ${p.location}`);
    if (p.connections_count) parts.push(`  Connections: ${p.connections_count.toLocaleString()}`);
    if (p.network_distance) parts.push(`  Network distance: ${p.network_distance.replace('_', ' ')}`);
    if (p.shared_connections_count) parts.push(`  Shared connections: ${p.shared_connections_count}`);
    sections.push(parts.join('\n'));
  }

  // Company
  const c = companyResult.status === 'fulfilled' ? companyResult.value : null;
  if (c && (c.name || company)) {
    const parts = [`LIVE COMPANY DATA — ${c.name || company}:`];
    if (c.industry) parts.push(`  Industry: ${c.industry}`);
    if (c.staff_count) parts.push(`  Headcount: ${c.staff_count.toLocaleString()}`);
    if (c.description) parts.push(`  About: ${c.description.substring(0, 200)}`);
    if (c.follower_count) parts.push(`  LinkedIn followers: ${c.follower_count.toLocaleString()}`);
    sections.push(parts.join('\n'));
  }

  // Unipile people
  const peopleData = peopleResult.status === 'fulfilled' ? peopleResult.value : null;
  if (peopleData && peopleData.items && peopleData.items.length) {
    const people = peopleData.items
      .filter(person => person.type === 'PEOPLE')
      .filter(person => !firstName || !person.name.toLowerCase().includes(firstName))
      .map(person => {
        const url = person.public_identifier ? `https://www.linkedin.com/in/${person.public_identifier}` : null;
        const dist = person.network_distance === 'DISTANCE_1' ? '1st' : person.network_distance === 'DISTANCE_2' ? '2nd' : '3rd+';
        return `* ${person.name}${person.headline ? ' — ' + person.headline : ''}${person.location ? ' | ' + person.location : ''} | ${dist} degree${url ? '\n  LinkedIn: ' + url : ''}`;
      });
    if (people.length > 0) {
      sections.push(`PEOPLE AT ${company.toUpperCase()} — LinkedIn (live):\n${people.join('\n')}`);
    }
  }

  // Apollo people
  const apolloData = apolloResult.status === 'fulfilled' ? apolloResult.value : null;
  if (apolloData && apolloData.people && apolloData.people.length) {
    const apolloPeople = apolloData.people
      .filter(person => !firstName || !(person.name || '').toLowerCase().includes(firstName))
      .map(person => {
        const url = person.linkedin_url || null;
        const loc = person.city ? `${person.city}, ${person.country || ''}` : (person.country || '');
        return `* ${person.name}${person.title ? ' — ' + person.title : ''}${loc ? ' | ' + loc : ''}${url ? '\n  LinkedIn: ' + url : ''}`;
      });
    if (apolloPeople.length > 0) {
      sections.push(`DECISION-MAKERS AT ${company.toUpperCase()} — Apollo database:\n${apolloPeople.join('\n')}`);
    }
  }

  // News
  const companyNews = newsResult.status === 'fulfilled' ? newsResult.value : [];
  if (companyNews && companyNews.length > 0) {
    sections.push(`LIVE COMPANY NEWS:\n` +
      companyNews.slice(0, 3).map(r => `* ${r.title}: ${(r.description || r.snippet || '').substring(0, 150)}`).join('\n'));
  }

  // Jobs
  const companyJobs = jobsResult.status === 'fulfilled' ? jobsResult.value : [];
  if (companyJobs && companyJobs.length > 0) {
    sections.push(`HIRING SIGNALS:\n` +
      companyJobs.slice(0, 3).map(r => `* ${r.title}: ${(r.description || r.snippet || '').substring(0, 120)}`).join('\n'));
  }

  const context = sections.length > 0
    ? `\n\n--- LIVE ENRICHMENT (fetched now via LinkedIn + Apollo + web) ---\n${sections.join('\n\n')}\n--- END LIVE ENRICHMENT ---\n\nIMPORTANT: You have real live data above including people at this company with their LinkedIn URLs. Use it. Do not say you lack LinkedIn access or cannot find decision makers.`
    : '';

  return { statusCode: 200, headers, body: JSON.stringify({ context }) };
};

async function apolloPeopleSearch(companyIdentifier) {
  const domain = companyIdentifier.includes('.') ? companyIdentifier
    : companyIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com';
  const res = await fetchWithTimeout('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': APOLLO_KEY },
    body: JSON.stringify({ q_organization_domains_list: [domain], person_seniorities: ['c_suite', 'vp', 'director', 'head', 'manager'], per_page: 10 }),
  }, 6000);
  if (!res.ok) return null;
  return res.json();
}

function extractLinkedInIdentifier(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1] : null;
}

async function braveFetch(query, type) {
  const endpoint = type === 'news'
    ? `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=3&freshness=pm`
    : `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`;
  const res = await fetchWithTimeout(endpoint, { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY } }, 5000);
  const data = await res.json();
  return type === 'news' ? (data.results || []) : (data.web && data.web.results || []);
}
