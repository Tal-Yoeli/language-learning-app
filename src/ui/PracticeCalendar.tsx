import { StyleSheet, Text, View } from 'react-native';

import type { CalendarDay } from '../lib/engagement';

/**
 * A GitHub-style record of practice. Plain Views rather than SVG: a fixed
 * 7-row grid needs no layout maths, stays crisp at any density, and each
 * square can carry its own accessibility label.
 *
 * Shades come from the existing palette so this reads as part of the app
 * rather than a widget bolted on.
 */
const LEVEL_COLORS = ['#EAE6DE', '#C3DED6', '#79B4A8', '#1F5E59'] as const;

export default function PracticeCalendar({ weeks }: { weeks: CalendarDay[][] }) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Last {weeks.length} weeks</Text>
        <View style={styles.legend}>
          <Text style={styles.legendLabel}>Less</Text>
          {LEVEL_COLORS.map((color) => (
            <View key={color} style={[styles.cell, { backgroundColor: color }]} />
          ))}
          <Text style={styles.legendLabel}>More</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {weeks.map((week) => (
          <View key={week[0].date} style={styles.column}>
            {week.map((day) => (
              <View
                accessibilityLabel={
                  day.padding
                    ? undefined
                    : `${day.date}: ${day.units} practised`
                }
                key={day.date}
                style={[
                  styles.cell,
                  day.padding
                    ? styles.cellPadding
                    : { backgroundColor: LEVEL_COLORS[day.level] },
                  day.isToday && styles.cellToday,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { color: '#17212B', fontSize: 14, fontWeight: '800' },
  legend: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  legendLabel: { color: '#79838C', fontSize: 10, fontWeight: '700' },
  grid: { flexDirection: 'row', gap: 3 },
  column: { flex: 1, gap: 3 },
  cell: { aspectRatio: 1, borderRadius: 2, backgroundColor: '#EAE6DE' },
  // Future days keep their slot so the weekday rows stay aligned.
  cellPadding: { backgroundColor: 'transparent' },
  cellToday: { borderColor: '#B65F32', borderWidth: 1.5 },
});
