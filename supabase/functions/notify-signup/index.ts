import { jsonResponse } from '../_shared/cors.ts';

/**
 * Called by a Supabase Database Webhook (Database -> Webhooks, configured in
 * the dashboard, not in code) whenever a row is inserted into `public.profiles`
 * — i.e. every new signup, via the `handle_new_user` trigger in
 * supabase/migrations/20260730000000_user_approval.sql.
 *
 * Supabase signs this call itself when the webhook target is "Supabase Edge
 * Functions", so no separate shared secret is needed here beyond the standard
 * `verify_jwt` gateway check.
 */

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record?: {
    id?: string;
    email?: string | null;
    approval_token?: string;
  };
};

const RESEND_URL = 'https://api.resend.com/emails';
// Resend's shared test domain. Works with zero setup; swap for a verified
// custom domain later if wanted.
const FROM_ADDRESS = 'Language Learning App <onboarding@resend.dev>';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const notifyEmail = Deno.env.get('SIGNUP_NOTIFY_EMAIL') ?? 'tal.yoeli@gmail.com';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    if (!resendKey) {
      throw new Error('Missing RESEND_API_KEY Supabase secret.');
    }
    if (!supabaseUrl) {
      throw new Error('Missing SUPABASE_URL.');
    }

    const payload = (await request.json()) as WebhookPayload;

    if (payload.table !== 'profiles' || payload.type !== 'INSERT') {
      // Only new signups should ever reach this function, but fail quietly
      // rather than erroring if the webhook is ever pointed at something else.
      return jsonResponse({ skipped: true });
    }

    const email = payload.record?.email?.trim();
    const token = payload.record?.approval_token;

    if (!email || !token) {
      return jsonResponse({ error: 'Missing email or approval_token.' }, 400);
    }

    const approveUrl = `${supabaseUrl}/functions/v1/approve-user?token=${encodeURIComponent(token)}`;
    const safeEmail = escapeHtml(email);

    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [notifyEmail],
        subject: `New sign-up: ${email}`,
        html: `
          <p>A new account requested access to the Language Learning app.</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p>
            <a href="${approveUrl}"
               style="display:inline-block;padding:10px 18px;background:#1F5E59;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
              Review and approve
            </a>
          </p>
          <p style="color:#666;font-size:13px;">
            If the button does not work, open this link instead:<br>
            ${approveUrl}
          </p>
        `,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend request failed: ${body}`);
    }

    return jsonResponse({ sent: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error.' },
      500,
    );
  }
});
