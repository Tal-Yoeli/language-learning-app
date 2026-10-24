import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyActivityEvent,
  buildPracticeCalendar,
  countPractisedDays,
  createInitialActivity,
  earnedMilestones,
  HISTORY_DAYS,
  recordPracticeDay,
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

test('practice is recorded against the day it happened', () => {
  let activity = applyActivityEvent(
    createInitialActivity('2026-09-01'),
    { units: 3, xp: 20 },
    '2026-09-01',
  );
  assert.equal(activity.history['2026-09-01'], 3);

  activity = applyActivityEvent(activity, { units: 2, xp: 10 }, '2026-09-01');
  assert.equal(activity.history['2026-09-01'], 5, 'same day accumulates');

  activity = applyActivityEvent(activity, { units: 4, xp: 10 }, '2026-09-02');
  assert.equal(activity.history['2026-09-01'], 5, 'earlier days are kept');
  assert.equal(activity.history['2026-09-02'], 4);
});

test('history is pruned at the retention boundary', () => {
  // One day inside the window and one just outside it.
  const justInside = '2026-09-02';
  const tooOld = '2025-09-01';
  const history = { [justInside]: 4, [tooOld]: 9 };

  const pruned = recordPracticeDay(history, '2026-09-03', 1);

  assert.equal(pruned[justInside], 4, 'recent history survives');
  assert.equal(pruned[tooOld], undefined, 'year-old history is dropped');
  assert.equal(pruned['2026-09-03'], 1);
  assert.ok(
    Object.keys(pruned).length <= HISTORY_DAYS,
    'the record cannot grow without bound',
  );
});

test('a garbled history entry cannot survive or crash the prune', () => {
  const pruned = recordPracticeDay({ 'not-a-date': 5 }, '2026-09-03', 2);

  assert.equal(pruned['not-a-date'], undefined);
  assert.equal(pruned['2026-09-03'], 2);
});

test('the calendar ends on today and shades by effort', () => {
  const today = '2026-09-02';
  const weeks = buildPracticeCalendar(
    { '2026-09-02': 12, '2026-09-01': 6, '2026-08-31': 2 },
    today,
    4,
  );

  assert.equal(weeks.length, 4);
  assert.ok(weeks.every((week) => week.length === 7), 'every column is a week');

  const flat = weeks.flat();
  const todayCell = flat.find((day) => day.date === today);
  assert.ok(todayCell?.isToday);
  assert.equal(todayCell?.level, 3, 'hitting the goal is the darkest shade');
  assert.equal(flat.find((d) => d.date === '2026-09-01')?.level, 2);
  assert.equal(flat.find((d) => d.date === '2026-08-31')?.level, 1);
  assert.equal(flat.find((d) => d.date === '2026-08-30')?.level, 0);
});

test('weekday rows stay aligned across a month boundary', () => {
  const weeks = buildPracticeCalendar({}, '2026-09-02', 3);

  // Row index must correspond to a fixed weekday in every column.
  for (let row = 0; row < 7; row += 1) {
    const weekdays = weeks.map((week) =>
      new Date(`${week[row].date}T00:00:00Z`).getUTCDay(),
    );
    assert.equal(
      new Set(weekdays).size,
      1,
      `row ${row} should be one weekday, got ${weekdays.join()}`,
    );
  }
});

test('days after today render as padding, not as empty practice', () => {
  // Today is a Wednesday, so the last column has future cells after it.
  const flat = buildPracticeCalendar({}, '2026-09-02', 2).flat();
  const future = flat.filter((day) => day.date > '2026-09-02');

  assert.ok(future.length > 0, 'the final week extends past today');
  assert.ok(future.every((day) => day.padding));
  assert.ok(flat.every((day) => (day.date <= '2026-09-02') !== day.padding));
});

test('milestones unlock exactly at their threshold', () => {
  const base = {
    activity: { totalXp: 0, streakDays: 6, lessonsCompleted: 0, perfectLessons: 0 },
    strongCards: 9,
    daysPractised: 0,
  };

  const before = earnedMilestones(base);
  assert.equal(before.find((m) => m.id === 'streak-7')?.earned, false);
  assert.equal(before.find((m) => m.id === 'strong-10')?.earned, false);

  const after = earnedMilestones({
    ...base,
    activity: { ...base.activity, streakDays: 7 },
    strongCards: 10,
  });
  assert.equal(after.find((m) => m.id === 'streak-7')?.earned, true);
  assert.equal(after.find((m) => m.id === 'strong-10')?.earned, true);
});

test('a locked milestone still says what it needs', () => {
  const locked = earnedMilestones({
    activity: { totalXp: 0, streakDays: 0, lessonsCompleted: 0, perfectLessons: 0 },
    strongCards: 0,
    daysPractised: 0,
  });

  assert.ok(locked.every((m) => m.requirement.length > 0));
  assert.ok(locked.every((m) => m.target > 0));
  assert.ok(locked.every((m) => !m.earned));
});

test('practised days counts only days with real practice', () => {
  assert.equal(countPractisedDays({ a: 3, b: 0, c: 1 }), 2);
  assert.equal(countPractisedDays({}), 0);
});
