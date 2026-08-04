// Pure sync-resolution rules, deliberately free of react-native and Supabase
// imports so they can be unit tested with node:test the same way
// src/lib/learning.ts is.

export type DocumentAction = 'push' | 'adopt' | 'none';

export type SyncDecision =
  | { kind: 'resolved'; library: DocumentAction; activity: DocumentAction }
  /** First sync on this device with real data on both sides — ask the user. */
  | { kind: 'ask' };

export type LocalSyncMeta = {
  /** Epoch ms of the last local write. 0 when unknown. */
  libraryUpdatedAt: number;
  activityUpdatedAt: number;
  /** 0 means this device has never completed a sync. */
  lastSyncedAt: number;
};

export type RemoteSyncMeta = {
  hasLibrary: boolean;
  hasActivity: boolean;
  /** Epoch ms; 0 when the column is null. */
  libraryUpdatedAt: number;
  activityUpdatedAt: number;
};

export type LocalContentFlags = {
  /** True when the library is still the built-in demo content, untouched. */
  libraryIsPristine: boolean;
  /** True when no XP has ever been earned on this device. */
  activityIsPristine: boolean;
};

function resolveDocument({
  remoteHas,
  remoteAt,
  localAt,
  preferRemote,
}: {
  remoteHas: boolean;
  remoteAt: number;
  localAt: number;
  preferRemote: boolean;
}): DocumentAction {
  // Nothing on the server yet: this device seeds it.
  if (!remoteHas) return 'push';

  // A device that has never synced and holds nothing of its own always yields
  // to the account. Timestamps cannot decide this: freshly seeded demo content
  // carries a *newer* local timestamp than a real library saved days ago, and
  // comparing them would overwrite the account with demo cards.
  if (preferRemote) return 'adopt';

  if (remoteAt > localAt) return 'adopt';
  if (localAt > remoteAt) return 'push';
  return 'none';
}

export function decideSyncAction(
  local: LocalSyncMeta,
  flags: LocalContentFlags,
  remote: RemoteSyncMeta | null,
): SyncDecision {
  if (!remote || (!remote.hasLibrary && !remote.hasActivity)) {
    return { kind: 'resolved', library: 'push', activity: 'push' };
  }

  const neverSynced = local.lastSyncedAt === 0;

  // The one genuinely destructive case: this device has a real library, the
  // account has a different real library, and nothing has ever reconciled
  // them. Silently picking either one throws away someone's work.
  if (neverSynced && remote.hasLibrary && !flags.libraryIsPristine) {
    return { kind: 'ask' };
  }

  return {
    kind: 'resolved',
    library: resolveDocument({
      remoteHas: remote.hasLibrary,
      remoteAt: remote.libraryUpdatedAt,
      localAt: local.libraryUpdatedAt,
      preferRemote: neverSynced && flags.libraryIsPristine,
    }),
    activity: resolveDocument({
      remoteHas: remote.hasActivity,
      remoteAt: remote.activityUpdatedAt,
      localAt: local.activityUpdatedAt,
      preferRemote: neverSynced && flags.activityIsPristine,
    }),
  };
}

type CountableLibrary = {
  languages?: Array<{ decks?: Array<{ cards?: unknown[] }> }>;
};

/** Card and deck totals, used to describe each side in the conflict dialog. */
export function summarizeLibrary(library: CountableLibrary | null | undefined) {
  const languages = library?.languages ?? [];
  let decks = 0;
  let cards = 0;

  for (const language of languages) {
    for (const deck of language.decks ?? []) {
      decks += 1;
      cards += deck.cards?.length ?? 0;
    }
  }

  return { languages: languages.length, decks, cards };
}
