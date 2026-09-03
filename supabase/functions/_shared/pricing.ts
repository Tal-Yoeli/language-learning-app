/**
 * Price table for the AI budget, read from Supabase secrets.
 *
 * IMPORTANT, and worth being blunt about: this cannot be a true spending cap.
 * OpenAI bills the account directly; all this code can do is estimate what a
 * call cost and refuse the next one. The only hard guarantee is OpenAI's own
 * spending limit (DEPLOYMENT.md step 1.8). This bounds how much any single
 * invited user can cost; it does not replace that limit.
 *
 * The arithmetic itself lives in ./costMath.ts so it can be unit tested.
 */

import {
  responseCostMicroUsd,
  speechCostMicroUsd,
  transcriptionCostMicroUsd,
} from './costMath.ts';

/**
 * Defaults sit above realistic small-model prices, so a table that was never
 * tuned cuts the budget off early rather than overspending. Override with
 * `supabase secrets set` once the real per-model prices are known.
 */
/**
 * `minimum` guards the values used as divisors. Accepting 0 for
 * OPENAI_AUDIO_BYTES_PER_SECOND would price audio at one byte per second: a
 * 30-second clip would record around $80 and exhaust every budget on the first
 * speaking attempt.
 */
function envNumber(name: string, fallback: number, minimum = 0) {
  const raw = Deno.env.get(name);

  if (!raw) return fallback;

  const parsed = Number(raw);
  // `minimum` alone decides validity, so a price deliberately set to 0 (a free
  // or bundled model) is honoured, while divisors declare minimum = 1.
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function estimateResponseCost(response: unknown): number {
  const usage = (response as { usage?: Record<string, number> } | null)?.usage;

  return responseCostMicroUsd(usage, {
    inputPerMTok: envNumber('OPENAI_PRICE_TEXT_INPUT_PER_MTOK', 1_000_000),
    outputPerMTok: envNumber('OPENAI_PRICE_TEXT_OUTPUT_PER_MTOK', 4_000_000),
  });
}

export function estimateTranscriptionCost(base64Length: number): number {
  return transcriptionCostMicroUsd(
    base64Length,
    envNumber('OPENAI_PRICE_TRANSCRIBE_PER_MINUTE', 10_000),
    // expo-audio HIGH_QUALITY is ~16 kB/s on iOS; browsers encode lower. 8 kB/s
    // overestimates duration on iOS and lands near reality on the web, which
    // errs toward charging slightly more rather than under-counting.
    envNumber('OPENAI_AUDIO_BYTES_PER_SECOND', 8_000, 1),
  );
}

export function estimateSpeechCost(text: string): number {
  return speechCostMicroUsd(
    text,
    envNumber('OPENAI_PRICE_TTS_PER_MTOK', 15_000_000),
    // ~1 audio token per character of input: roughly a third of a text token
    // per character, times the several audio tokens each one becomes. Erring
    // high here matters because voice playback is the most-tapped AI feature.
    envNumber('OPENAI_TTS_AUDIO_TOKENS_PER_CHAR', 1),
  );
}
