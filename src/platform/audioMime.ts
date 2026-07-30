// iOS records .m4a through expo-audio. Browsers hand back whatever their
// MediaRecorder produces, which is audio/webm on Chrome and Firefox and
// audio/mp4 on Safari. OpenAI transcription selects its decoder from the file
// name, so the extension has to match the real container rather than the
// hardcoded .m4a the iPhone-only build used.
const EXTENSIONS: Array<[string, string]> = [
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'mp4'],
  ['audio/x-m4a', 'm4a'],
  ['audio/m4a', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/flac', 'flac'],
];

// Formats OpenAI's transcription endpoint accepts.
const SUPPORTED_EXTENSIONS = new Set([
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'oga',
  'ogg',
  'wav',
  'webm',
]);

export type RecordingDescriptor = {
  mimeType: string;
  extension: string;
  fileName: string;
  supported: boolean;
};

export function describeRecordingMimeType(
  rawMimeType: string | undefined | null,
  fallbackMimeType = 'audio/mp4',
): RecordingDescriptor {
  // MediaRecorder reports values such as `audio/webm;codecs=opus`.
  const base = (rawMimeType?.split(';')[0].trim().toLowerCase() ||
    fallbackMimeType) as string;
  const match = EXTENSIONS.find(([type]) => type === base);
  const mimeType = match ? base : fallbackMimeType;
  const extension =
    match?.[1] ??
    EXTENSIONS.find(([type]) => type === fallbackMimeType)?.[1] ??
    'mp4';

  return {
    mimeType,
    extension,
    fileName: `pronunciation.${extension}`,
    supported: SUPPORTED_EXTENSIONS.has(extension),
  };
}

// Browsers can only reliably decode MP3 across every engine, so the web build
// asks for MP3 while iOS keeps the AAC files it already has cached.
export function extensionForSpeechMimeType(mimeType: string) {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return EXTENSIONS.find(([type]) => type === base)?.[1] ?? 'mp3';
}
