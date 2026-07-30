import { describeRecordingMimeType } from './audioMime';
import { blobToBase64 } from './base64';
import type { Conforms } from './conformance';
import type { RecordingPayload } from './recording';

export type { RecordingPayload };

/**
 * On the web expo-audio hands back a blob: URL rather than a file path, and the
 * container depends on the browser (webm on Chrome/Firefox, mp4 on Safari).
 * Fetching the blob URL is the supported way to read it back.
 */
export async function readRecording(uri: string): Promise<RecordingPayload> {
  const response = await fetch(uri);

  if (!response.ok) {
    throw new Error('The recording could not be read back from the browser.');
  }

  const blob = await response.blob();
  const { mimeType, fileName, supported } = describeRecordingMimeType(
    blob.type,
    'audio/webm',
  );

  if (!supported) {
    throw new Error(
      `This browser recorded an unsupported audio format (${blob.type || 'unknown'}). Try Chrome, Edge, or Safari.`,
    );
  }

  return { base64: await blobToBase64(blob), mimeType, fileName };
}

export const microphoneUnavailableMessage =
  'Microphone access is blocked. Allow it in your browser’s site settings (the icon in the address bar) to practice speaking.';

export const microphoneRequiredMessage =
  'Microphone permission is required. Your browser will ask when you start recording.';

type _Conformance = Conforms<
  typeof import('./recording'),
  typeof import('./recording.web')
>;
