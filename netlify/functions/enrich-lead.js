// enrich-lead.js
// Runs live Brave searches for a LinkedIn lead's company and person,
// returns a formatted context block to inject into the AI chat system prompt.

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!BRAVE_KEY) return { statusCode: 200, headers, body: JSON.stringify({ context: '' }) };

  const body = JSON.parse(event.body || '{}');
  const { name, company, title } = body;

  if (!name && !company) return { statusCode: 200, headers, body: JSON.stringify({ context: '' }) };

  try {
    const searches = await Promise.allSettled([
      // Company news and signals
      braveFetch(`${company} funding hiring growth 2025 2026`, 'news'),
      braveFetch(`${company} jobs open roles hiring executives`, 'web'),
      // Person intel
      braveFetch(`${name} ${company} ${title || ''}`.trim(), 'web'),
    ]);

    const [companyNews, companyJobs, personSearch] = searches.map(r =>
      r.status === 'fulfilled' ? r.value : []
    );

    const sections = [];

    if (companyNews.length > 0) {
      sections.push(`LIVE COMPANY NEWS (${company}):\n` +
        companyNews.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 150)}`).join('\n')
      );
    }

    if (companyJobs.length > 0) {
      sections.push(`HIRING SIGNALS (${company}):\n` +
        companyJobs.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 120)}`).join('\n')
      );
    }

    if (personSearch.length > 0) {
      sections.push(`LIVE INTEL ON ${name}:\n` +
        personSearch.slice(0, 3).map(r => `• ${r.title}: ${(r.description || r.snippet || '').substring(0, 120)}`).join('\n')
      );
    }

    const context = sections.length > 0
      ? `\n\n--- LIVE ENRICHMENT (fetched now) ---\n${sections.join('\n\n')}\n--- END LIVE ENRICHMENT ---`
      : '';

    return { statusCode: 200, headers, body: JSON.stringify({ context }) };
  } catch (e) {
    console.error('[enrich-lead] error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ context: '' }) };
  }
};

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
