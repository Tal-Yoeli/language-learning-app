import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createClient,
  processLock,
  type AuthSession,
  type AuthUser,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { isSupabaseConfigured, supabasePublicConfig } from './supabaseConfig';

export type { AuthSession, AuthUser };

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          native_language: string;
          learning_language: string;
          created_at: string;
          approved: boolean;
          approval_token: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          native_language?: string;
          learning_language?: string;
          created_at?: string;
          approved?: boolean;
          approval_token?: string;
        };
        Update: {
          email?: string | null;
          native_language?: string;
          learning_language?: string;
          approved?: boolean;
          approval_token?: string;
        };
        Relationships: [];
      };
      flashcards: {
        Row: {
          id: string;
          user_id: string;
          term: string;
          translation: string;
          example: string | null;
          source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          term: string;
          translation: string;
          example?: string | null;
          source?: string;
          created_at?: string;
        };
        Update: {
          term?: string;
          translation?: string;
          example?: string | null;
          source?: string;
        };
        Relationships: [];
      };
      card_reviews: {
        Row: {
          id: string;
          user_id: string;
          flashcard_id: string;
          result: 'known' | 'missed';
          reviewed_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          flashcard_id: string;
          result: 'known' | 'missed';
          reviewed_at?: string;
        };
        Update: {
          result?: 'known' | 'missed';
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(
      supabasePublicConfig.url!,
      supabasePublicConfig.anonKey!,
      {
        auth: {
          ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          lock: processLock,
        },
      },
    )
  : null;

if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/**
 * Every person who wants to use the app must register with email + password
 * and be individually approved before anything works — the app has no
 * anonymous or local-only mode anymore. The library/progress data itself
 * still lives entirely on-device (AsyncStorage / localStorage); accounts are
 * purely an access gate, not a data store.
 */

export type AuthResult = { error: string };

export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!supabase) return { error: 'Supabase is not configured.' };

  const { error } = await supabase.auth.signUp({ email, password });

  return { error: error?.message ?? '' };
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!supabase) return { error: 'Supabase is not configured.' };

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  return { error: error?.message ?? '' };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

export type ApprovalStatus = {
  signedIn: boolean;
  approved: boolean;
  email: string;
  /** Set when the status check itself failed, e.g. a network error. */
  error: string;
};

/**
 * Relies on the existing `profiles_select_own` RLS policy (auth.uid() = id),
 * so a signed-in user can always read their own approval flag and nothing
 * else's.
 */
export async function fetchApprovalStatus(): Promise<ApprovalStatus> {
  if (!supabase) {
    return { signedIn: false, approved: false, email: '', error: '' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;

  if (!user) {
    return { signedIn: false, approved: false, email: '', error: '' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('approved')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    return {
      signedIn: true,
      approved: false,
      email: user.email ?? '',
      error: error.message,
    };
  }

  return {
    signedIn: true,
    // The signup trigger inserts the profiles row in the same transaction as
    // auth.users, but a `null` row (not yet visible/replicated) is treated as
    // not-yet-approved rather than a crash.
    approved: Boolean(data?.approved),
    email: user.email ?? '',
    error: '',
  };
}

export function subscribeToAuthState(onChange: () => void) {
  if (!supabase) return () => {};

  const { data } = supabase.auth.onAuthStateChange(() => onChange());

  return () => data.subscription.unsubscribe();
}
