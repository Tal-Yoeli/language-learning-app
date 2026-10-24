import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type GoalSummary = {
  cardsPractised: number;
  xpEarned: number;
  streakDays: number;
};

/**
 * The payoff for hitting the daily goal.
 *
 * Quick review is deliberately endless, which left a session with no finish
 * line and nothing to feel on closing the app. This is that moment: shown once
 * per day, dismissible, and explicitly not a wall — practice continues behind
 * it.
 *
 * The entrance animation uses React Native's built-in Animated (works on web
 * through react-native-web, so no new dependency). A reward that simply
 * appears does not register as a reward.
 */
export default function GoalCelebration({
  summary,
  onDismiss,
}: {
  summary: GoalSummary | null;
  onDismiss: () => void;
}) {
  const visible = Boolean(summary);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }

    Animated.sequence([
      Animated.timing(progress, {
        toValue: 1.06,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(progress, {
        toValue: 1,
        friction: 6,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, progress]);

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} transparent visible={visible}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              opacity: progress.interpolate({
                inputRange: [0, 0.6, 1],
                outputRange: [0, 1, 1],
              }),
              transform: [{ scale: progress }],
            },
          ]}
        >
          <Text style={styles.kicker}>DAILY GOAL COMPLETE</Text>
          <Text style={styles.title}>
            {summary && summary.streakDays > 1
              ? `${summary.streakDays} days in a row`
              : 'Goal reached'}
          </Text>
          <Text style={styles.body}>
            That is today's practice done. Keep going if you want to — anything
            extra still counts, and your review dates stay as they are.
          </Text>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{summary?.cardsPractised ?? 0}</Text>
              <Text style={styles.statLabel}>practised</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{summary?.xpEarned ?? 0}</Text>
              <Text style={styles.statLabel}>XP today</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{summary?.streakDays ?? 0}</Text>
              <Text style={styles.statLabel}>day streak</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Keep practising</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23, 33, 43, 0.5)',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 14,
    backgroundColor: '#FFF3E7',
    borderColor: '#EACCB0',
    borderWidth: 1,
    padding: 24,
    gap: 10,
  },
  kicker: { color: '#B65F32', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  title: { color: '#17212B', fontSize: 24, fontWeight: '900' },
  body: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  statRow: { flexDirection: 'row', gap: 9, marginTop: 6 },
  stat: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingVertical: 11,
    gap: 2,
  },
  statValue: { color: '#17212B', fontSize: 21, fontWeight: '900' },
  statLabel: { color: '#52606D', fontSize: 11, fontWeight: '700' },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#1F5E59',
    marginTop: 6,
  },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  pressed: { opacity: 0.85 },
});
