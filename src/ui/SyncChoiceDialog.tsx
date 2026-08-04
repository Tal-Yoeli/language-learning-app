import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type LibrarySummary = {
  languages: number;
  decks: number;
  cards: number;
};

export type SyncChoiceRequest = {
  local: LibrarySummary;
  remote: LibrarySummary;
  onChoose: (choice: 'useRemote' | 'useLocal') => void;
};

function describe(summary: LibrarySummary) {
  const plural = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? '' : 's'}`;

  return `${plural(summary.cards, 'card')} in ${plural(summary.decks, 'deck')}`;
}

/**
 * Shown once, the first time a device with real content signs into an account
 * that already has a different library. Both sides represent real work, so the
 * choice is the user's rather than a silent last-write-wins.
 *
 * Deliberately has no dismiss affordance: closing it without choosing would
 * leave the device in an unreconciled state that the next launch would only
 * ask about again.
 */
export default function SyncChoiceDialog({
  request,
}: {
  request: SyncChoiceRequest | null;
}) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(request)}>
      <View style={styles.backdrop}>
        <View accessibilityRole="alert" accessibilityViewIsModal style={styles.dialog}>
          <Text style={styles.title}>Two libraries found</Text>
          <Text style={styles.message}>
            This device and your account each have saved cards. Choose which one
            to keep — the other will be replaced everywhere.
          </Text>

          <View style={styles.option}>
            <Text style={styles.optionLabel}>Your account</Text>
            <Text style={styles.optionDetail}>
              {request ? describe(request.remote) : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => request?.onChoose('useRemote')}
            style={({ pressed }) => [
              styles.button,
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryText}>Keep my account's library</Text>
          </Pressable>

          <View style={styles.option}>
            <Text style={styles.optionLabel}>This device</Text>
            <Text style={styles.optionDetail}>
              {request ? describe(request.local) : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => request?.onChoose('useLocal')}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryText}>Upload this device's library</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23, 33, 43, 0.45)',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 20,
    gap: 10,
  },
  title: { color: '#17212B', fontSize: 18, fontWeight: '900' },
  message: { color: '#52606D', fontSize: 14, lineHeight: 20, marginBottom: 4 },
  option: { marginTop: 6 },
  optionLabel: { color: '#38424C', fontSize: 13, fontWeight: '800' },
  optionDetail: { color: '#79838C', fontSize: 13 },
  button: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  primaryButton: { backgroundColor: '#1F5E59' },
  secondaryButton: { backgroundColor: '#E8EDF0' },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryText: { color: '#38424C', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
