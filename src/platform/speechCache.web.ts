import { base64ToBlob } from './base64';
import type { Conforms } from './conformance';
import { createSpeechCacheKey } from './speechCacheKey';
import type { CachedSpeech, SpeechFormat, SpeechRequest } from './speechCache';

export type { CachedSpeech, SpeechFormat, SpeechRequest };

// Firefox cannot decode raw ADTS AAC, so the browser build asks the Edge
// Function for MP3. Every engine can play MP3. iOS keeps requesting AAC so its
// existing cached files stay valid.
export const preferredSpeechFormat: SpeechFormat = 'mp3';

// Object URLs for this session. Cache Storage survives reloads; this Map avoids
// re-reading and re-blobbing audio that was already played in this session.
const sessionUris = new Map<string, string>();

const CACHE_NAME = 'language-learning/speech/v1';
// Cache Storage keys must be same-origin-resolvable URLs; this path is never
// fetched from the network, it is only ever used as a lookup key.
const cacheUrlFor = (key: string) => `/__speech-cache__/${key}`;

// Cache Storage requires a secure context and is absent in some private modes.
export const isSpeechCacheAvailable = true;

export const speechCacheUnavailableMessage =
  'Audio playback is unavailable in this browser.';

async function openCache() {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    // Private browsing and some enterprise policies block Cache Storage. The
    // in-memory map still prevents repeat charges within the session.
    return null;
  }
}

export async function getOrCreateSpeechUri({
  language,
  text,
  synthesize,
}: SpeechRequest): Promise<CachedSpeech> {
  const cacheKey = createSpeechCacheKey(language, text);
  const sessionHit = sessionUris.get(cacheKey);

  if (sessionHit) {
    return { uri: sessionHit, generatedVoice: '' };
  }

  const cache = await openCache();

  if (cache) {
    const stored = await cache.match(cacheUrlFor(cacheKey));

    if (stored) {
      const uri = URL.createObjectURL(await stored.blob());
      sessionUris.set(cacheKey, uri);
      return { uri, generatedVoice: '' };
    }
  }

  const speech = await synthesize(preferredSpeechFormat);
  const blob = base64ToBlob(speech.audioBase64, speech.mimeType);

  if (cache) {
    try {
      await cache.put(
        cacheUrlFor(cacheKey),
        new Response(blob, { headers: { 'Content-Type': speech.mimeType } }),
      );
    } catch {
      // A full storage quota must not break playback.
    }
  }

  const uri = URL.createObjectURL(blob);
  sessionUris.set(cacheKey, uri);

  return { uri, generatedVoice: speech.voice };
}

export async function clearSpeechCache() {
  for (const uri of sessionUris.values()) {
    URL.revokeObjectURL(uri);
  }
  sessionUris.clear();

  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
  } catch {
    // Nothing to clean up.
  }
}

type _Conformance = Conforms<
  typeof import('./speechCache'),
  typeof import('./speechCache.web')
>;
