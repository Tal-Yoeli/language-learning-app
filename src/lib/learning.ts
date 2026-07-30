export type ReviewResult = 'known' | 'missed';

type ReviewableCard = {
  known: number;
  missed: number;
  intervalDays: number;
  nextReviewAt: string;
};

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

export function applyReviewResult<T extends ReviewableCard>(
  card: T,
  result: ReviewResult,
  reviewedAt = new Date(),
) {
  const currentInterval = card.intervalDays || 0;
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
    intervalDays: nextInterval,
    nextReviewAt: nextReview.toISOString(),
  } as T;
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
