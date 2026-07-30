import {
  cacheDirectory,
  EncodingType,
  getInfoAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

import type { GeneratedSpeech } from '../lib/aiFunctions';
import { createSpeechCacheKey } from './speechCacheKey';

export type CachedSpeech = {
  /** A URI expo-audio can play. */
  uri: string;
  /** Empty when the audio was served from cache instead of newly generated. */
  generatedVoice: string;
};

export type SpeechRequest = {
  language: string;
  text: string;
  synthesize: (format: SpeechFormat) => Promise<GeneratedSpeech>;
};

export type SpeechFormat = 'aac' | 'mp3';

/** iOS decodes AAC natively; keep the existing on-device cache format. */
export const preferredSpeechFormat: SpeechFormat = 'aac';

export const isSpeechCacheAvailable = Boolean(cacheDirectory);

export const speechCacheUnavailableMessage: string =
  'The audio cache is unavailable on this device.';

export async function getOrCreateSpeechUri({
  language,
  text,
  synthesize,
}: SpeechRequest): Promise<CachedSpeech> {
  if (!cacheDirectory) {
    throw new Error(speechCacheUnavailableMessage);
  }

  const cacheKey = createSpeechCacheKey(language, text);
  const uri = `${cacheDirectory}openai-speech-${cacheKey}.aac`;
  const cachedFile = await getInfoAsync(uri);

  if (cachedFile.exists) {
    return { uri, generatedVoice: '' };
  }

  const speech = await synthesize(preferredSpeechFormat);
  await writeAsStringAsync(uri, speech.audioBase64, {
    encoding: EncodingType.Base64,
  });

  return { uri, generatedVoice: speech.voice };
}

export async function clearSpeechCache() {
  // The OS reclaims the cache directory on its own; nothing to do on native.
}
