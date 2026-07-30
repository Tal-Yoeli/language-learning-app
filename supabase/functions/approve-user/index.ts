/**
 * Reached by clicking the "Review and approve" link/button in the email sent
 * by supabase/functions/notify-signup. No Authorization header is present —
 * this is a plain browser navigation/form submit, not an app API call — so
 * this function must be deployed with `verify_jwt = false`
 * (see supabase/config.toml) and authorizes itself using the service-role key.
 *
 * GET renders a confirmation page and performs no write. Some email clients
 * (e.g. Outlook Safe Links) silently pre-fetch every link in an email via GET
 * before a human ever sees it; if GET itself approved the account, such a
 * scanner would silently approve strangers. Only the page's own POST (the
 * button click) performs the update.
 */

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Language Learning App</title>
      <style>
        body{font-family:system-ui,sans-serif;background:#F6F5F1;color:#17212B;
             display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
        .card{max-width:420px;background:#fff;border-radius:12px;padding:28px;
              box-shadow:0 1px 3px rgba(0,0,0,.1)}
        h1{font-size:19px;margin:0 0 12px}
        p{font-size:14px;line-height:1.5;color:#52606D}
        button{margin-top:16px;background:#1F5E59;color:#fff;border:none;
               border-radius:8px;padding:12px 20px;font-size:14px;font-weight:700;cursor:pointer}
      </style>
      </head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Profile = { id: string; email: string | null; approved: boolean };

async function findProfileByToken(token: string): Promise<Profile | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service credentials are unavailable.');
  }

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
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service credentials are unavailable.');
  }

  // Regenerating the token as part of the same update means this exact link
  // cannot be replayed, and the WHERE clause on the *old* token means a
  // concurrent double-click can only ever succeed once.
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

const INVALID_LINK_PAGE = () =>
  html(
    `<h1>Link no longer valid</h1>
     <p>This approval link has already been used, or the account no longer exists.</p>`,
    404,
  );

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return html(`<h1>Missing link</h1><p>No approval token was provided.</p>`, 400);
  }

  try {
    if (request.method === 'GET') {
      const profile = await findProfileByToken(token);

      if (!profile) return INVALID_LINK_PAGE();

      if (profile.approved) {
        return html(
          `<h1>Already approved</h1>
           <p>${escapeHtml(profile.email ?? 'This account')} was already approved.</p>`,
        );
      }

      // Deliberately not built from `request.url`: behind Supabase's edge
      // gateway that can reflect an internal address rather than the public
      // one the browser actually used, which sent the "Approve" button's POST
      // to an unreachable localhost URL instead of back to this function.
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const actionUrl = `${supabaseUrl}/functions/v1/approve-user?token=${encodeURIComponent(token)}`;

      return html(`
        <h1>Approve this account?</h1>
        <p><strong>${escapeHtml(profile.email ?? '(no email on file)')}</strong> is
           waiting to use the Language Learning app.</p>
        <form method="POST" action="${escapeHtml(actionUrl)}">
          <button type="submit">Approve</button>
        </form>
      `);
    }

    if (request.method === 'POST') {
      const profile = await approveByToken(token);

      if (!profile) return INVALID_LINK_PAGE();

      return html(
        `<h1>Approved</h1>
         <p><strong>${escapeHtml(profile.email ?? 'This account')}</strong> can now
            sign in to the Language Learning app.</p>`,
      );
    }

    return html(`<h1>Method not allowed</h1>`, 405);
  } catch (error) {
    return html(
      `<h1>Something went wrong</h1>
       <p>${escapeHtml(error instanceof Error ? error.message : 'Unknown error.')}</p>`,
      500,
    );
  }
});
