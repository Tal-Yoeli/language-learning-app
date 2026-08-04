import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase, type Database } from './supabase';
import type { LocalSyncMeta, RemoteSyncMeta } from './syncDecision';

type UserStateInsert = Database['public']['Tables']['user_state']['Insert'];

export const SYNC_META_STORAGE_KEY = 'language-learning/sync/v1';

export type RemoteState<TLibrary, TActivity> = {
  library: TLibrary | null;
  activity: TActivity | null;
  meta: RemoteSyncMeta;
};

const EMPTY_META: LocalSyncMeta = {
  libraryUpdatedAt: 0,
  activityUpdatedAt: 0,
  lastSyncedAt: 0,
};

function toEpoch(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function readLocalSyncMeta(): Promise<LocalSyncMeta> {
  try {
    const stored = await AsyncStorage.getItem(SYNC_META_STORAGE_KEY);
    if (!stored) return EMPTY_META;

    const parsed = JSON.parse(stored) as Partial<LocalSyncMeta>;

    return {
      libraryUpdatedAt: Number(parsed.libraryUpdatedAt) || 0,
      activityUpdatedAt: Number(parsed.activityUpdatedAt) || 0,
      lastSyncedAt: Number(parsed.lastSyncedAt) || 0,
    };
  } catch {
    return EMPTY_META;
  }
}

export async function writeLocalSyncMeta(meta: Partial<LocalSyncMeta>) {
  const current = await readLocalSyncMeta();
  const next = { ...current, ...meta };

  try {
    await AsyncStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed metadata write only costs an extra reconciliation next launch.
  }

  return next;
}

export async function fetchRemoteState<TLibrary, TActivity>(): Promise<
  RemoteState<TLibrary, TActivity>
> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;

  if (!userId) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('user_state')
    .select('library, activity, library_updated_at, activity_updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    library: (data?.library as TLibrary | null) ?? null,
    activity: (data?.activity as TActivity | null) ?? null,
    meta: {
      hasLibrary: Boolean(data?.library),
      hasActivity: Boolean(data?.activity),
      libraryUpdatedAt: toEpoch(data?.library_updated_at),
      activityUpdatedAt: toEpoch(data?.activity_updated_at),
    },
  };
}

/**
 * Writes only the documents asked for, so pushing a changed library never
 * clobbers an activity record that another device updated more recently.
 */
export async function pushRemoteState({
  library,
  activity,
  libraryUpdatedAt,
  activityUpdatedAt,
}: {
  library?: unknown;
  activity?: unknown;
  libraryUpdatedAt?: number;
  activityUpdatedAt?: number;
}) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;

  if (!userId) throw new Error('Not signed in.');

  const payload: UserStateInsert = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };

  if (library !== undefined) {
    payload.library = library;
    payload.library_updated_at = new Date(
      libraryUpdatedAt ?? Date.now(),
    ).toISOString();
  }

  if (activity !== undefined) {
    payload.activity = activity;
    payload.activity_updated_at = new Date(
      activityUpdatedAt ?? Date.now(),
    ).toISOString();
  }

  const { error } = await supabase
    .from('user_state')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) throw new Error(error.message);
}
