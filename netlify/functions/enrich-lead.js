// enrich-lead.js
// Enriches a LinkedIn lead using (all parallel):
// 1. Unipile: live LinkedIn profile
// 2. Unipile: company profile
// 3. Unipile: other people at the company
// 4. Apollo: decision-makers at the company (UAE + seniority filtered)
// 5. Brave: company news and hiring signals
// Returns a formatted context block injected into the AI chat system prompt.

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const UNIPILE_KEY = process.env.UNIPILE_API_KEY || 'zMwbwlhB.myGGJ3jwk5K0gRuagit2tBK6o8NIGlHISDyoWDgHoJo=';
const UNIPILE_BASE = process.env.UNIPILE_BASE_URL || 'https://api53.unipile.com:18305';
const UNIPILE_ACCOUNT = process.env.UNIPILE_ACCOUNT_ID || 'eFhbX6emR-68eQkgzPq77g';
const APOLLO_KEY = process.env.APOLLO_API_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const body = JSON.parse(event.body || '{}');
  const { name, company, title, linkedin_url, company_domain } = body;

  if (!name && !company) return { statusCode: 200, headers, body: JSON.stringify({ context: '' }) };

  const identifier = extractLinkedInIdentifier(linkedin_url);
  const companySlug = company ? company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;
  const firstName = (name || '').split(' ')[0].toLowerCase();

  // Run ALL fetches in parallel
  const [profileResult, companyResult, peopleResult, apolloResult, newsResult, jobsResult] = await Promise.allSettled([

    // 1. Unipile: person profile
    identifier ? fetch(`${UNIPILE_BASE}/api/v1/users/${identifier}?account_id=${UNIPILE_ACCOUNT}`, {
      headers: { 'X-API-KEY': UNIPILE_KEY, 'Accept': 'application/json' },
    }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),

    // 2. Unipile: company profile
    companySlug ? fetch(`${UNIPILE_BASE}/api/v1/linkedin/company/${companySlug}?account_id=${UNIPILE_ACCOUNT}`, {
      headers: { 'X-API-KEY': UNIPILE_KEY, 'Accept': 'application/json' },
    }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),

    // 3. Unipile: other people at company (LinkedIn search)
    company ? fetch(`${UNIPILE_BASE}/api/v1/linkedin/search?account_id=${UNIPILE_ACCOUNT}&limit=10`, {
      method: 'POST',
      headers: { 'X-API-KEY': UNIPILE_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ api: 'classic', category: 'people', advanced_keywords: { company } }),
    }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),

    // 4. Apollo: decision-makers at company
    APOLLO_KEY && (company_domain || company) ? apolloPeopleSearch(company_domain || company, company) : Promise.resolve(null),

    // 5. Brave: company news
    BRAVE_KEY && company ? braveFetch(`${company} funding hiring growth 2025 2026`, 'news') : Promise.resolve([]),

    // 6. Brave: hiring signals
    BRAVE_KEY && company ? braveFetch(`${company} jobs open roles hiring executives`, 'web') : Promise.resolve([]),
  ]);

  const sections = [];

  // Process Unipile profile
  const p = profileResult.status === 'fulfilled' ? profileResult.value : null;
  if (p && p.first_name) {
    const parts = [`LIVE LINKEDIN PROFILE — ${p.first_name} ${p.last_name}:`];
    if (p.headline) parts.push(`  Headline: ${p.headline}`);
    if (p.location) parts.push(`  Location: ${p.location}`);
    if (p.connections_count) parts.push(`  Connections: ${p.connections_count.toLocaleString()}`);
    if (p.follower_count) parts.push(`  Followers: ${p.follower_count.toLocaleString()}`);
    if (p.network_distance) parts.push(`  Network distance: ${p.network_distance.replace('_', ' ')}`);
    if (p.shared_connections_count) parts.push(`  Shared connections with Michael: ${p.shared_connections_count}`);
    if (p.is_premium) parts.push(`  LinkedIn Premium: Yes`);
    sections.push(parts.join('\n'));
  }

  // Process Unipile company
  const c = companyResult.status === 'fulfilled' ? companyResult.value : null;
  if (c && (c.name || company)) {
    const parts = [`LIVE COMPANY DATA — ${c.name || company}:`];
    if (c.industry) parts.push(`  Industry: ${c.industry}`);
    if (c.staff_count) parts.push(`  Headcount: ${c.staff_count.toLocaleString()}`);
    if (c.staff_count_range) parts.push(`  Size range: ${c.staff_count_range}`);
    if (c.description) parts.push(`  About: ${c.description.substring(0, 200)}`);
    if (c.website) parts.push(`  Website: ${c.website}`);
    if (c.locations?.length) parts.push(`  HQ: ${c.locations[0].city || ''} ${c.locations[0].country || ''}`);
    if (c.follower_count) parts.push(`  LinkedIn followers: ${c.follower_count.toLocaleString()}`);
    sections.push(parts.join('\n'));
  }

  // Process Unipile people search
  const peopleData = peopleResult.status === 'fulfilled' ? peopleResult.value : null;
  if (peopleData?.items?.length) {
    const people = peopleData.items
      .filter(person => person.type === 'PEOPLE')
      .filter(person => !firstName || !person.name.toLowerCase().includes(firstName))
      .map(person => {
        const url = person.public_identifier ? `https://www.linkedin.com/in/${person.public_identifier}` : null;
        const dist = person.network_distance === 'DISTANCE_1' ? '1st' : person.network_distance === 'DISTANCE_2' ? '2nd' : '3rd+';
        return `• ${person.name}${person.headline ? ' — ' + person.headline : ''}${person.location ? ' | ' + person.location : ''} | ${dist} degree${person.shared_connections_count ? ' | ' + person.shared_connections_count + ' shared' : ''}${url ? '\n  LinkedIn: ' + url : ''}`;
      });
    if (people.length > 0) {
      sections.push(`PEOPLE AT ${company.toUpperCase()} — LinkedIn network (live search):\n${people.join('\n')}`);
    }
  }

  // Process Apollo people
  const apolloData = apolloResult.status === 'fulfilled' ? apolloResult.value : null;
  if (apolloData?.people?.length) {
    const apolloPeople = apolloData.people
      .filter(person => !firstName || !(person.name || '').toLowerCase().includes(firstName))
      .map(person => {
        const url = person.linkedin_url || null;
        const loc = person.city ? `${person.city}, ${person.country || ''}` : (person.country || '');
        return `• ${person.name}${person.title ? ' — ' + person.title : ''}${loc ? ' | ' + loc : ''}${url ? '\n  LinkedIn: ' + url : ''}`;
      });
    if (apolloPeople.length > 0) {
      sections.push(`DECISION-MAKERS AT ${company.toUpperCase()} — Apollo database:\n${apolloPeople.join('\n')}`);
    }
  }

  // Process news
  const companyNews = newsResult.status === 'fulfilled' ? newsResult.value : [];
  if (companyNews.length > 0) {
    sections.push(`LIVE COMPANY NEWS:\n` +
      companyNews.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 150)}`).join('\n')
    );
  }

  // Process jobs
  const companyJobs = jobsResult.status === 'fulfilled' ? jobsResult.value : [];
  if (companyJobs.length > 0) {
    sections.push(`HIRING SIGNALS:\n` +
      companyJobs.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 120)}`).join('\n')
    );
  }

  const context = sections.length > 0
    ? `\n\n--- LIVE ENRICHMENT (fetched now via LinkedIn + Apollo + web) ---\n${sections.join('\n\n')}\n--- END LIVE ENRICHMENT ---\n\nIMPORTANT: You have real live data above including people at this company with their LinkedIn URLs. Use it. Do not say you lack LinkedIn access or cannot find decision makers.`
    : '';

  return { statusCode: 200, headers, body: JSON.stringify({ context }) };
};

async function apolloPeopleSearch(companyIdentifier, companyName) {
  try {
    // Try to infer domain if not provided
    const domain = companyIdentifier.includes('.') ? companyIdentifier :
      companyIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com';

    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': APOLLO_KEY,
      },
      body: JSON.stringify({
        q_organization_domains_list: [domain],
        person_seniorities: ['c_suite', 'vp', 'director', 'head', 'manager'],
        per_page: 10,
      }),
    });

    if (!res.ok) {
      console.warn('[enrich-lead] Apollo search failed:', res.status);
      return null;
    }

    const data = await res.json();
    return { people: data.people || [] };
  } catch (e) {
    console.warn('[enrich-lead] Apollo error:', e.message);
    return null;
  }
}

function extractLinkedInIdentifier(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1] : null;
}

async function braveFetch(query, type = 'news') {
  try {
    const endpoint = type === 'news'
      ? `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=3&freshness=pm`
      : `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`;
    const res = await fetch(endpoint, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
    });
    const data = await res.json();
    return type === 'news' ? (data.results || []) : (data.web?.results || []);
  } catch (e) {
    return [];
  }
}
