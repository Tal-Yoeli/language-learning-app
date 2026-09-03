/**
 * Authentication and spend guard shared by every paid Edge Function.
 *
 * The project anon key is a valid JWT, so gateway-level `verify_jwt` alone does
 * not distinguish a real user from anyone who read the key out of the web
 * bundle. The check that actually holds is `auth.uid()` inside
 * `consume_ai_quota()`: PostgREST verifies the JWT signature and the anon key
 * resolves to a null subject, so replaying the public key is rejected by the
 * database rather than by anything this function could be tricked into
 * skipping.
 */

export type QuotaResult = {
  allowed: boolean;
  used: number;
  limit: number;
  /** Estimated micro-USD already spent this calendar month (UTC). */
  spentMicroUsd?: number;
  /** Monthly budget in micro-USD; 0 means unlimited. */
  budgetMicroUsd?: number;
  /** Who and which period the reservation was taken against. */
  userId?: string;
  periodMonth?: string;
};

/** Thrown for outcomes the caller should see verbatim, with a real status. */
export class RequestRejected extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestRejected';
    this.status = status;
  }
}

const QUOTA_TIMEOUT_MS = 10_000;
// Much tighter than the quota check. Accounting runs AFTER the model has
// answered, inside the client's remaining time budget -- evaluate-translation
// only allows 20s in total (src/lib/aiFunctions.ts), and pronunciation-feedback
// records twice. A slow write must not turn a successful call into a timeout.
const SPEND_TIMEOUT_MS = 3_000;

export async function consumeAiQuota(request: Request): Promise<QuotaResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization') ?? '';

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables are unavailable.');
  }

  if (!authorization) {
    throw new RequestRejected('Sign-in is required to use AI features.', 401);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUOTA_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_ai_quota`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The usage check timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();

    // 28002 is raised once the month's estimated spend reaches the account's
    // budget. 402 keeps it distinct from "not signed in" and "over the daily
    // burst limit" so the client can explain which wall was hit.
    if (body.includes('28002') || body.includes('budget exhausted')) {
      throw new RequestRejected(
        "Monthly AI budget used up. It resets on the 1st. Your decks, lessons and review all keep working.",
        402,
      );
    }

    // 28001 is the errcode consume_ai_quota() raises for a signed-in user
    // whose profiles.approved is still false — distinct from "not signed in
    // at all" so the client can show the right message.
    if (body.includes('28001') || body.includes('pending approval')) {
      throw new RequestRejected(
        "Your account has not been approved yet. You'll be able to use AI features once it is.",
        403,
      );
    }

    // 28000 is the errcode consume_ai_quota() raises for a null auth.uid(),
    // which is what an unauthenticated caller produces.
    if (
      response.status === 401 ||
      response.status === 403 ||
      body.includes('28000') ||
      body.includes('Authentication required')
    ) {
      throw new RequestRejected('Sign-in is required to use AI features.', 401);
    }

    // A missing function means the quota migration has not been applied yet.
    if (response.status === 404) {
      throw new Error(
        'The usage quota function is missing. Apply supabase/migrations before deploying.',
      );
    }

    throw new Error('The usage check failed. Please try again.');
  }

  const result = (await response.json()) as QuotaResult;

  if (!result?.allowed) {
    throw new RequestRejected(
      `Daily AI limit reached (${result?.limit ?? 0} requests). Please try again tomorrow.`,
      429,
    );
  }

  return result;
}

/**
 * Reconciles what a request actually cost against the reservation
 * consume_ai_quota() already took.
 *
 * CALL THIS AT MOST ONCE PER REQUEST. A second call would subtract the
 * reservation twice and push the month's total *down*. An endpoint making
 * several paid calls must sum their costs and report the total once (see
 * pronunciation-feedback).
 *
 * Uses the SERVICE ROLE key, not the caller's JWT: the RPC is deliberately not
 * executable by `authenticated`, because a user able to call it could subtract
 * the reservation on demand and zero out their own spend.
 */
async function adjustSpend(quota: QuotaResult, microUsd: number) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey || !quota.userId || !quota.periodMonth) {
    console.error('record_ai_spend skipped: missing service credentials or reservation');
    return;
  }

  const write = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SPEND_TIMEOUT_MS);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_ai_spend`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_user: quota.userId,
          target_period: quota.periodMonth,
          amount_micro_usd: Math.max(0, Math.ceil(microUsd)),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error('record_ai_spend failed', response.status, await response.text());
      }
    } catch (error) {
      console.error('record_ai_spend threw', error);
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  // Accounting runs after the model has already answered, so it must not spend
  // the client's remaining time budget -- evaluate-translation allows only 20s
  // in total, and a timeout there discards a correct verdict and falls back to
  // the stricter local string match.
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (typeof runtime?.waitUntil === 'function') {
    runtime.waitUntil(write);
    return;
  }

  await write;
}

export async function recordAiSpend(quota: QuotaResult, microUsd: number) {
  const amount = Number.isFinite(microUsd) ? Math.max(0, Math.ceil(microUsd)) : 0;

  if (amount <= 0) {
    // Loud on purpose. Every priced call should cost something, so a zero here
    // usually means the Responses payload arrived without `usage`. The
    // reservation is left in place rather than refunded, so the budget keeps
    // counting instead of silently stalling.
    console.warn('record_ai_spend skipped: estimated cost was zero');
    return;
  }

  await adjustSpend(quota, amount);
}

/**
 * Gives back the reservation for a request that never reached OpenAI -- a
 * failed body validation, for example. Without this, a client sending 60 bad
 * requests would burn most of a month's budget on zero AI work.
 */
export async function releaseAiReservation(quota: QuotaResult) {
  await adjustSpend(quota, 0);
}

/** Maps a thrown value to the status and message the client should receive. */
export function describeError(error: unknown) {
  if (error instanceof RequestRejected) {
    return { message: error.message, status: error.status };
  }

  return {
    message: error instanceof Error ? error.message : 'Unknown error.',
    status: 500,
  };
}
