import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Share of a deck's cards that have reached `strong`, as a ring.
 *
 * Turns the deck grid from a list of names into a picture of where the work
 * still is. Uses react-native-svg, already a dependency via lucide icons.
 */
export default function MasteryRing({
  percent,
  size = 34,
  label,
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  const safe = Math.min(1, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={[styles.root, { width: size, height: size }]}>
      <Svg height={size} width={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E4DED4"
          strokeWidth={stroke}
          fill="none"
        />
        {safe > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#1F5E59"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * safe} ${circumference}`}
            // Start the arc at twelve o'clock instead of three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            fill="none"
          />
        ) : null}
      </Svg>
      <Text style={styles.label}>{label ?? `${Math.round(safe * 100)}%`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  label: {
    position: 'absolute',
    color: '#52606D',
    fontSize: 9,
    fontWeight: '900',
  },
});
