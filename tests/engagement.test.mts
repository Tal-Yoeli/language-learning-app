import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyActivityEvent,
  createInitialActivity,
  rollActivityToDate,
} from '../src/lib/engagement.ts';

test('starts a streak and adds progress on the first activity', () => {
  const activity = applyActivityEvent(
    createInitialActivity('2026-07-16'),
    { units: 2, xp: 15 },
    '2026-07-16',
  );

  assert.equal(activity.streakDays, 1);
  assert.equal(activity.todayProgress, 2);
  assert.equal(activity.totalXp, 15);
  assert.equal(activity.todayXp, 15);
});

test('keeps one streak day for repeated activity on the same day', () => {
  const first = applyActivityEvent(
    createInitialActivity('2026-07-16'),
    { units: 1, xp: 5 },
    '2026-07-16',
  );
  const second = applyActivityEvent(first, { units: 3, xp: 20 }, '2026-07-16');

  assert.equal(second.streakDays, 1);
  assert.equal(second.todayProgress, 4);
  assert.equal(second.totalXp, 25);
  assert.equal(second.todayXp, 25);
});

test('continues a streak on the next day and resets daily progress', () => {
  const first = applyActivityEvent(
    createInitialActivity('2026-07-16'),
    { units: 8, xp: 40 },
    '2026-07-16',
  );
  const nextDay = applyActivityEvent(
    first,
    { units: 2, xp: 30, lessonCompleted: true, perfectLesson: true },
    '2026-07-17',
  );

  assert.equal(nextDay.streakDays, 2);
  assert.equal(nextDay.todayProgress, 2);
  assert.equal(nextDay.todayXp, 30);
  assert.equal(nextDay.lessonsCompleted, 1);
  assert.equal(nextDay.perfectLessons, 1);
});

test('restarts a streak after an inactive day', () => {
  const first = applyActivityEvent(
    createInitialActivity('2026-07-14'),
    { units: 1, xp: 5 },
    '2026-07-14',
  );
  const later = applyActivityEvent(first, { units: 1, xp: 5 }, '2026-07-16');

  assert.equal(later.streakDays, 1);
  assert.equal(later.todayProgress, 1);
});

test('rolls daily values over while preserving lifetime totals', () => {
  const first = applyActivityEvent(
    createInitialActivity('2026-07-16'),
    { units: 8, xp: 40, lessonCompleted: true },
    '2026-07-16',
  );
  const nextDay = rollActivityToDate(first, '2026-07-17');

  assert.equal(nextDay.todayProgress, 0);
  assert.equal(nextDay.todayXp, 0);
  assert.equal(nextDay.totalXp, 40);
  assert.equal(nextDay.lessonsCompleted, 1);
  assert.equal(nextDay.streakDays, 1);
});

test('clears a stale visible streak after a full inactive day', () => {
  const first = applyActivityEvent(
    createInitialActivity('2026-07-14'),
    { units: 1, xp: 5 },
    '2026-07-14',
  );

  assert.equal(rollActivityToDate(first, '2026-07-16').streakDays, 0);
});
