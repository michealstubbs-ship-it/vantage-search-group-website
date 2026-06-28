// generate-outreach.js — Stage 2 message generation for Today's Actions
// Enriches the contact via Unipile LinkedIn profile lookup, then generates a
// Partner-quality outreach message using the 8-step reasoning framework.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let contact_name, contact_title, linkedin_url, company, signal, why, action_title;
  try {
    const body = JSON.parse(event.body || '{}');
    contact_name = body.contact_name || '';
    contact_title = body.contact_title || '';
    linkedin_url = body.linkedin_url || '';
    company = body.company || '';
    signal = body.signal || '';
    why = body.why || '';
    action_title = body.action_title || '';
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!contact_name && !company) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No contact or company provided' }) };
  }

  const claudeKey = process.env.CLAUDE_API_KEY;
  const unipileKey = process.env.UNIPILE_API_KEY;

  if (!claudeKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }) };
  }

  // ── Step 1: Enrich via Unipile LinkedIn profile ───────────────────────────
  let profileContext = '';
  if (linkedin_url && unipileKey) {
    try {
      const BASE = 'https://api2.unipile.com:13270';
      const slugMatch = linkedin_url.match(/linkedin\.com\/in\/([^/?#]+)/i);

      if (slugMatch) {
        const publicId = slugMatch[1].replace(/\/$/, '');

        // Get Michael's Unipile LinkedIn account ID
        const accountsRes = await fetch(`${BASE}/api/v1/accounts?account_type=LINKEDIN`, {
          headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' },
        });
        const accountsData = await accountsRes.json();
        const accountId = (accountsData.items || accountsData.objects || [])[0]?.id;

        if (accountId) {
          const profileRes = await fetch(
            `${BASE}/api/v1/users/${encodeURIComponent(publicId)}?account_id=${accountId}&linkedin_sections=experience_preview,education_preview`,
            { headers: { 'X-API-KEY': unipileKey, 'accept': 'application/json' } }
          );

          if (profileRes.ok) {
            const p = await profileRes.json();
            const parts = [];

            if (p.headline) parts.push(`Headline: ${p.headline}`);
            if (p.summary) parts.push(`About: ${p.summary.slice(0, 500)}`);
            if (p.location) parts.push(`Location: ${p.location}`);

            const currentRole = (p.work_experience || []).find(w => w.current);
            if (currentRole) {
              parts.push(`Current role: ${currentRole.position} at ${currentRole.company}${currentRole.start ? ' (since ' + currentRole.start + ')' : ''}`);
              if (currentRole.description) parts.push(`Role context: ${currentRole.description.slice(0, 200)}`);
            }

            const prevRoles = (p.work_experience || []).filter(w => !w.current).slice(0, 3);
            if (prevRoles.length) {
              parts.push(`Career history: ${prevRoles.map(r => `${r.position} at ${r.company}`).join(' → ')}`);
            }

            const edu = (p.education || []).slice(0, 1);
            if (edu.length) parts.push(`Education: ${edu[0].degree || ''} ${edu[0].field_of_study || ''} at ${edu[0].school}`.trim());

            if (p.network_distance) parts.push(`Connection status: ${p.network_distance.replace(/_/g, ' ').toLowerCase()}`);
            if (p.is_relationship) parts.push('Already connected on LinkedIn');
            if (p.connections_count) parts.push(`Network size: ${p.connections_count.toLocaleString()} connections`);
            if (p.is_open_profile) parts.push('Open profile — accepts messages from anyone');

            profileContext = parts.join('\n');
          }
        }
      }
    } catch (e) {
      console.warn('[generate-outreach] LinkedIn enrichment failed:', e.message);
      // Non-fatal — proceed without profile data
    }
  }

  // ── Step 2: Build Partner reasoning prompt ────────────────────────────────
  const systemPrompt = `You are writing one LinkedIn outreach message on behalf of Michael Stubbs, Founder and Managing Partner of Vantage Search Group — a boutique executive search firm in the GCC.

VSG BACKGROUND (use naturally when relevant, never as a pitch):
VSG runs retained and contingency executive search mandates across the GCC. 70+ C-suite placements. Clients include Mubadala, PIF, Red Sea Global, ADNOC, ADQ, TAQA, Accenture, SDAIA, STC and many others. Michael works personally on every mandate — no junior delegation. VSG has worked with 8 of the GCC's top 10 sovereign wealth funds.

PARTNER REASONING — work through this internally before writing anything:
1. What is genuinely interesting about this individual beyond their job title? What does their career history suggest about how they think and what they care about?
2. What has recently changed at their company or in their market that creates a genuine reason to reach out today — not next month, today?
3. Why would this specific person care that VSG exists? If they probably wouldn't, do not write a message.
4. What is the single strongest angle to open this conversation? It must be based on real commercial relevance, not a compliment or generic observation.
5. What is the one question most likely to get a thoughtful reply from someone at this level?

WRITING RULES:
- Maximum 70 words
- Write as one senior professional to another — peer to peer, not vendor to prospect
- Reference something specific about the person or their situation (not generic)
- End with one natural, easy open question
- Never start with their name — begin with the most interesting observation
- Avoid all of: "I hope you're well", "I wanted to reach out", "I came across your profile", "I'd love to connect", "We specialise in", "We are experts in", "Congratulations on", "I'd love to explore", "Let's connect"
- No em-dashes. No corporate language. No AI-sounding phrases. No scores or percentages.
- Natural. Confident. Curious. Never desperate. Never salesy.
- The recipient should feel that genuine research has been done — not that a tool produced this.

SELF-CRITIQUE (internal only — never include in output):
After drafting, score: human tone / commercial relevance / research depth / likelihood of reply. If any score is below 8 out of 10, rewrite. Repeat until all scores reach 8 or above. Then output only the final message.

OUTPUT: Return only the message text. No quotes around it. No preamble. No explanation. No "Here is the message:". Just the message.`;

  const userPrompt = `Write one LinkedIn outreach message from Michael to the following individual.

TARGET CONTACT: ${contact_name}${contact_title ? ', ' + contact_title : ''}${company ? ' at ' + company : ''}
${profileContext ? '\nLINKEDIN PROFILE INTELLIGENCE:\n' + profileContext + '\n' : ''}
COMMERCIAL TRIGGER: ${signal || action_title}
COMMERCIAL CONTEXT: ${why}

Remember: maximum 70 words. Start with the most interesting observation, not their name. End with one easy question. Sound like a senior executive search Partner, not a tool.`;

  // ── Step 3: Call Claude Sonnet ────────────────────────────────────────────
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error: ${res.status} — ${err}`);
    }

    const data = await res.json();
    const message = (data.content?.[0]?.text || '').trim()
      .replace(/^["']|["']$/g, '')  // strip any surrounding quotes
      .replace(/^Here is.*?:\s*/i, '') // strip any preamble
      .trim();

    console.log(`[generate-outreach] Generated for ${contact_name} at ${company} — had_profile: ${!!profileContext}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message, had_profile: !!profileContext }),
    };
  } catch (e) {
    console.error('[generate-outreach] Claude call failed:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
