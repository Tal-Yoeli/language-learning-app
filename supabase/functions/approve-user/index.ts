import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

/**
 * Backs the approval screen in the web app (see src/auth/AuthGate.tsx), which
 * is opened from the link in the notification email.
 *
 * This returns JSON, not a page. Supabase's Edge Runtime forcibly rewrites
 * every response to `Content-Type: text/plain` and attaches
 * `Content-Security-Policy: default-src 'none'; sandbox` plus `nosniff`, so an
 * Edge Function physically cannot serve a working HTML page on a supabase.co
 * domain — a browser shows the markup as text and any form in it is inert.
 * The human-facing page therefore lives in the Netlify-hosted app instead.
 *
 * No Authorization header is involved (the emailed token is the credential),
 * so this must stay deployed with `verify_jwt = false`; it authorizes itself
 * with the service-role key.
 *
 * GET looks the account up and performs no write — some email clients
 * pre-fetch links before a human sees them, and a prefetch must never approve
 * anyone. Only POST performs the update.
 */

type Profile = { id: string; email: string | null; approved: boolean };

function serviceCredentials() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service credentials are unavailable.');
  }

  return { supabaseUrl, serviceKey };
}

async function findProfileByToken(token: string): Promise<Profile | null> {
  const { supabaseUrl, serviceKey } = serviceCredentials();

  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?approval_token=eq.${encodeURIComponent(token)}&select=id,email,approved`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );

  if (!response.ok) {
    throw new Error('Could not look up the approval link.');
  }

  const rows = (await response.json()) as Profile[];
  return rows[0] ?? null;
}

async function approveByToken(token: string): Promise<Profile | null> {
  const { supabaseUrl, serviceKey } = serviceCredentials();

  // Rotating the token in the same statement means this link cannot be
  // replayed, and matching on the *old* token means a double-click can only
  // ever succeed once.
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?approval_token=eq.${encodeURIComponent(token)}&approved=is.false`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ approved: true, approval_token: crypto.randomUUID() }),
    },
  );

  if (!response.ok) {
    throw new Error('Could not approve this account.');
  }

  const rows = (await response.json()) as Profile[];
  return rows[0] ?? null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse(request);
  }

  const token = new URL(request.url).searchParams.get('token');

  if (!token) {
    return jsonResponse({ error: 'No approval token was provided.' }, 400, request);
  }

  try {
    if (request.method === 'GET') {
      const profile = await findProfileByToken(token);

      if (!profile) {
        return jsonResponse(
          { found: false, error: 'This approval link has already been used, or the account no longer exists.' },
          404,
          request,
        );
      }

      return jsonResponse(
        { found: true, email: profile.email, approved: profile.approved },
        200,
        request,
      );
    }

    if (request.method === 'POST') {
      const profile = await approveByToken(token);

      if (!profile) {
        // Either the token is unknown, or the account was already approved
        // (the `approved=is.false` filter matches nothing in that case).
        const existing = await findProfileByToken(token);

        if (existing?.approved) {
          return jsonResponse(
            { approved: true, alreadyApproved: true, email: existing.email },
            200,
            request,
          );
        }

        return jsonResponse(
          { approved: false, error: 'This approval link has already been used, or the account no longer exists.' },
          404,
          request,
        );
      }

      return jsonResponse({ approved: true, email: profile.email }, 200, request);
    }

    return jsonResponse({ error: 'Method not allowed.' }, 405, request);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error.' },
      500,
      request,
    );
  }
});
