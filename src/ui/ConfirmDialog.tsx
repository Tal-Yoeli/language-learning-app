import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * react-native-web ships `Alert.alert` as an empty function, so the iPhone-only
 * build's destructive confirmations would silently do nothing in a browser.
 * This modal replaces `Alert` on every platform so the confirm step behaves
 * identically on iOS and the web instead of diverging.
 */
export default function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={Boolean(request)}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={styles.dialog}
        >
          <Text style={styles.title}>{request?.title ?? ''}</Text>
          {request?.message ? (
            <Text style={styles.message}>{request.message}</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const confirm = request?.onConfirm;
                onCancel();
                confirm?.();
              }}
              style={({ pressed }) => [
                styles.button,
                request?.destructive
                  ? styles.destructiveButton
                  : styles.confirmButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.confirmText}>
                {request?.confirmLabel ?? 'Confirm'}
              </Text>
            </Pressable>
          </View>
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
    gap: 12,
  },
  title: { color: '#17212B', fontSize: 18, fontWeight: '900' },
  message: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 9, justifyContent: 'flex-end' },
  button: {
    minWidth: 104,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  cancelButton: { backgroundColor: '#E8EDF0' },
  confirmButton: { backgroundColor: '#1F5E59' },
  destructiveButton: { backgroundColor: '#A33A2A' },
  cancelText: { color: '#38424C', fontSize: 14, fontWeight: '800' },
  confirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
