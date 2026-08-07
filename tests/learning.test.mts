import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReviewResult,
  buildPracticeQueue,
  cardStrength,
  isLocallyAcceptableAnswer,
  normalizeAnswer,
  practiceWeight,
  summarizeLessonOutcomes,
} from '../src/lib/learning.ts';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const LONG_AGO = new Date(0).toISOString();
const NEXT_YEAR = new Date('2027-08-07T12:00:00.000Z').toISOString();

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card',
    known: 0,
    missed: 0,
    streak: 0,
    intervalDays: 0,
    nextReviewAt: LONG_AGO,
    ...overrides,
  };
}

/** Deterministic stand-in for Math.random, cycling through fixed draws. */
function seededRandom(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

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

  const reviewed = applyReviewResult(
    card({ known: 2, missed: 1, intervalDays: 1 }),
    'known',
    reviewedAt,
  );

  assert.equal(reviewed.known, 3);
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 3);
  assert.equal(reviewed.nextReviewAt, '2026-07-19T12:00:00.000Z');
});

test('returns missed cards to a one-day interval', () => {
  const reviewed = applyReviewResult(
    card({ known: 4, missed: 0, intervalDays: 12 }),
    'missed',
    new Date('2026-07-16T12:00:00.000Z'),
  );

  assert.equal(reviewed.known, 4);
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 1);
  assert.equal(reviewed.nextReviewAt, '2026-07-17T12:00:00.000Z');
});

test('a correct answer on a card that is not due keeps its schedule', () => {
  // Practising ahead must not bury the card further into the future.
  const reviewed = applyReviewResult(
    card({ known: 5, missed: 1, streak: 2, intervalDays: 30, nextReviewAt: NEXT_YEAR }),
    'known',
    NOW,
  );

  assert.equal(reviewed.known, 6);
  assert.equal(reviewed.streak, 3);
  assert.equal(reviewed.intervalDays, 30, 'interval must not grow');
  assert.equal(reviewed.nextReviewAt, NEXT_YEAR, 'due date must not move');
});

test('a wrong answer reschedules even when the card was not due', () => {
  const reviewed = applyReviewResult(
    card({ known: 9, missed: 0, streak: 9, intervalDays: 60, nextReviewAt: NEXT_YEAR }),
    'missed',
    NOW,
  );

  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 1);
  assert.equal(reviewed.nextReviewAt, '2026-08-08T12:00:00.000Z');
});

test('streak counts consecutive correct answers and resets on a miss', () => {
  const first = applyReviewResult(card(), 'known', NOW);
  assert.equal(first.streak, 1);

  const second = applyReviewResult(first, 'known', NOW);
  assert.equal(second.streak, 2);

  assert.equal(applyReviewResult(second, 'missed', NOW).streak, 0);
});

test('weaker cards outweigh stronger ones', () => {
  const weak = practiceWeight(card({ known: 1, missed: 4 }), NOW);
  const clean = practiceWeight(card({ known: 5, missed: 0 }), NOW);
  const unseen = practiceWeight(card(), NOW);

  assert.ok(weak > clean, 'a frequently missed card should rank above a clean one');
  assert.ok(unseen > clean, 'a brand new card should rank above a known one');
});

test('a long correct streak pushes a card down the queue', () => {
  const base = { known: 6, missed: 2 };
  const fresh = practiceWeight(card({ ...base, streak: 0 }), NOW);
  const settled = practiceWeight(card({ ...base, streak: 5 }), NOW);

  assert.ok(settled < fresh);
  assert.ok(settled >= 0.15, 'nothing should drop to zero and vanish forever');
});

test('being overdue raises a card, and future cards are not boosted', () => {
  const overdue = practiceWeight(
    card({ known: 3, missed: 1, nextReviewAt: '2026-08-01T12:00:00.000Z' }),
    NOW,
  );
  const notYetDue = practiceWeight(
    card({ known: 3, missed: 1, nextReviewAt: NEXT_YEAR }),
    NOW,
  );

  assert.ok(overdue > notYetDue);
});

test('card strength labels reflect the record', () => {
  assert.equal(cardStrength(card()), 'new');
  assert.equal(cardStrength(card({ known: 1, missed: 5, streak: 0 })), 'needs-work');
  assert.equal(cardStrength(card({ known: 8, missed: 1, streak: 4 })), 'strong');
  assert.equal(cardStrength(card({ known: 3, missed: 2, streak: 1 })), 'learning');
});

test('a practice round includes every due card', () => {
  const cards = [
    card({ id: 'a' }),
    card({ id: 'b' }),
    card({ id: 'c', nextReviewAt: NEXT_YEAR }),
  ];

  const queue = buildPracticeQueue(cards, {
    now: NOW,
    length: 2,
    random: seededRandom([0.1, 0.6, 0.3]),
  });

  assert.equal(queue.length, 2);
  const ids = new Set(queue.map((entry) => entry.id));
  assert.ok(ids.has('a') && ids.has('b'), 'both due cards should appear');
});

test('a round longer than the deck repeats cards without adjacent duplicates', () => {
  const cards = [card({ id: 'a' }), card({ id: 'b' })];

  const queue = buildPracticeQueue(cards, {
    now: NOW,
    length: 8,
    random: seededRandom([0.1, 0.9, 0.4, 0.7, 0.2, 0.55, 0.85, 0.3]),
  });

  assert.equal(queue.length, 8, 'practice should not run out');
  for (let index = 1; index < queue.length; index += 1) {
    assert.notEqual(
      queue[index].id,
      queue[index - 1].id,
      `card repeated back to back at position ${index}`,
    );
  }
});

test('the queue is deterministic for a given random source', () => {
  const cards = [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })];
  const draws = [0.2, 0.5, 0.8, 0.35, 0.65, 0.1];

  const first = buildPracticeQueue(cards, {
    now: NOW,
    length: 6,
    random: seededRandom(draws),
  });
  const second = buildPracticeQueue(cards, {
    now: NOW,
    length: 6,
    random: seededRandom(draws),
  });

  assert.deepEqual(
    first.map((entry) => entry.id),
    second.map((entry) => entry.id),
  );
});

test('weak cards are drawn more often than strong ones over a long round', () => {
  const cards = [
    card({ id: 'weak', known: 1, missed: 6, streak: 0 }),
    ...['s1', 's2', 's3', 's4', 's5'].map((id) =>
      card({ id, known: 10, missed: 0, streak: 6 }),
    ),
  ];

  // Textbook LCG. The state must stay an integer; feeding the divided value
  // back in collapses the sequence to a constant.
  let state = 12345;
  const queue = buildPracticeQueue(cards, {
    now: NOW,
    length: 300,
    random: () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    },
  });

  const counts = new Map<string, number>();
  for (const entry of queue) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }

  const weak = counts.get('weak') ?? 0;
  const strongest = Math.max(
    ...['s1', 's2', 's3', 's4', 's5'].map((id) => counts.get(id) ?? 0),
  );

  assert.ok(
    weak > strongest * 2,
    `expected the weak card to dominate, got weak=${weak} best strong=${strongest}`,
  );
  assert.ok(
    weak > queue.length / cards.length,
    'the weak card should beat an even split',
  );
});

test('a two-card deck alternates, because no card may repeat back to back', () => {
  // A documented consequence of the anti-repeat rule: with only two cards
  // there is no other card to show, so weighting cannot express itself.
  const queue = buildPracticeQueue(
    [
      card({ id: 'weak', known: 1, missed: 6 }),
      card({ id: 'strong', known: 9, missed: 0, streak: 5 }),
    ],
    { now: NOW, length: 6, random: seededRandom([0.1, 0.9, 0.4, 0.6, 0.2, 0.8]) },
  );

  for (let index = 1; index < queue.length; index += 1) {
    assert.notEqual(queue[index].id, queue[index - 1].id);
  }
});

test('an empty deck produces an empty queue', () => {
  assert.deepEqual(buildPracticeQueue([], { now: NOW, length: 5 }), []);
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
