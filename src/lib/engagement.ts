export type ActivityState = {
  totalXp: number;
  todayXp: number;
  streakDays: number;
  lastActiveDate: string;
  todayDate: string;
  todayProgress: number;
  lessonsCompleted: number;
  perfectLessons: number;
  /**
   * ISO date -> practice units completed that day, for the practice calendar.
   * Pruned to HISTORY_DAYS so the synced activity document stays small.
   */
  history: Record<string, number>;
};

export type ActivityEvent = {
  units: number;
  xp: number;
  lessonCompleted?: boolean;
  perfectLesson?: boolean;
};

export const DAILY_GOAL = 10;
/** A year of calendar history is ~5 KB of JSON, which syncs comfortably. */
export const HISTORY_DAYS = 365;

export function createInitialActivity(today: string): ActivityState {
  return {
    totalXp: 0,
    todayXp: 0,
    streakDays: 0,
    lastActiveDate: '',
    todayDate: today,
    todayProgress: 0,
    lessonsCompleted: 0,
    perfectLessons: 0,
    history: {},
  };
}

/** Days between two ISO dates; negative when `date` is before `from`. */
function daysBetween(from: string, date: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${date}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;

  return Math.round((end - start) / 86_400_000);
}

/**
 * Adds a day's practice and drops anything older than HISTORY_DAYS, so the
 * record cannot grow without bound across years of use.
 */
export function recordPracticeDay(
  history: Record<string, number>,
  date: string,
  units: number,
): Record<string, number> {
  const added = Math.max(0, units);
  const next: Record<string, number> = {
    ...history,
    [date]: (history[date] ?? 0) + added,
  };

  for (const key of Object.keys(next)) {
    const age = daysBetween(key, date);
    // Drop stale entries, and anything unparseable or dated in the future.
    if (!Number.isFinite(age) || age >= HISTORY_DAYS || age < 0) {
      if (key !== date) delete next[key];
    }
  }

  return next;
}

export function rollActivityToDate(
  state: ActivityState,
  today: string,
): ActivityState {
  if (state.todayDate === today) return state;

  const streakIsActive =
    state.lastActiveDate === today ||
    state.lastActiveDate === previousDate(today);

  return {
    ...state,
    todayDate: today,
    todayProgress: 0,
    todayXp: 0,
    streakDays: streakIsActive ? state.streakDays : 0,
  };
}

export function previousDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() - 1);
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function applyActivityEvent(
  state: ActivityState,
  event: ActivityEvent,
  today: string,
): ActivityState {
  const isNewDay = state.todayDate !== today;
  const streakDays =
    state.lastActiveDate === today
      ? state.streakDays
      : state.lastActiveDate === previousDate(today)
        ? state.streakDays + 1
        : 1;

  return {
    ...state,
    totalXp: state.totalXp + Math.max(0, event.xp),
    todayXp: (isNewDay ? 0 : state.todayXp) + Math.max(0, event.xp),
    streakDays,
    lastActiveDate: today,
    todayDate: today,
    todayProgress:
      (isNewDay ? 0 : state.todayProgress) + Math.max(0, event.units),
    lessonsCompleted:
      state.lessonsCompleted + (event.lessonCompleted ? 1 : 0),
    perfectLessons: state.perfectLessons + (event.perfectLesson ? 1 : 0),
    history: recordPracticeDay(
      state.history ?? {},
      today,
      Math.max(0, event.units),
    ),
  };
}

export type CalendarDay = {
  date: string;
  units: number;
  /** 0 = nothing, 1-3 = increasing effort. Drives the square's shade. */
  level: 0 | 1 | 2 | 3;
  isToday: boolean;
  /** True for grid cells before the window starts, which render blank. */
  padding: boolean;
};

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);

  return [
    String(value.getUTCFullYear()).padStart(4, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function weekdayOf(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function levelFor(units: number): 0 | 1 | 2 | 3 {
  if (units <= 0) return 0;
  if (units < DAILY_GOAL / 2) return 1;
  if (units < DAILY_GOAL) return 2;
  return 3;
}

/**
 * Columns of seven days ending today, for a GitHub-style calendar.
 *
 * The final column ends on today, so each row is a fixed weekday and the grid
 * reads like a calendar rather than a sliding window. Cells before the start
 * of the range are marked `padding` and render blank.
 */
export function buildPracticeCalendar(
  history: Record<string, number>,
  today: string,
  weeks = 12,
): CalendarDay[][] {
  const safeHistory = history ?? {};
  // Walk back to the Sunday that starts the earliest visible week.
  const lastColumnStart = shiftDate(today, -weekdayOf(today));
  const firstDay = shiftDate(lastColumnStart, -(weeks - 1) * 7);
  const columns: CalendarDay[][] = [];

  for (let week = 0; week < weeks; week += 1) {
    const column: CalendarDay[] = [];

    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = shiftDate(firstDay, week * 7 + weekday);
      const units = safeHistory[date] ?? 0;

      column.push({
        date,
        units,
        level: levelFor(units),
        isToday: date === today,
        // Days after today have not happened yet.
        padding: date > today,
      });
    }

    columns.push(column);
  }

  return columns;
}

export type Milestone = {
  id: string;
  label: string;
  /** Shown while locked, so the goal is never a mystery. */
  requirement: string;
  earned: boolean;
  progress: number;
  target: number;
};

export type MilestoneInput = {
  activity: Pick<
    ActivityState,
    'totalXp' | 'streakDays' | 'lessonsCompleted' | 'perfectLessons'
  >;
  /** Cards currently at cardStrength 'strong'. */
  strongCards: number;
  daysPractised: number;
};

/**
 * Derived entirely from state the app already keeps, so earning a milestone
 * stores nothing and can never drift out of sync with reality.
 */
export function earnedMilestones({
  activity,
  strongCards,
  daysPractised,
}: MilestoneInput): Milestone[] {
  const definitions: Array<Omit<Milestone, 'earned'>> = [
    {
      id: 'first-lesson',
      label: 'First lesson',
      requirement: 'Finish a lesson',
      progress: activity.lessonsCompleted,
      target: 1,
    },
    {
      id: 'streak-7',
      label: 'Week streak',
      requirement: 'Practise 7 days in a row',
      progress: activity.streakDays,
      target: 7,
    },
    {
      id: 'days-30',
      label: '30 days practised',
      requirement: 'Practise on 30 different days',
      progress: daysPractised,
      target: 30,
    },
    {
      id: 'strong-10',
      label: '10 words mastered',
      requirement: 'Get 10 cards to Strong',
      progress: strongCards,
      target: 10,
    },
    {
      id: 'perfect-lesson',
      label: 'Flawless',
      requirement: 'Finish a lesson with no mistakes',
      progress: activity.perfectLessons,
      target: 1,
    },
    {
      id: 'xp-1000',
      label: '1000 XP',
      requirement: 'Earn 1000 XP in total',
      progress: activity.totalXp,
      target: 1000,
    },
  ];

  return definitions.map((definition) => ({
    ...definition,
    earned: definition.progress >= definition.target,
  }));
}

/** Distinct days with any practice recorded. */
export function countPractisedDays(history: Record<string, number>) {
  return Object.values(history ?? {}).filter((units) => units > 0).length;
}
