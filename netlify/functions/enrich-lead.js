// enrich-lead.js
// Enriches a LinkedIn lead using:
// 1. Unipile LinkedIn API — live profile data, company info, shared connections
// 2. Brave search — company news and hiring signals
// Returns a formatted context block injected into the AI chat system prompt.

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const UNIPILE_KEY = process.env.UNIPILE_API_KEY || 'zMwbwlhB.myGGJ3jwk5K0gRuagit2tBK6o8NIGlHISDyoWDgHoJo=';
const UNIPILE_BASE = process.env.UNIPILE_BASE_URL || 'https://api53.unipile.com:18305';
const UNIPILE_ACCOUNT = process.env.UNIPILE_ACCOUNT_ID || 'eFhbX6emR-68eQkgzPq77g';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const body = JSON.parse(event.body || '{}');
  const { name, company, title, linkedin_url } = body;

  if (!name && !company) return { statusCode: 200, headers, body: JSON.stringify({ context: '' }) };

  const sections = [];

  // 1. Unipile: pull live LinkedIn profile data
  if (UNIPILE_KEY && linkedin_url) {
    try {
      const identifier = extractLinkedInIdentifier(linkedin_url);
      if (identifier) {
        const profileRes = await fetch(`${UNIPILE_BASE}/api/v1/users/${identifier}?account_id=${UNIPILE_ACCOUNT}`, {
          headers: { 'X-API-KEY': UNIPILE_KEY, 'Accept': 'application/json' },
        });
        if (profileRes.ok) {
          const p = await profileRes.json();
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
      }
    } catch (e) {
      console.warn('[enrich-lead] Unipile profile error:', e.message);
    }
  }

  // 2. Unipile: company profile
  if (UNIPILE_KEY && company) {
    try {
      // Try to find company LinkedIn identifier from Brave first, then fetch
      // Use company name as slug (lowercase, hyphens)
      const companySlug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const companyRes = await fetch(`${UNIPILE_BASE}/api/v1/linkedin/company/${companySlug}?account_id=${UNIPILE_ACCOUNT}`, {
        headers: { 'X-API-KEY': UNIPILE_KEY, 'Accept': 'application/json' },
      });
      if (companyRes.ok) {
        const c = await companyRes.json();
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
    } catch (e) {
      console.warn('[enrich-lead] Unipile company error:', e.message);
    }
  }

  // 3. Brave: company news and hiring signals
  if (BRAVE_KEY && company) {
    try {
      const searches = await Promise.allSettled([
        braveFetch(`${company} funding hiring growth 2025 2026`, 'news'),
        braveFetch(`${company} jobs open roles hiring executives`, 'web'),
      ]);
      const [companyNews, companyJobs] = searches.map(r => r.status === 'fulfilled' ? r.value : []);

      if (companyNews.length > 0) {
        sections.push(`LIVE COMPANY NEWS:\n` +
          companyNews.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 150)}`).join('\n')
        );
      }
      if (companyJobs.length > 0) {
        sections.push(`HIRING SIGNALS:\n` +
          companyJobs.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 120)}`).join('\n')
        );
      }
    } catch (e) {
      console.warn('[enrich-lead] Brave error:', e.message);
    }
  }

  const context = sections.length > 0
    ? `\n\n--- LIVE ENRICHMENT (fetched now via LinkedIn + web search) ---\n${sections.join('\n\n')}\n--- END LIVE ENRICHMENT ---\n\nIMPORTANT: You have real live data above. Use it. Do not say you lack LinkedIn access.`
    : '';

  return { statusCode: 200, headers, body: JSON.stringify({ context }) };
};

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
