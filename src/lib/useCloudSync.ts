import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  fetchRemoteState,
  pushRemoteState,
  readLocalSyncMeta,
  writeLocalSyncMeta,
} from './cloudSync';
import { decideSyncAction, summarizeLibrary } from './syncDecision';
import type { SyncChoiceRequest } from '../ui/SyncChoiceDialog';

const PUSH_DEBOUNCE_MS = 2_000;

export type CloudSyncOptions<TLibrary, TActivity> = {
  library: TLibrary;
  activity: TActivity;
  /** True once local storage has loaded and the user is signed in + approved. */
  ready: boolean;
  /** Untouched demo content must never overwrite a real account library. */
  libraryIsPristine: boolean;
  activityIsPristine: boolean;
  applyLibrary: (library: TLibrary) => void;
  applyActivity: (activity: TActivity) => void;
  /** Run adopted remote documents through the app's own validation. */
  normalizeLibrary: (value: unknown) => TLibrary | null;
  normalizeActivity: (value: unknown) => TActivity | null;
  onNotice?: (message: string) => void;
};

/**
 * Keeps the library and activity documents in step across a user's devices.
 *
 * Local storage stays the source of truth during a session — this pulls on
 * launch and on foreground, and pushes a debounced copy afterwards — so the app
 * continues to work offline exactly as it did before sync existed.
 *
 * Resolution is per-document last-write-wins. Two devices editing at the same
 * moment will lose the earlier push; the common case of one device sitting
 * stale for days is handled correctly because the pull always precedes any
 * push.
 */
export function useCloudSync<TLibrary, TActivity>(
  options: CloudSyncOptions<TLibrary, TActivity>,
) {
  const [syncChoice, setSyncChoice] = useState<SyncChoiceRequest | null>(null);

  // Everything the async routines need is read through this ref, so callers may
  // pass inline arrows without the pull effect re-subscribing every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Pushing before the first pull completes would let a freshly seeded device
  // overwrite a real account library.
  const pulledRef = useRef(false);
  // Serialised copies of what the server is known to hold, so adopting a remote
  // document does not immediately bounce it straight back.
  const syncedLibraryRef = useRef<string | null>(null);
  const syncedActivityRef = useRef<string | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const report = useCallback((message: string) => {
    optionsRef.current.onNotice?.(message);
  }, []);

  const resolveConflict = useCallback(
    async (
      choice: 'useRemote' | 'useLocal',
      remoteLibrary: unknown,
      remoteActivity: unknown,
    ) => {
      const now = Date.now();
      const current = optionsRef.current;

      try {
        if (choice === 'useRemote') {
          const normalizedLibrary = current.normalizeLibrary(remoteLibrary);
          const normalizedActivity = current.normalizeActivity(remoteActivity);

          if (normalizedLibrary) {
            current.applyLibrary(normalizedLibrary);
            syncedLibraryRef.current = JSON.stringify(normalizedLibrary);
          }
          if (normalizedActivity) {
            current.applyActivity(normalizedActivity);
            syncedActivityRef.current = JSON.stringify(normalizedActivity);
          }

          report('Loaded the library saved on your account.');
        } else {
          await pushRemoteState({
            library: current.library,
            activity: current.activity,
            libraryUpdatedAt: now,
            activityUpdatedAt: now,
          });
          syncedLibraryRef.current = JSON.stringify(current.library);
          syncedActivityRef.current = JSON.stringify(current.activity);
          report("Uploaded this device's library to your account.");
        }

        await writeLocalSyncMeta({
          lastSyncedAt: now,
          libraryUpdatedAt: now,
          activityUpdatedAt: now,
        });
        pulledRef.current = true;
      } catch (error) {
        report(
          error instanceof Error ? `Sync error: ${error.message}` : 'Sync error.',
        );
      }
    },
    [report],
  );

  const pull = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const [remote, localMeta] = await Promise.all([
        fetchRemoteState<unknown, unknown>(),
        readLocalSyncMeta(),
      ]);

      const current = optionsRef.current;
      const decision = decideSyncAction(
        localMeta,
        {
          libraryIsPristine: current.libraryIsPristine,
          activityIsPristine: current.activityIsPristine,
        },
        remote.meta,
      );

      if (decision.kind === 'ask') {
        setSyncChoice({
          local: summarizeLibrary(current.library as never),
          remote: summarizeLibrary(remote.library as never),
          onChoose: (choice) => {
            setSyncChoice(null);
            void resolveConflict(choice, remote.library, remote.activity);
          },
        });
        return;
      }

      const now = Date.now();

      if (decision.library === 'adopt') {
        const normalized = current.normalizeLibrary(remote.library);
        if (normalized) {
          current.applyLibrary(normalized);
          syncedLibraryRef.current = JSON.stringify(normalized);
          await writeLocalSyncMeta({
            libraryUpdatedAt: remote.meta.libraryUpdatedAt,
          });
        }
      } else if (decision.library === 'push') {
        await pushRemoteState({
          library: current.library,
          libraryUpdatedAt: localMeta.libraryUpdatedAt || now,
        });
        syncedLibraryRef.current = JSON.stringify(current.library);
      } else {
        syncedLibraryRef.current = JSON.stringify(current.library);
      }

      if (decision.activity === 'adopt') {
        const normalized = current.normalizeActivity(remote.activity);
        if (normalized) {
          current.applyActivity(normalized);
          syncedActivityRef.current = JSON.stringify(normalized);
          await writeLocalSyncMeta({
            activityUpdatedAt: remote.meta.activityUpdatedAt,
          });
        }
      } else if (decision.activity === 'push') {
        await pushRemoteState({
          activity: current.activity,
          activityUpdatedAt: localMeta.activityUpdatedAt || now,
        });
        syncedActivityRef.current = JSON.stringify(current.activity);
      } else {
        syncedActivityRef.current = JSON.stringify(current.activity);
      }

      await writeLocalSyncMeta({ lastSyncedAt: now });
      pulledRef.current = true;
    } catch (error) {
      // Offline or a transient failure must not break the app: local storage
      // still holds everything, and the next foreground retries.
      report(
        error instanceof Error
          ? `Sync unavailable: ${error.message}`
          : 'Sync unavailable.',
      );
    } finally {
      inFlightRef.current = false;
    }
  }, [report, resolveConflict]);

  // Pull on launch, and whenever the app or browser tab returns to the front.
  useEffect(() => {
    if (!options.ready) return;

    void pull();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pull();
    });

    return () => subscription.remove();
  }, [options.ready, pull]);

  // Debounced push of whichever document actually changed.
  useEffect(() => {
    if (!options.ready || !pulledRef.current) return;

    const librarySerialized = JSON.stringify(options.library);
    const activitySerialized = JSON.stringify(options.activity);
    const libraryChanged = librarySerialized !== syncedLibraryRef.current;
    const activityChanged = activitySerialized !== syncedActivityRef.current;

    if (!libraryChanged && !activityChanged) return;

    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);

    pushTimerRef.current = setTimeout(() => {
      void (async () => {
        const now = Date.now();

        try {
          await pushRemoteState({
            ...(libraryChanged
              ? { library: optionsRef.current.library, libraryUpdatedAt: now }
              : {}),
            ...(activityChanged
              ? { activity: optionsRef.current.activity, activityUpdatedAt: now }
              : {}),
          });

          if (libraryChanged) {
            syncedLibraryRef.current = librarySerialized;
            await writeLocalSyncMeta({ libraryUpdatedAt: now });
          }
          if (activityChanged) {
            syncedActivityRef.current = activitySerialized;
            await writeLocalSyncMeta({ activityUpdatedAt: now });
          }

          await writeLocalSyncMeta({ lastSyncedAt: now });
        } catch (error) {
          report(
            error instanceof Error
              ? `Sync save failed: ${error.message}`
              : 'Sync save failed.',
          );
        }
      })();
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [options.library, options.activity, options.ready, report]);

  return { syncChoice };
}
