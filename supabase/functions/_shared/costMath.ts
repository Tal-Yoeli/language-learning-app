/**
 * Pure cost arithmetic for the AI budget, deliberately free of any Deno or
 * environment access so it can be unit tested directly from node:test. The
 * Deno-facing wrappers that read the price table live in ./pricing.ts.
 *
 * Everything is integer micro-USD (1 USD = 1_000_000): repeated addition of
 * fractional dollars drifts, integers do not.
 */

export const MICRO_USD_PER_USD = 1_000_000;

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export type TextPrices = {
  /** Micro-USD per 1M input tokens. */
  inputPerMTok: number;
  /** Micro-USD per 1M output tokens. */
  outputPerMTok: number;
};

function toCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Cost of a Responses API call from the usage the API itself reported. */
export function responseCostMicroUsd(
  usage: TokenUsage | null | undefined,
  prices: TextPrices,
): number {
  const input = toCount(usage?.input_tokens);
  const output = toCount(usage?.output_tokens);

  const cost =
    (input * prices.inputPerMTok) / 1_000_000 +
    (output * prices.outputPerMTok) / 1_000_000;

  // Round up so a sub-micro-dollar call is never free.
  return Math.ceil(cost);
}

/**
 * Transcription is billed per minute and the API returns no duration, so the
 * length of the encoded audio stands in for it.
 *
 * `bytesPerSecond` must reflect what the app actually records. expo-audio's
 * HIGH_QUALITY preset is roughly 16 kB/s on iOS and browsers encode lower, so
 * a deliberately low value here overestimates duration and therefore cost.
 */
export function transcriptionCostMicroUsd(
  base64Length: number,
  pricePerMinute: number,
  bytesPerSecond: number,
): number {
  const bytes = Math.max(0, Math.floor((base64Length * 3) / 4));
  const seconds = bytes / Math.max(1, bytesPerSecond);

  return Math.ceil((seconds / 60) * pricePerMinute);
}

/**
 * Text-to-speech is billed on the *audio tokens produced*, not on the text sent
 * in. Pricing this from the input text alone under-counts by several times,
 * which would quietly let the most-used AI feature outrun the budget.
 *
 * `audioTokensPerChar` converts characters of input into an estimate of the
 * audio tokens generated. Three characters per text token is the usual
 * approximation, and spoken audio runs several tokens per text token, so the
 * default deliberately errs high in line with the rest of the table.
 */
export function speechCostMicroUsd(
  text: string,
  pricePerMTok: number,
  audioTokensPerChar: number,
): number {
  const tokens = Math.ceil(text.length * Math.max(0, audioTokensPerChar));

  return Math.ceil((tokens * pricePerMTok) / 1_000_000);
}

// The budget threshold itself deliberately lives ONLY in SQL, inside
// consume_ai_quota() (supabase/migrations/20260807000000_ai_spend_budget.sql).
// A mirrored TypeScript copy was removed: nothing in the request path used it,
// and its tests would have kept passing while the SQL rule drifted underneath.
