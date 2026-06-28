// send-linkedin-invite.js — Send a LinkedIn connection invite via Unipile
// Looks up user by LinkedIn URL slug, checks connection status, sends invite with note.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let linkedin_url, contact_name, invite_note;
  try {
    const body = JSON.parse(event.body || '{}');
    linkedin_url = body.linkedin_url || '';
    contact_name = body.contact_name || '';
    invite_note = body.invite_note || '';
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!linkedin_url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No LinkedIn URL provided' }) };

  const unipileKey = process.env.UNIPILE_API_KEY;
  if (!unipileKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unipile not configured' }) };

  const BASE = 'https://api2.unipile.com:13270';

  // Extract public identifier from LinkedIn URL
  // e.g. https://www.linkedin.com/in/nader-ashoor/ → nader-ashoor
  const slugMatch = linkedin_url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!slugMatch) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not extract LinkedIn profile ID from URL' }) };
  }
  const publicId = slugMatch[1].replace(/\/$/, '');

  try {
    // Step 1: Get Michael's LinkedIn account ID in Unipile
    const accountsRes = await fetch(`${BASE}/api/v1/accounts?account_type=LINKEDIN`, {
      headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' },
    });
    const accountsData = await accountsRes.json();
    const accountId = (accountsData.items || accountsData.objects || [])[0]?.id;

    if (!accountId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No LinkedIn account found in Unipile' }) };
    }

    // Step 2: Look up the user profile to get provider_id and connection status
    const profileRes = await fetch(
      `${BASE}/api/v1/users/${encodeURIComponent(publicId)}?account_id=${accountId}`,
      { headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' } }
    );

    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({}));
      console.error('[send-linkedin-invite] Profile lookup failed:', profileRes.status, err);
      return { statusCode: 404, headers, body: JSON.stringify({ error: `Could not find LinkedIn profile for ${publicId}`, fallback: true }) };
    }

    const profile = await profileRes.json();
    const providerId = profile.provider_id;
    const isConnected = profile.network_distance === 'FIRST_DEGREE' || profile.is_relationship === true;

    if (!providerId) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Could not resolve LinkedIn provider ID', fallback: true }) };
    }

    // Step 3: If already connected, return that status (caller should use send-linkedin instead)
    if (isConnected) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ already_connected: true, provider_id: providerId, account_id: accountId }),
      };
    }

    // Step 4: Send connection invite with note (max 300 chars)
    const note = (invite_note || '').slice(0, 295).trim();

    const inviteRes = await fetch(`${BASE}/api/v1/users/invite`, {
      method: 'POST',
      headers: { 'X-API-KEY': unipileKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        provider_id: providerId,
        account_id: accountId,
        ...(note ? { message: note } : {}),
      }),
    });

    const inviteData = await inviteRes.json().catch(() => ({}));

    if (inviteRes.ok) {
      console.log(`[send-linkedin-invite] Invite sent to ${contact_name} (${publicId}) — invitation_id: ${inviteData.invitation_id}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, invitation_id: inviteData.invitation_id }),
      };
    } else {
      console.error(`[send-linkedin-invite] Invite failed (${inviteRes.status}):`, inviteData);
      return {
        statusCode: inviteRes.status,
        headers,
        body: JSON.stringify({ error: inviteData.title || inviteData.detail || 'Invite failed', fallback: true }),
      };
    }
  } catch (e) {
    console.error('[send-linkedin-invite] Unexpected error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message, fallback: true }),
    };
  }
};
