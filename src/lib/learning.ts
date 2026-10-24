/** How well the learner recalled a card, worst to best. */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy'];

/** Only `again` counts as a miss; the rest are recalls of varying effort. */
export function isRecalled(grade: Grade) {
  return grade !== 'again';
}

type ReviewableCard = {
  known: number;
  missed: number;
  /** Consecutive recalls; reset to 0 by `again`. */
  streak: number;
  /**
   * SM-2 style difficulty multiplier. Lower means the card has repeatedly felt
   * hard, which both shortens its intervals and lifts it in the practice
   * queue. Counting known/missed alone cannot express *how* hard it felt.
   */
  ease: number;
  intervalDays: number;
  nextReviewAt: string;
};

const DAY_MS = 86_400_000;
const MAX_INTERVAL_DAYS = 90;
export const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;

// `good` nudges ease back up rather than leaving it flat. Lessons only ever
// emit `good` or `again`, so a flat `good` would make ease a one-way ratchet:
// a card missed a few times early could never recover, staying permanently
// weighted up no matter how reliably it was later recalled.
const EASE_DELTA: Record<Grade, number> = {
  again: -0.25,
  hard: -0.15,
  good: 0.05,
  easy: 0.15,
};

function clampEase(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_EASE;
  return Math.min(MAX_EASE, Math.max(MIN_EASE, value));
}

/** Days until the next review, given the grade and the card's current ease. */
function nextIntervalDays(
  grade: Grade,
  currentInterval: number,
  ease: number,
): number {
  const interval = currentInterval > 0 ? currentInterval : 0;

  // The first two steps are spelled out rather than left to the multipliers.
  // Rounding a 0- or 1-day interval collapses the grades together: `hard` and
  // `again` both landed on 1, and `easy` and `good` both on 3, so a new card
  // offered four buttons but only two schedules.
  //
  // `again` and `hard` still coincide at 1 day for a brand new card, because a
  // day is the smallest step available and anything longer is wrong for a card
  // just fumbled. They remain distinct in ease and streak, which is what drives
  // how often the card comes back.
  if (grade === 'again') return 1;

  if (grade === 'hard') {
    if (interval <= 0) return 1;
    return Math.min(
      MAX_INTERVAL_DAYS,
      Math.max(interval + 1, Math.round(interval * 1.2)),
    );
  }

  if (grade === 'easy') {
    if (interval <= 0) return 4;
    if (interval === 1) return 5;
    return Math.min(
      MAX_INTERVAL_DAYS,
      Math.max(interval + 2, Math.round(interval * ease * 1.3)),
    );
  }

  // good
  if (interval <= 0) return 2;
  if (interval === 1) return 3;
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(interval * ease)));
}

/**
 * Starting ease for a card saved before ease existed.
 *
 * Seeding every legacy card at DEFAULT_EASE would be a quiet data loss:
 * cardStrength keys off ease, so a card with 1 correct and 20 misses would be
 * relabelled "strong" the first time the updated app rendered it. Deriving the
 * value from the record that *was* kept avoids that.
 *
 * One linear mapping cannot reproduce both of the old thresholds at once: the
 * old rule flagged needs-work at a 50% miss rate and allowed strong below 40%,
 * and no single coefficient lands on both. This one is pinned to the
 * needs-work boundary, because wrongly reassuring someone about a weak card is
 * the harmful direction. The cost is that a legacy card between roughly 22%
 * and 40% misses starts as "learning" rather than "strong" and climbs back
 * after a few good recalls. Demotion is the safe way to be wrong.
 */
export function initialEaseFor(card: { known?: number; missed?: number }) {
  const known = Math.max(0, card.known || 0);
  const missed = Math.max(0, card.missed || 0);
  const attempts = known + missed;

  if (attempts === 0) return DEFAULT_EASE;

  // 1.8 is chosen so a 50% miss rate lands exactly on cardStrength's
  // `ease <= 1.6` boundary. That keeps the old "missRate >= 0.5 is
  // needs-work" verdict intact across the upgrade instead of quietly
  // promoting half-failed cards.
  return clampEase(DEFAULT_EASE - 1.8 * (missed / attempts));
}

export function normalizeAnswer(value: string) {
  return value
    .trim()
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/\u0640/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLocallyAcceptableAnswer(response: string, expected: string) {
  const normalizedResponse = normalizeAnswer(response);
  const normalizedExpected = normalizeAnswer(expected);

  if (!normalizedResponse || !normalizedExpected) return false;
  if (normalizedResponse === normalizedExpected) return true;

  const alternatives = expected
    .split(/[|;/]/)
    .map(normalizeAnswer)
    .filter(Boolean);

  return alternatives.includes(normalizedResponse);
}

export function isDue(card: Pick<ReviewableCard, 'nextReviewAt'>, now = new Date()) {
  return new Date(card.nextReviewAt).getTime() <= now.getTime();
}

export function applyReviewResult<T extends ReviewableCard>(
  card: T,
  grade: Grade,
  reviewedAt = new Date(),
) {
  const recalled = isRecalled(grade);
  const ease = clampEase((card.ease || DEFAULT_EASE) + EASE_DELTA[grade]);
  // `hard` holds the streak rather than extending it. The streak divisor in
  // practiceWeight is strong, so letting a struggled recall count as fluency
  // would drop the card's weight far more than the ease penalty raises it —
  // grading a card hard would have made it appear *less* often.
  const streak =
    grade === 'again'
      ? 0
      : grade === 'hard'
        ? card.streak || 0
        : (card.streak || 0) + 1;
  const counts = recalled
    ? { known: card.known + 1, missed: card.missed }
    : { known: card.known, missed: card.missed + 1 };

  // Practising ahead of schedule is allowed and unlimited, but recalling a
  // card that is not due yet must not push its next review even further out —
  // otherwise drilling a deck for fun would bury it for months. `again` always
  // pulls the card back, because that is real evidence it needs work
  // regardless of what the schedule said.
  if (recalled && !isDue(card, reviewedAt)) {
    return { ...card, ...counts, streak, ease } as T;
  }

  const nextInterval = nextIntervalDays(grade, card.intervalDays || 0, ease);
  const nextReview = new Date(reviewedAt);
  nextReview.setDate(nextReview.getDate() + nextInterval);

  return {
    ...card,
    ...counts,
    streak,
    ease,
    intervalDays: nextInterval,
    nextReviewAt: nextReview.toISOString(),
  } as T;
}

/**
 * How strongly a card should be favoured in practice. Higher means show it
 * more often. Weighted sampling on this value is what makes weak words come
 * back sooner than ones already known.
 */
export function practiceWeight(
  card: Pick<
    ReviewableCard,
    'known' | 'missed' | 'streak' | 'ease' | 'nextReviewAt'
  >,
  now = new Date(),
) {
  const attempts = (card.known || 0) + (card.missed || 0);
  // Unseen cards rank high so a new deck actually gets introduced.
  const base = attempts === 0 ? 3 : 1 + 4 * ((card.missed || 0) / attempts);
  const settled = base / (1 + 0.6 * (card.streak || 0));

  // Difficulty carried forward from earlier grades. A card repeatedly marked
  // hard sits near 1.3 and is drawn ~1.9x as often as one held at the default,
  // which is what keeps a low grade paying off in later sessions rather than
  // only shortening the next interval.
  const difficulty = DEFAULT_EASE / clampEase(card.ease || DEFAULT_EASE);

  const overdueMs = now.getTime() - new Date(card.nextReviewAt).getTime();
  const overdueDays = overdueMs > 0 ? Math.min(overdueMs / DAY_MS, 7) : 0;
  const weight = settled * difficulty * (1 + 0.15 * overdueDays);

  // Never zero: even a well-known card should surface occasionally.
  return Math.max(weight, 0.15);
}

export type CardStrength = 'new' | 'needs-work' | 'learning' | 'strong';

export function cardStrength(
  card: Pick<ReviewableCard, 'known' | 'missed' | 'streak' | 'ease'>,
): CardStrength {
  const attempts = (card.known || 0) + (card.missed || 0);

  if (attempts === 0) return 'new';

  const streak = card.streak || 0;
  const ease = clampEase(card.ease || DEFAULT_EASE);

  // Thresholds sit where a card that was once difficult can climb back with
  // consistent recalls, instead of being labelled needs-work forever.
  if (streak >= 3 && ease >= 2.1) return 'strong';
  if (streak === 0 || ease <= 1.6) return 'needs-work';
  return 'learning';
}

/**
 * Share of a deck that has reached `strong`, for the mastery ring on each deck
 * tile. `percent` is 0 for an empty deck rather than NaN.
 */
export function deckMastery(
  cards: Array<Pick<ReviewableCard, 'known' | 'missed' | 'streak' | 'ease'>>,
) {
  const total = cards.length;
  const strong = cards.filter((card) => cardStrength(card) === 'strong').length;

  return { strong, total, percent: total ? strong / total : 0 };
}

function pickWeighted<T>(
  entries: Array<{ item: T; weight: number }>,
  random: () => number,
) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return entries[0]?.item ?? null;

  let target = random() * total;

  for (const entry of entries) {
    target -= entry.weight;
    if (target <= 0) return entry.item;
  }

  return entries[entries.length - 1]?.item ?? null;
}

/**
 * Builds one round of practice.
 *
 * Every due card is included once, so nothing scheduled gets skipped. The
 * remainder of the round is sampled *with replacement*, which is what actually
 * delivers "show me weak words more often": across a session a weight-5 card
 * appears roughly five times as often as a weight-1 card.
 *
 * The same card is never placed twice in a row. In a two-card deck that rule
 * forces strict alternation and weighting cannot express itself — unavoidable,
 * since there is nothing else to show.
 */
export function buildPracticeQueue<
  T extends ReviewableCard & { id: string },
>(
  cards: T[],
  {
    now = new Date(),
    length,
    random = Math.random,
  }: { now?: Date; length?: number; random?: () => number } = {},
): T[] {
  if (!cards.length) return [];

  const targetLength = Math.max(1, length ?? Math.max(cards.length, 10));
  const weighted = cards.map((item) => ({
    item,
    weight: practiceWeight(item, now),
  }));

  // Due cards first, ordered by weight through a weighted shuffle so the
  // weakest of them tend to come up early.
  const duePool = weighted.filter(({ item }) => isDue(item, now));
  const queue: T[] = [];
  const remaining = [...duePool];

  while (remaining.length && queue.length < targetLength) {
    const picked = pickWeighted(remaining, random);
    if (!picked) break;

    queue.push(picked);
    remaining.splice(
      remaining.findIndex((entry) => entry.item.id === picked.id),
      1,
    );
  }

  // Fill the rest by weight, avoiding an immediate repeat of the last card.
  while (queue.length < targetLength) {
    const previousId = queue[queue.length - 1]?.id;
    const candidates =
      weighted.length > 1
        ? weighted.filter(({ item }) => item.id !== previousId)
        : weighted;
    const picked = pickWeighted(candidates, random);

    if (!picked) break;
    queue.push(picked);
  }

  return queue;
}

/**
 * Lessons only know right or wrong, so they map onto the middle of the scale:
 * a correct answer is `good`, never `easy`, since nothing in a lesson signals
 * that the card was effortless.
 */
export function summarizeLessonOutcomes(
  answers: Array<{ cardId: string; correct: boolean }>,
) {
  const outcomes = new Map<string, Grade>();

  for (const answer of answers) {
    const current = outcomes.get(answer.cardId);
    if (!answer.correct) {
      outcomes.set(answer.cardId, 'again');
    } else if (!current) {
      outcomes.set(answer.cardId, 'good');
    }
  }

  return outcomes;
}
