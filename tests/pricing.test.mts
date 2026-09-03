import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MICRO_USD_PER_USD,
  responseCostMicroUsd,
  speechCostMicroUsd,
  transcriptionCostMicroUsd,
} from '../supabase/functions/_shared/costMath.ts';

// Matches the defaults in pricing.ts.
const TEXT = { inputPerMTok: 1_000_000, outputPerMTok: 4_000_000 };
const TRANSCRIBE_PER_MINUTE = 10_000;
const AUDIO_BYTES_PER_SECOND = 8_000;
const TTS_PER_MTOK = 15_000_000;
const TTS_AUDIO_TOKENS_PER_CHAR = 1;

test('token usage converts to whole micro-USD, always rounded up', () => {
  assert.equal(responseCostMicroUsd({ input_tokens: 1000, output_tokens: 500 }, TEXT), 3000);

  // A sub-micro-dollar call must never round down to free.
  assert.equal(responseCostMicroUsd({ input_tokens: 1 }, TEXT), 1);
  assert.ok(responseCostMicroUsd({ output_tokens: 1 }, TEXT) >= 1);
});

test('absent or nonsensical usage costs nothing rather than NaN', () => {
  assert.equal(responseCostMicroUsd(undefined, TEXT), 0);
  assert.equal(responseCostMicroUsd(null, TEXT), 0);
  assert.equal(responseCostMicroUsd({}, TEXT), 0);
  assert.equal(responseCostMicroUsd({ input_tokens: -5, output_tokens: -5 }, TEXT), 0);
  assert.equal(
    responseCostMicroUsd({ input_tokens: Number.NaN } as never, TEXT),
    0,
  );
});

test('a real 30 second recording is not priced as several minutes', () => {
  // Regression guard for a bytes/second assumption that was 8x too tight and
  // scored a half-minute clip as four minutes, burning the month in about a
  // dozen attempts. The clip size below is what the app ACTUALLY produces --
  // expo-audio's HIGH_QUALITY preset, ~16 kB/s -- deliberately NOT the
  // constant the estimator is configured with, or the test proves nothing.
  const REAL_IOS_BYTES_PER_SECOND = 16_000;
  const realThirtySecondClip = 30 * REAL_IOS_BYTES_PER_SECOND;
  const base64Length = Math.ceil((realThirtySecondClip * 4) / 3);

  const cost = transcriptionCostMicroUsd(
    base64Length,
    TRANSCRIBE_PER_MINUTE,
    AUDIO_BYTES_PER_SECOND,
  );

  // True cost is half a minute. Overestimating is intended, but not wildly:
  // cap the exaggeration at 2.5x so the budget stays usable.
  const trueCost = TRANSCRIBE_PER_MINUTE / 2;
  assert.ok(cost >= trueCost, `must not undercharge, got ${cost} vs ${trueCost}`);
  assert.ok(
    cost <= trueCost * 2.5,
    `overestimate must stay bounded, got ${cost} vs ${trueCost}`,
  );
});

test('the monthly budget affords a usable number of speaking attempts', () => {
  const base64Length = Math.ceil((30 * AUDIO_BYTES_PER_SECOND * 4) / 3);
  const perAttempt = transcriptionCostMicroUsd(
    base64Length,
    TRANSCRIBE_PER_MINUTE,
    AUDIO_BYTES_PER_SECOND,
  );
  const budget = MICRO_USD_PER_USD / 2;

  assert.ok(
    budget / perAttempt >= 50,
    `expected 50+ speaking attempts per month, got ${budget / perAttempt}`,
  );
});

test('transcription cost never goes negative or divides by zero', () => {
  assert.equal(transcriptionCostMicroUsd(0, TRANSCRIBE_PER_MINUTE, AUDIO_BYTES_PER_SECOND), 0);
  assert.equal(transcriptionCostMicroUsd(-100, TRANSCRIBE_PER_MINUTE, AUDIO_BYTES_PER_SECOND), 0);
  assert.ok(Number.isFinite(transcriptionCostMicroUsd(1000, TRANSCRIBE_PER_MINUTE, 0)));
});

test('speech is charged per token and never free for real text', () => {
  assert.equal(speechCostMicroUsd('', TTS_PER_MTOK, TTS_AUDIO_TOKENS_PER_CHAR), 0);
  assert.ok(speechCostMicroUsd('a', TTS_PER_MTOK, TTS_AUDIO_TOKENS_PER_CHAR) >= 1);

  const sentence = 'Where is the train station, please?';
  const cost = speechCostMicroUsd(sentence, TTS_PER_MTOK, TTS_AUDIO_TOKENS_PER_CHAR);
  const budget = MICRO_USD_PER_USD / 2;

  // Voice playback is tapped constantly, so it must stay affordable while
  // still being counted at a rate that reflects audio output rather than input.
  assert.ok(
    budget / cost >= 50,
    `expected 50+ spoken sentences per month, got ${budget / cost}`,
  );
});

test('a month of typical card generation fits inside fifty cents', () => {
  const deckBuild = responseCostMicroUsd(
    { input_tokens: 1_200, output_tokens: 3_500 },
    TEXT,
  );
  const budget = MICRO_USD_PER_USD / 2;

  assert.ok(deckBuild > 0);
  assert.ok(
    budget / deckBuild >= 20,
    `expected 20+ deck builds per month, got ${budget / deckBuild}`,
  );
});

test('integer micro-USD accumulates without drift', () => {
  // The reason money is stored as integers rather than fractional dollars.
  let micro = 0;
  for (let index = 0; index < 10_000; index += 1) micro += 7;
  assert.equal(micro, 70_000, 'integers stay exact');

  let dollars = 0;
  for (let index = 0; index < 10_000; index += 1) dollars += 0.000007;
  assert.notEqual(dollars, 0.07, 'floats do not, which is why we avoid them');
});

test('the reservation covers a realistic expensive call', () => {
  // consume_ai_quota reserves 25000 micro-USD before a call and reconciles
  // afterwards. If a real call can cost more than the reservation, a burst of
  // concurrent requests slips past the budget check together. Keep this in
  // step with ai_spend_reservation_micro_usd() in the migration.
  const RESERVATION_MICRO_USD = 25_000;

  const deckBuild = responseCostMicroUsd(
    { input_tokens: 1_200, output_tokens: 3_500 },
    TEXT,
  );

  assert.ok(
    deckBuild <= RESERVATION_MICRO_USD,
    `a deck build (${deckBuild}) must not exceed the reservation (${RESERVATION_MICRO_USD})`,
  );

  // And the reservation must stay small enough that the month is still usable.
  assert.ok(
    MICRO_USD_PER_USD / 2 / RESERVATION_MICRO_USD >= 20,
    'a $0.50 budget must allow at least 20 concurrent-safe requests',
  );
});
