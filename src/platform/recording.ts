import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

import { describeRecordingMimeType } from './audioMime';

export type RecordingPayload = {
  base64: string;
  mimeType: string;
  fileName: string;
};

/**
 * expo-audio writes an .m4a file on iOS. The recorder URI is a local file path,
 * so it is read straight off disk.
 */
export async function readRecording(uri: string): Promise<RecordingPayload> {
  const base64 = await readAsStringAsync(uri, {
    encoding: EncodingType.Base64,
  });
  const { mimeType, fileName } = describeRecordingMimeType('audio/mp4');

  return { base64, mimeType, fileName };
}

export const microphoneUnavailableMessage: string =
  'Microphone access is disabled. Enable it in iPhone Settings to practice speaking.';

export const microphoneRequiredMessage: string =
  'Microphone permission is required.';
