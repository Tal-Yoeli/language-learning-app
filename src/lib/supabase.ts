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
        };
        Insert: {
          id: string;
          email?: string | null;
          native_language?: string;
          learning_language?: string;
          created_at?: string;
        };
        Update: {
          email?: string | null;
          native_language?: string;
          learning_language?: string;
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
 * The app has no sign-in screen and stores all learner data locally, but the
 * Edge Functions need to tell one caller from another so a per-device daily
 * quota can be enforced on paid OpenAI usage. Anonymous sign-in gives each
 * install (or browser profile) its own auth.uid() without asking for an
 * account, and the session persists in AsyncStorage / localStorage.
 */
let anonymousSignIn: Promise<void> | null = null;
let lastSignInError = '';

export function getAuthBootstrapError() {
  return lastSignInError;
}

export async function ensureSession() {
  if (!supabase) return false;

  const { data } = await supabase.auth.getSession();

  if (data.session) {
    lastSignInError = '';
    return true;
  }

  if (!anonymousSignIn) {
    anonymousSignIn = (async () => {
      const { error } = await supabase.auth.signInAnonymously();

      if (error) {
        // Anonymous sign-ins are off by default in a Supabase project. Record
        // the reason so the AI error message can point at the actual fix
        // instead of a bare 401.
        lastSignInError = error.message;
        throw error;
      }

      lastSignInError = '';
    })().finally(() => {
      anonymousSignIn = null;
    });
  }

  try {
    await anonymousSignIn;
    return true;
  } catch {
    return false;
  }
}
