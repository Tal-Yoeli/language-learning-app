// Deterministic cache key for generated speech, shared by the native file cache
// and the browser Cache Storage implementation. Replaying the same phrase must
// never trigger a second paid text-to-speech request on any platform.
export function createSpeechCacheKey(language: string, text: string) {
  const value = `${language}\n${text}`;
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
