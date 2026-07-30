const BASE_HEADERS = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/**
 * Comma-separated list, for example:
 *   supabase secrets set ALLOWED_ORIGINS=https://app.example.com,http://localhost:8081
 *
 * Left unset, every origin is allowed, which is the behaviour the iPhone-only
 * build shipped with. Setting it is what stops another website calling these
 * paid functions from a visitor's browser using their session.
 */
function allowedOrigins() {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');

  // Native apps send no Origin header. CORS does not apply to them, and adding
  // Access-Control-Allow-Origin would be meaningless rather than restrictive.
  if (!origin) return { ...BASE_HEADERS };

  const allowlist = allowedOrigins();

  if (!allowlist.length) {
    return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': '*' };
  }

  if (allowlist.includes(origin)) {
    return {
      ...BASE_HEADERS,
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    };
  }

  // No Access-Control-Allow-Origin: the browser blocks the response.
  return { ...BASE_HEADERS, Vary: 'Origin' };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  request?: Request,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(request ? corsHeadersFor(request) : BASE_HEADERS),
      'Content-Type': 'application/json',
    },
  });
}

export function preflightResponse(request: Request) {
  return new Response('ok', { headers: corsHeadersFor(request) });
}
