// VSG SEO Data — Netlify Serverless Function
// Fetches Google Search Console data using a service account
// Env vars required:
//   GOOGLE_SERVICE_ACCOUNT_JSON  — full JSON key file content (paste from downloaded .json)
//   GSC_SITE_URL                 — your site URL exactly as it appears in GSC (e.g. https://www.vantagesearchgroup.com/)

const crypto = require('crypto');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

async function getAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function gscQuery(token, siteUrl, body) {
  const encoded = encodeURIComponent(siteUrl);
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GSC API ${res.status}: ${txt}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const saJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const siteUrl = process.env.GSC_SITE_URL;

  if (!saJson || !siteUrl) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: true, message: 'GSC not connected yet. Add GOOGLE_SERVICE_ACCOUNT_JSON and GSC_SITE_URL to Netlify env vars.' }),
    };
  }

  try {
    const token = await getAccessToken(saJson);

    // Date range: last 28 days
    const end   = new Date(); end.setDate(end.getDate() - 3); // GSC lags ~3 days
    const start = new Date(end); start.setDate(start.getDate() - 27);
    const fmt   = d => d.toISOString().slice(0, 10);
    const startDate = fmt(start);
    const endDate   = fmt(end);

    // 1. Summary totals
    const [summary, daily, queries, pages] = await Promise.all([
      gscQuery(token, siteUrl, { startDate, endDate, dimensions: [] }),
      gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['date'], rowLimit: 28 }),
      gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['query'], rowLimit: 15 }),
      gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['page'], rowLimit: 10 }),
    ]);

    const totals = (summary.rows || [{}])[0] || {};

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        demo: false,
        period: { startDate, endDate },
        totals: {
          clicks:      Math.round(totals.clicks      || 0),
          impressions: Math.round(totals.impressions || 0),
          ctr:         +((totals.ctr || 0) * 100).toFixed(1),
          position:    +((totals.position || 0)).toFixed(1),
        },
        daily:   (daily.rows   || []).map(r => ({ date: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions) })),
        queries: (queries.rows || []).map(r => ({ query: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: +r.position.toFixed(1) })),
        pages:   (pages.rows   || []).map(r => ({ page: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions) })),
      }),
    };
  } catch (err) {
    console.error('seo-data error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
