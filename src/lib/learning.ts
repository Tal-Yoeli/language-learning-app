export type ReviewResult = 'known' | 'missed';

type ReviewableCard = {
  known: number;
  missed: number;
  /** Consecutive correct answers; reset to 0 by a miss. */
  streak: number;
  intervalDays: number;
  nextReviewAt: string;
};

const DAY_MS = 86_400_000;

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
  result: ReviewResult,
  reviewedAt = new Date(),
) {
  const currentInterval = card.intervalDays || 0;
  const streak = result === 'known' ? (card.streak || 0) + 1 : 0;

  // Practising ahead of schedule is allowed and unlimited, but a correct
  // answer on a card that is not due yet must not push its next review even
  // further out — otherwise drilling a deck for fun would bury it for months.
  // A wrong answer always pulls the card back, because that is real evidence
  // it needs work regardless of what the schedule said.
  if (result === 'known' && !isDue(card, reviewedAt)) {
    return {
      ...card,
      known: card.known + 1,
      streak,
    } as T;
  }

  const nextInterval =
    result === 'known'
      ? currentInterval <= 0
        ? 1
        : currentInterval === 1
          ? 3
          : Math.min(Math.round(currentInterval * 2), 90)
      : 1;
  const nextReview = new Date(reviewedAt);
  nextReview.setDate(nextReview.getDate() + nextInterval);

  return {
    ...card,
    [result]: card[result] + 1,
    streak,
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
    'known' | 'missed' | 'streak' | 'nextReviewAt'
  >,
  now = new Date(),
) {
  const attempts = (card.known || 0) + (card.missed || 0);
  // Unseen cards rank high so a new deck actually gets introduced.
  const base = attempts === 0 ? 3 : 1 + 4 * ((card.missed || 0) / attempts);
  const settled = base / (1 + 0.6 * (card.streak || 0));

  const overdueMs = now.getTime() - new Date(card.nextReviewAt).getTime();
  const overdueDays = overdueMs > 0 ? Math.min(overdueMs / DAY_MS, 7) : 0;
  const weight = settled * (1 + 0.15 * overdueDays);

  // Never zero: even a well-known card should surface occasionally.
  return Math.max(weight, 0.15);
}

export type CardStrength = 'new' | 'needs-work' | 'learning' | 'strong';

export function cardStrength(
  card: Pick<ReviewableCard, 'known' | 'missed' | 'streak'>,
): CardStrength {
  const attempts = (card.known || 0) + (card.missed || 0);

  if (attempts === 0) return 'new';

  const streak = card.streak || 0;
  const missRate = (card.missed || 0) / attempts;

  if (streak >= 3 && missRate < 0.4) return 'strong';
  if (streak === 0 || missRate >= 0.5) return 'needs-work';
  return 'learning';
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

export function summarizeLessonOutcomes(
  answers: Array<{ cardId: string; correct: boolean }>,
) {
  const outcomes = new Map<string, ReviewResult>();

  for (const answer of answers) {
    const current = outcomes.get(answer.cardId);
    if (!answer.correct) {
      outcomes.set(answer.cardId, 'missed');
    } else if (!current) {
      outcomes.set(answer.cardId, 'known');
    }
  }

  return outcomes;
}
