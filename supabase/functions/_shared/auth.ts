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

    // 28000 is the errcode consume_ai_quota() raises for a null auth.uid(),
    // which is what the public anon key produces.
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
