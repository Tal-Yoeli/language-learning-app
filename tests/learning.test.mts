import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReviewResult,
  GRADES,
  initialEaseFor,
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
    ease: 2.5,
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

test('good advances a card through the spaced-review intervals', () => {
  const reviewedAt = new Date('2026-07-16T12:00:00.000Z');

  const reviewed = applyReviewResult(
    card({ known: 2, missed: 1, intervalDays: 1 }),
    'good',
    reviewedAt,
  );

  assert.equal(reviewed.known, 3);
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 3);
  assert.equal(reviewed.ease, 2.55, 'good nudges ease back up');
  assert.equal(reviewed.nextReviewAt, '2026-07-19T12:00:00.000Z');
});

test('again returns a card to a one-day interval and lowers ease', () => {
  const reviewed = applyReviewResult(
    card({ known: 4, missed: 0, intervalDays: 12 }),
    'again',
    new Date('2026-07-16T12:00:00.000Z'),
  );

  assert.equal(reviewed.known, 4, 'again must not count as a recall');
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 1);
  assert.equal(reviewed.ease, 2.25);
  assert.equal(reviewed.nextReviewAt, '2026-07-17T12:00:00.000Z');
});

test('hard keeps the card but grows the interval only slightly', () => {
  const reviewed = applyReviewResult(
    card({ known: 3, missed: 1, streak: 2, intervalDays: 10 }),
    'hard',
    NOW,
  );

  assert.equal(reviewed.known, 4, 'hard is still a recall');
  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.streak, 2, 'hard holds the streak rather than extending it');
  assert.equal(reviewed.ease, 2.35);
  assert.equal(reviewed.intervalDays, 12, '10 * 1.2');
});

test('easy grows the interval fastest and raises ease', () => {
  const good = applyReviewResult(card({ intervalDays: 10 }), 'good', NOW);
  const easy = applyReviewResult(card({ intervalDays: 10 }), 'easy', NOW);

  assert.ok(
    easy.intervalDays > good.intervalDays,
    `easy (${easy.intervalDays}) should outpace good (${good.intervalDays})`,
  );
  assert.equal(easy.ease, 2.65);
});

test('ease is clamped at both ends', () => {
  let hardened = card({ intervalDays: 5 });
  for (let index = 0; index < 12; index += 1) {
    hardened = applyReviewResult(hardened, 'again', NOW);
  }
  assert.equal(hardened.ease, 1.3, 'ease must not fall below the floor');

  let eased = card({ intervalDays: 5 });
  for (let index = 0; index < 12; index += 1) {
    eased = applyReviewResult(eased, 'easy', NOW);
  }
  assert.equal(eased.ease, 2.8, 'ease must not rise above the ceiling');
});

test('a recall on a card that is not due keeps its schedule', () => {
  // Practising ahead must not bury the card further into the future.
  const reviewed = applyReviewResult(
    card({ known: 5, missed: 1, streak: 2, intervalDays: 30, nextReviewAt: NEXT_YEAR }),
    'good',
    NOW,
  );

  assert.equal(reviewed.known, 6);
  assert.equal(reviewed.streak, 3);
  assert.equal(reviewed.intervalDays, 30, 'interval must not grow');
  assert.equal(reviewed.nextReviewAt, NEXT_YEAR, 'due date must not move');
});

test('a not-due recall still records difficulty', () => {
  // The schedule is untouched, but marking it hard must still be remembered.
  const reviewed = applyReviewResult(
    card({ known: 5, streak: 2, intervalDays: 30, nextReviewAt: NEXT_YEAR }),
    'hard',
    NOW,
  );

  assert.equal(reviewed.ease, 2.35);
  assert.equal(reviewed.nextReviewAt, NEXT_YEAR);
});

test('again reschedules even when the card was not due', () => {
  const reviewed = applyReviewResult(
    card({ known: 9, missed: 0, streak: 9, intervalDays: 60, nextReviewAt: NEXT_YEAR }),
    'again',
    NOW,
  );

  assert.equal(reviewed.missed, 1);
  assert.equal(reviewed.intervalDays, 1);
  assert.equal(reviewed.nextReviewAt, '2026-08-08T12:00:00.000Z');
});

test('streak counts consecutive recalls and resets on again', () => {
  const first = applyReviewResult(card(), 'good', NOW);
  assert.equal(first.streak, 1);

  const second = applyReviewResult(first, 'hard', NOW);
  assert.equal(second.streak, 1, 'hard holds the streak, neither losing nor gaining');

  const third = applyReviewResult(second, 'good', NOW);
  assert.equal(third.streak, 2);

  assert.equal(applyReviewResult(third, 'again', NOW).streak, 0);
});

test('intervals never exceed the ninety day cap', () => {
  const reviewed = applyReviewResult(
    card({ intervalDays: 80, ease: 2.8 }),
    'easy',
    NOW,
  );

  assert.equal(reviewed.intervalDays, 90);
});

test('a card recovers its rating after consistent correct answers', () => {
  // Lessons only emit good/again, so without an upward path a card missed
  // early would stay penalised forever however well it is later known.
  let recovering = card({ known: 1, missed: 4, ease: 1.3, intervalDays: 1 });
  assert.equal(cardStrength(recovering), 'needs-work');

  for (let index = 0; index < 25; index += 1) {
    recovering = applyReviewResult(recovering, 'good', NOW);
    recovering = { ...recovering, nextReviewAt: LONG_AGO };
  }

  assert.ok(recovering.ease > 1.3, 'ease must be able to climb back');
  assert.equal(
    cardStrength(recovering),
    'strong',
    'a card answered right many times running should stop being flagged',
  );
});

test('the four grades give a new card four different schedules', () => {
  // Rounding used to collapse them: a fresh card offered four buttons but only
  // two outcomes. `again` and `hard` still share one day at interval 0, since a
  // day is the smallest step there is.
  const fresh = card({ intervalDays: 0 });
  const freshDays = GRADES.map(
    (grade) => applyReviewResult(fresh, grade, NOW).intervalDays,
  );
  assert.deepEqual(freshDays, [1, 1, 2, 4]);

  const dayOld = card({ intervalDays: 1 });
  const dayOldDays = GRADES.map(
    (grade) => applyReviewResult(dayOld, grade, NOW).intervalDays,
  );
  assert.deepEqual(dayOldDays, [1, 2, 3, 5]);
  assert.equal(
    new Set(dayOldDays).size,
    4,
    'past the first review every grade must mean something different',
  );
});

test('legacy cards keep the verdict the old miss-rate rule gave them', () => {
  // Upgrading must not quietly promote a card the app already knew was weak.
  const halfMissed = initialEaseFor({ known: 5, missed: 5 });
  assert.equal(
    cardStrength({ known: 5, missed: 5, streak: 2, ease: halfMissed }),
    'needs-work',
    'a 50% miss rate was needs-work before and must stay needs-work',
  );

  const mostlyMissed = initialEaseFor({ known: 1, missed: 20 });
  assert.equal(
    cardStrength({ known: 1, missed: 20, streak: 3, ease: mostlyMissed }),
    'needs-work',
    'a heavily missed card must never read as strong on first load',
  );

  const clean = initialEaseFor({ known: 20, missed: 0 });
  assert.equal(clean, 2.5, 'an unblemished card starts at the default ease');

  // The documented trade-off: a card between ~22% and 40% misses starts as
  // 'learning' rather than 'strong'. Pinned here so the demotion stays a known
  // consequence rather than becoming a surprise later.
  const borderline = initialEaseFor({ known: 10, missed: 3 });
  assert.equal(
    cardStrength({ known: 10, missed: 3, streak: 4, ease: borderline }),
    'learning',
    'a borderline legacy card is demoted, never wrongly promoted',
  );
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

test('a card repeatedly graded hard is drawn more often than an easy one', () => {
  // This is the link between the four grades and how often a card returns:
  // the same known/missed record, separated only by accumulated ease.
  const record = { known: 5, missed: 1, streak: 1 };
  const struggled = practiceWeight(card({ ...record, ease: 1.3 }), NOW);
  const comfortable = practiceWeight(card({ ...record, ease: 2.8 }), NOW);

  assert.ok(
    struggled > comfortable,
    `low ease should outrank high ease, got ${struggled} vs ${comfortable}`,
  );
});

test('repeatedly grading hard outranks repeatedly grading good', () => {
  // The requirement in practice: two identical cards, separated only by how
  // the learner graded them, must diverge so the harder one comes up more.
  // A single `hard` is roughly weight-neutral (it is still a recall, which
  // dilutes the miss rate); the effect is meant to compound over sessions.
  let struggled = card({ id: 'struggled', known: 4, missed: 1, streak: 1, intervalDays: 5 });
  let comfortable = card({ id: 'comfortable', known: 4, missed: 1, streak: 1, intervalDays: 5 });

  for (let round = 0; round < 4; round += 1) {
    struggled = applyReviewResult(struggled, 'hard', NOW);
    comfortable = applyReviewResult(comfortable, 'good', NOW);
  }

  assert.ok(struggled.ease < comfortable.ease, 'hard should erode ease');

  // Same due date on both, so only the learned difficulty separates them.
  const struggledWeight = practiceWeight({ ...struggled, nextReviewAt: LONG_AGO }, NOW);
  const comfortableWeight = practiceWeight({ ...comfortable, nextReviewAt: LONG_AGO }, NOW);

  assert.ok(
    struggledWeight > comfortableWeight * 2,
    `the struggled card should dominate, got ${struggledWeight} vs ${comfortableWeight}`,
  );
});

test('card strength labels reflect the record', () => {
  assert.equal(cardStrength(card()), 'new');
  assert.equal(cardStrength(card({ known: 1, missed: 5, streak: 0 })), 'needs-work');
  assert.equal(
    cardStrength(card({ known: 9, missed: 1, streak: 5, ease: 1.5 })),
    'needs-work',
    'a long streak must not mask a card that keeps feeling hard',
  );
  assert.equal(cardStrength(card({ known: 8, missed: 1, streak: 4, ease: 2.5 })), 'strong');
  assert.equal(cardStrength(card({ known: 3, missed: 2, streak: 1, ease: 2.2 })), 'learning');
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

  assert.equal(outcomes.get('card-1'), 'again');
  assert.equal(outcomes.get('card-2'), 'good');
});
