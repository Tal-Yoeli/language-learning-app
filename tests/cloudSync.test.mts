import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decideSyncAction,
  summarizeLibrary,
  type LocalContentFlags,
  type LocalSyncMeta,
  type RemoteSyncMeta,
} from '../src/lib/syncDecision.ts';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

function localMeta(overrides: Partial<LocalSyncMeta> = {}): LocalSyncMeta {
  return {
    libraryUpdatedAt: NOW,
    activityUpdatedAt: NOW,
    lastSyncedAt: NOW - HOUR,
    ...overrides,
  };
}

function remoteMeta(overrides: Partial<RemoteSyncMeta> = {}): RemoteSyncMeta {
  return {
    hasLibrary: true,
    hasActivity: true,
    libraryUpdatedAt: NOW,
    activityUpdatedAt: NOW,
    ...overrides,
  };
}

const usedFlags: LocalContentFlags = {
  libraryIsPristine: false,
  activityIsPristine: false,
};
const pristineFlags: LocalContentFlags = {
  libraryIsPristine: true,
  activityIsPristine: true,
};

test('an empty account is seeded from this device', () => {
  assert.deepEqual(decideSyncAction(localMeta(), usedFlags, null), {
    kind: 'resolved',
    library: 'push',
    activity: 'push',
  });

  assert.deepEqual(
    decideSyncAction(
      localMeta(),
      usedFlags,
      remoteMeta({ hasLibrary: false, hasActivity: false }),
    ),
    { kind: 'resolved', library: 'push', activity: 'push' },
  );
});

test('a fresh device with only demo content adopts the account library', () => {
  const decision = decideSyncAction(
    // Demo content was seeded just now, so it is *newer* than the account's
    // real library. Timestamps alone would wrongly overwrite the account.
    localMeta({ lastSyncedAt: 0, libraryUpdatedAt: NOW }),
    pristineFlags,
    remoteMeta({ libraryUpdatedAt: NOW - 10 * HOUR, activityUpdatedAt: NOW - 10 * HOUR }),
  );

  assert.deepEqual(decision, { kind: 'resolved', library: 'adopt', activity: 'adopt' });
});

test('real data on both sides, never synced, asks instead of guessing', () => {
  const decision = decideSyncAction(
    localMeta({ lastSyncedAt: 0 }),
    usedFlags,
    remoteMeta(),
  );

  assert.deepEqual(decision, { kind: 'ask' });
});

test('a never-synced device with real data still seeds an empty account', () => {
  // No conflict exists when the account holds nothing, so do not ask.
  const decision = decideSyncAction(
    localMeta({ lastSyncedAt: 0 }),
    usedFlags,
    remoteMeta({ hasLibrary: false, hasActivity: false }),
  );

  assert.deepEqual(decision, { kind: 'resolved', library: 'push', activity: 'push' });
});

test('once synced, the newer side wins per document', () => {
  const newerRemote = decideSyncAction(
    localMeta({ libraryUpdatedAt: NOW - HOUR }),
    usedFlags,
    remoteMeta({ libraryUpdatedAt: NOW }),
  );
  assert.deepEqual(newerRemote, {
    kind: 'resolved',
    library: 'adopt',
    activity: 'none',
  });

  const newerLocal = decideSyncAction(
    localMeta({ libraryUpdatedAt: NOW }),
    usedFlags,
    remoteMeta({ libraryUpdatedAt: NOW - HOUR }),
  );
  assert.deepEqual(newerLocal, {
    kind: 'resolved',
    library: 'push',
    activity: 'none',
  });
});

test('the library and the activity record resolve independently', () => {
  const decision = decideSyncAction(
    localMeta({ libraryUpdatedAt: NOW, activityUpdatedAt: NOW - 2 * HOUR }),
    usedFlags,
    remoteMeta({ libraryUpdatedAt: NOW - 2 * HOUR, activityUpdatedAt: NOW }),
  );

  assert.deepEqual(decision, {
    kind: 'resolved',
    library: 'push',
    activity: 'adopt',
  });
});

test('identical timestamps transfer nothing', () => {
  const decision = decideSyncAction(localMeta(), usedFlags, remoteMeta());

  assert.deepEqual(decision, {
    kind: 'resolved',
    library: 'none',
    activity: 'none',
  });
});

test('a device missing only the activity record pushes just that', () => {
  const decision = decideSyncAction(
    localMeta(),
    usedFlags,
    remoteMeta({ hasActivity: false }),
  );

  assert.deepEqual(decision, {
    kind: 'resolved',
    library: 'none',
    activity: 'push',
  });
});

test('library summaries describe each side of a conflict', () => {
  const summary = summarizeLibrary({
    languages: [
      { decks: [{ cards: [1, 2, 3] }, { cards: [] }] },
      { decks: [{ cards: [1] }] },
    ],
  });

  assert.deepEqual(summary, { languages: 2, decks: 3, cards: 4 });
  assert.deepEqual(summarizeLibrary(null), { languages: 0, decks: 0, cards: 0 });
  assert.deepEqual(summarizeLibrary({}), { languages: 0, decks: 0, cards: 0 });
});
