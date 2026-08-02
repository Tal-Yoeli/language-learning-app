import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabasePublicConfig } from '../lib/supabaseConfig';

/**
 * The admin-facing "approve this account?" screen, opened from the link in the
 * signup notification email (`/?approve=<token>`).
 *
 * This lives in the app rather than in the Edge Function because Supabase's
 * Edge Runtime forces `Content-Type: text/plain` and a `sandbox` CSP on every
 * function response — a browser renders such a page as raw source and any form
 * inside it is inert. The function now returns JSON and this screen provides
 * the actual button.
 *
 * The token in the URL is the credential; no sign-in is required, which is why
 * this renders ahead of the normal auth gate.
 */

type LookupState =
  | { phase: 'loading' }
  | { phase: 'ready'; email: string; alreadyApproved: boolean }
  | { phase: 'done'; email: string; alreadyApproved: boolean }
  | { phase: 'error'; message: string };

const endpoint = `${supabasePublicConfig.url}/functions/v1/approve-user`;

export default function AdminApproval({
  token,
  onDismiss,
}: {
  token: string;
  onDismiss: () => void;
}) {
  const [state, setState] = useState<LookupState>({ phase: 'loading' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `${endpoint}?token=${encodeURIComponent(token)}`,
        );
        const body = (await response.json()) as {
          found?: boolean;
          email?: string | null;
          approved?: boolean;
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok || !body.found) {
          setState({
            phase: 'error',
            message: body.error ?? 'This approval link is not valid.',
          });
          return;
        }

        setState({
          phase: 'ready',
          email: body.email ?? '(no email on file)',
          alreadyApproved: Boolean(body.approved),
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: 'error',
          message:
            error instanceof Error ? error.message : 'Could not reach the server.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleApprove() {
    setSubmitting(true);

    try {
      const response = await fetch(
        `${endpoint}?token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const body = (await response.json()) as {
        approved?: boolean;
        alreadyApproved?: boolean;
        email?: string | null;
        error?: string;
      };

      if (!response.ok || !body.approved) {
        setState({
          phase: 'error',
          message: body.error ?? 'Could not approve this account.',
        });
        return;
      }

      setState({
        phase: 'done',
        email: body.email ?? '(no email on file)',
        alreadyApproved: Boolean(body.alreadyApproved),
      });
    } catch (error) {
      setState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : 'Could not reach the server.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        {state.phase === 'loading' ? (
          <>
            <Text style={styles.title}>Checking this link…</Text>
            <ActivityIndicator color="#1F5E59" />
          </>
        ) : null}

        {state.phase === 'error' ? (
          <>
            <Text style={styles.title}>Link no longer valid</Text>
            <Text style={styles.body}>{state.message}</Text>
          </>
        ) : null}

        {state.phase === 'ready' && state.alreadyApproved ? (
          <>
            <Text style={styles.title}>Already approved</Text>
            <Text style={styles.body}>
              {state.email} was approved earlier and can already sign in.
            </Text>
          </>
        ) : null}

        {state.phase === 'ready' && !state.alreadyApproved ? (
          <>
            <Text style={styles.title}>Approve this account?</Text>
            <Text style={styles.body}>
              <Text style={styles.strong}>{state.email}</Text> is waiting to use
              the Language Learning app.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
              disabled={submitting}
              onPress={() => void handleApprove()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !submitting && styles.pressed,
                submitting && styles.disabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Approve</Text>
              )}
            </Pressable>
          </>
        ) : null}

        {state.phase === 'done' ? (
          <>
            <Text style={styles.title}>
              {state.alreadyApproved ? 'Already approved' : 'Approved'}
            </Text>
            <Text style={styles.body}>
              <Text style={styles.strong}>{state.email}</Text> can now sign in to
              the Language Learning app.
            </Text>
          </>
        ) : null}

        {state.phase !== 'loading' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Continue to the app</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F5F1',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 24,
    gap: 14,
  },
  title: { color: '#17212B', fontSize: 20, fontWeight: '900' },
  body: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  strong: { color: '#17212B', fontWeight: '800' },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#1F5E59',
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#E8EDF0',
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: '#38424C', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
