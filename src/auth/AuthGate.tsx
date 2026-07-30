import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  fetchApprovalStatus,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeToAuthState,
  type ApprovalStatus,
} from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabaseConfig';

type GateState = 'loading' | 'signedOut' | 'pendingApproval' | 'approved';
type Mode = 'signIn' | 'signUp';

/**
 * Every screen in the app — including the fully-local flashcard library —
 * now requires a signed-in, admin-approved account. This wraps AppV5 from the
 * outside; AppV5.tsx itself is unchanged.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [gateState, setGateState] = useState<GateState>('loading');
  const [status, setStatus] = useState<ApprovalStatus | null>(null);
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [checkingApproval, setCheckingApproval] = useState(false);

  async function refreshStatus() {
    const result = await fetchApprovalStatus();
    setStatus(result);
    setGateState(
      !result.signedIn ? 'signedOut' : result.approved ? 'approved' : 'pendingApproval',
    );
    return result;
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setGateState('signedOut');
      return;
    }

    void refreshStatus();

    return subscribeToAuthState(() => {
      void refreshStatus();
    });
  }, []);

  async function handleSubmit() {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setNotice('Enter your email and password.');
      return;
    }
    if (mode === 'signUp' && password !== confirmPassword) {
      setNotice('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setNotice('');

    try {
      const result =
        mode === 'signUp'
          ? await signUpWithPassword(trimmedEmail, password)
          : await signInWithPassword(trimmedEmail, password);

      if (result.error) {
        setNotice(result.error);
        return;
      }

      if (mode === 'signUp') {
        setNotice(
          'Check your email to confirm your address, then sign in below. ' +
            "You'll also need approval before the app unlocks.",
        );
        setMode('signIn');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      await refreshStatus();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRefreshApproval() {
    setCheckingApproval(true);
    try {
      const result = await refreshStatus();
      if (!result.approved) {
        setNotice('Still waiting for approval.');
      }
    } finally {
      setCheckingApproval(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setNotice('');
    setGateState('signedOut');
  }

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.centeredRoot}>
        <View style={styles.card}>
          <Text style={styles.title}>Supabase is not configured</Text>
          <Text style={styles.body}>
            Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
            before the app can offer sign-in.
          </Text>
        </View>
      </View>
    );
  }

  if (gateState === 'loading') {
    return (
      <View style={styles.centeredRoot}>
        <ActivityIndicator color="#1F5E59" size="large" />
      </View>
    );
  }

  if (gateState === 'pendingApproval') {
    return (
      <View style={styles.centeredRoot}>
        <View style={styles.card}>
          <Text style={styles.title}>Waiting for approval</Text>
          <Text style={styles.body}>
            {status?.email || 'Your account'} is signed up but hasn't been
            approved yet. You'll be able to use the app once it is.
          </Text>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={checkingApproval}
            onPress={() => void handleRefreshApproval()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              checkingApproval && styles.disabled,
            ]}
          >
            {checkingApproval ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Check again</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleSignOut()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (gateState === 'approved') {
    return <>{children}</>;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.scrollRoot} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Language Learning</Text>
          <Text style={styles.subtitle}>
            {mode === 'signIn' ? 'Sign in to continue' : 'Create an account'}
          </Text>

          <View style={styles.segmentedControl}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'signIn' }}
              onPress={() => {
                setMode('signIn');
                setNotice('');
              }}
              style={[styles.segment, mode === 'signIn' && styles.segmentActive]}
            >
              <Text
                style={[
                  styles.segmentText,
                  mode === 'signIn' && styles.segmentTextActive,
                ]}
              >
                Sign in
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'signUp' }}
              onPress={() => {
                setMode('signUp');
                setNotice('');
              }}
              style={[styles.segment, mode === 'signUp' && styles.segmentActive]}
            >
              <Text
                style={[
                  styles.segmentText,
                  mode === 'signUp' && styles.segmentTextActive,
                ]}
              >
                Sign up
              </Text>
            </Pressable>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#79838C"
              style={styles.input}
              value={email}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              autoComplete="password"
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor="#79838C"
              secureTextEntry
              style={styles.input}
              value={password}
            />
          </View>

          {mode === 'signUp' ? (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                accessibilityLabel="Confirm password"
                onChangeText={setConfirmPassword}
                placeholder="Repeat your password"
                placeholderTextColor="#79838C"
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />
            </View>
          ) : null}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && !submitting && styles.pressed,
              submitting && styles.disabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {mode === 'signIn' ? 'Sign in' : 'Create account'}
              </Text>
            )}
          </Pressable>

          {mode === 'signUp' ? (
            <Text style={styles.footnote}>
              New accounts need approval before they can use the app.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F6F5F1' },
  centeredRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F5F1',
    padding: 24,
  },
  scrollRoot: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  title: { color: '#17212B', fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#52606D', fontSize: 14, fontWeight: '700' },
  body: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  notice: { color: '#B65F32', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  footnote: { color: '#79838C', fontSize: 12, lineHeight: 16, textAlign: 'center' },
  segmentedControl: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
  },
  segmentActive: { borderColor: '#24706A', backgroundColor: '#DFF1EC' },
  segmentText: { color: '#52606D', fontSize: 14, fontWeight: '800' },
  segmentTextActive: { color: '#1F5E59' },
  fieldGroup: { gap: 7 },
  label: { color: '#38424C', fontSize: 14, fontWeight: '800' },
  input: {
    minHeight: 48,
    borderColor: '#D3D0C8',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#FBFAF7',
    color: '#17212B',
    fontSize: 16,
    paddingHorizontal: 12,
  },
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
