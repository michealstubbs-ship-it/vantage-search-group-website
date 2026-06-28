// send-linkedin.js — Send a LinkedIn message via Unipile
// Called from Today's Actions "Send" button. Finds existing chat by contact name, sends message.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let contact_name, message;
  try {
    const body = JSON.parse(event.body || '{}');
    contact_name = body.contact_name || '';
    message = body.message || '';
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No message provided' }) };
  if (!contact_name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No contact name provided' }) };

  const unipileKey = process.env.UNIPILE_API_KEY;
  if (!unipileKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unipile not configured' }) };

  const BASE = 'https://api2.unipile.com:13270';
  const firstName = contact_name.split(' ')[0].toLowerCase();

  try {
    // Step 1: List LinkedIn chats to find existing chat with this contact
    const chatsRes = await fetch(`${BASE}/api/v1/chats?limit=200&account_type=LINKEDIN`, {
      headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' },
    });

    if (!chatsRes.ok) {
      const err = await chatsRes.text();
      console.error('[send-linkedin] Chats list failed:', chatsRes.status, err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to list chats', fallback: true }) };
    }

    const chatsData = await chatsRes.json();
    const chats = chatsData.items || chatsData.objects || [];

    // Match by first name in attendees
    const chat = chats.find(c => {
      const attendees = c.attendees_data || c.attendees || [];
      return attendees.some(a =>
        a.name?.toLowerCase().includes(firstName) ||
        a.display_name?.toLowerCase().includes(firstName)
      );
    });

    if (!chat) {
      console.warn(`[send-linkedin] No chat found for "${contact_name}" (firstName: "${firstName}")`);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `No existing LinkedIn chat found for ${contact_name}`, fallback: true }),
      };
    }

    // Step 2: Send message to existing chat using multipart/form-data
    const form = new FormData();
    form.append('text', message);

    const sendRes = await fetch(`${BASE}/api/v1/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' },
      body: form,
    });

    const sendData = await sendRes.json().catch(() => ({}));

    if (sendRes.ok) {
      console.log(`[send-linkedin] Sent to ${contact_name} (chat: ${chat.id}) — message_id: ${sendData.message_id}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, chat_id: chat.id, message_id: sendData.message_id }),
      };
    } else {
      console.error(`[send-linkedin] Send failed (${sendRes.status}):`, sendData);
      return {
        statusCode: sendRes.status,
        headers,
        body: JSON.stringify({ error: sendData.title || sendData.detail || 'Send failed', fallback: true }),
      };
    }
  } catch (e) {
    console.error('[send-linkedin] Unexpected error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message, fallback: true }),
    };
  }
};
