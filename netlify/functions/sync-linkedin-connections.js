// sync-linkedin-connections.js
// Pulls Michael's full 1st-degree LinkedIn connections from Unipile
// and upserts them into the linkedin_connections Supabase table.
// Called manually from dashboard or weekly via scheduled task.

const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const UNIPILE_KEY = process.env.UNIPILE_API_KEY;
const BASE = 'https://api2.unipile.com:13270';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!UNIPILE_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'UNIPILE_API_KEY not set' }) };
  if (!SUPA_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY not set' }) };

  const db = createClient(SUPA_URL, SUPA_KEY);

  try {
    // Step 1: Get LinkedIn account ID
    const accountsRes = await fetch(`${BASE}/api/v1/accounts?account_type=LINKEDIN`, {
      headers: { 'X-API-KEY': UNIPILE_KEY, 'accept': 'application/json' },
    });
    const accountsData = await accountsRes.json();
    const accountId = (accountsData.items || accountsData.objects || [])[0]?.id;
    if (!accountId) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No LinkedIn account found in Unipile' }) };

    // Step 2: Paginate through all 1st-degree connections
    const allConnections = [];
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 50; // safety cap — 100 per page = up to 5000 connections

    do {
      const url = new URL(`${BASE}/api/v1/relations`);
      url.searchParams.set('account_id', accountId);
      url.searchParams.set('limit', '100');
      url.searchParams.set('relation', 'FIRST_DEGREE');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), {
        headers: { 'X-API-KEY': UNIPILE_KEY, 'accept': 'application/json' },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[sync-linkedin] Relations fetch failed:', res.status, err);
        break;
      }

      const data = await res.json();
      const items = data.items || data.objects || data.relations || [];
      allConnections.push(...items);

      cursor = data.cursor || data.next_cursor || null;
      page++;
      console.log(`[sync-linkedin] Page ${page}: ${items.length} connections (total so far: ${allConnections.length})`);

      if (items.length === 0) break;
    } while (cursor && page < MAX_PAGES);

    if (allConnections.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ synced: 0, message: 'No connections returned from Unipile' }) };
    }

    // Step 3: Map to our schema
    const rows = allConnections.map(c => {
      const profile = c.attendee || c.profile || c;
      const providerId = profile.provider_id || profile.id || c.provider_id || null;
      const publicId = profile.public_identifier || profile.public_id || null;
      const liUrl = publicId
        ? `https://www.linkedin.com/in/${publicId}`
        : (profile.url || profile.linkedin_url || null);

      // Company: try headline parsing or direct field
      let company = profile.company || profile.organization || null;
      if (!company && profile.headline) {
        const match = profile.headline.match(/at (.+?)(?:\s*[|\-•]|$)/i);
        if (match) company = match[1].trim();
      }

      return {
        provider_id: providerId,
        full_name: profile.name || profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
        title: profile.title || profile.headline || null,
        company: company,
        linkedin_url: liUrl,
        profile_picture_url: profile.profile_picture_url || profile.picture || null,
        synced_at: new Date().toISOString(),
      };
    }).filter(r => r.full_name && r.provider_id);

    // Step 4: Upsert in batches of 200
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await db.from('linkedin_connections').upsert(batch, { onConflict: 'provider_id' });
      if (error) console.error('[sync-linkedin] Upsert error:', error);
      else upserted += batch.length;
    }

    console.log(`[sync-linkedin] Done. ${upserted}/${rows.length} connections synced.`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ synced: upserted, total_fetched: allConnections.length, pages: page }),
    };

  } catch (e) {
    console.error('[sync-linkedin] Fatal error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
