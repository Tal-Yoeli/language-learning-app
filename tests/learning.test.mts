import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReviewResult,
  isLocallyAcceptableAnswer,
  normalizeAnswer,
  summarizeLessonOutcomes,
} from '../src/lib/learning.ts';

test('normalizes punctuation and diacritics in target languages', () => {
  assert.equal(normalizeAnswer('νερό!'), normalizeAnswer('νερο'));
  assert.equal(normalizeAnswer('مَرْحَبًا'), normalizeAnswer('مرحبا'));
  assert.equal(normalizeAnswer('שָׁלוֹם'), normalizeAnswer('שלום'));
});

test('accepts listed alternatives locally', () => {
  assert.equal(isLocallyAcceptableAnswer('hi', 'hello / hi'), true);
  assert.equal(isLocallyAcceptableAnswer('good night', 'good morning'), false);
});

test('leaves spelling differences and semantic synonyms for server evaluation', () => {
  assert.equal(isLocallyAcceptableAnswer('shrit', 'shirt'), false);
  assert.equal(isLocallyAcceptableAnswer('short', 'shirt'), false);
  assert.equal(isLocallyAcceptableAnswer('automobile', 'car'), false);
});

test('advances known cards through the spaced-review intervals', () => {
  const reviewedAt = new Date('2026-07-16T12:00:00.000Z');
  const card = {
    known: 2,
    missed: 1,
    intervalDays: 1,
    nextReviewAt: new Date(0).toISOString(),
  };

  const reviewed = applyReviewResult(card, 'known', reviewedAt);

  assert.equal(reviewed.known, 3);
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 3);
  assert.equal(reviewed.nextReviewAt, '2026-07-19T12:00:00.000Z');
});

test('returns missed cards to a one-day interval', () => {
  const reviewed = applyReviewResult(
    {
      known: 4,
      missed: 0,
      intervalDays: 12,
      nextReviewAt: new Date(0).toISOString(),
    },
    'missed',
    new Date('2026-07-16T12:00:00.000Z'),
  );

  assert.equal(reviewed.known, 4);
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 1);
  assert.equal(reviewed.nextReviewAt, '2026-07-17T12:00:00.000Z');
});

test('one wrong lesson direction makes the card a missed outcome', () => {
  const outcomes = summarizeLessonOutcomes([
    { cardId: 'card-1', correct: true },
    { cardId: 'card-1', correct: false },
    { cardId: 'card-2', correct: true },
  ]);

  assert.equal(outcomes.get('card-1'), 'missed');
  assert.equal(outcomes.get('card-2'), 'known');
});
