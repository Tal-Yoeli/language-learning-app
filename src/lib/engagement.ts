export type ActivityState = {
  totalXp: number;
  todayXp: number;
  streakDays: number;
  lastActiveDate: string;
  todayDate: string;
  todayProgress: number;
  lessonsCompleted: number;
  perfectLessons: number;
};

export type ActivityEvent = {
  units: number;
  xp: number;
  lessonCompleted?: boolean;
  perfectLesson?: boolean;
};

export const DAILY_GOAL = 10;

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
  };
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
  };
}
