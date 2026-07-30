import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeRecordingMimeType,
  extensionForSpeechMimeType,
} from '../src/platform/audioMime.ts';
import { createSpeechCacheKey } from '../src/platform/speechCacheKey.ts';

test('maps browser recording formats to extensions OpenAI accepts', () => {
  // Chrome and Firefox MediaRecorder output.
  const webm = describeRecordingMimeType('audio/webm;codecs=opus', 'audio/webm');
  assert.equal(webm.mimeType, 'audio/webm');
  assert.equal(webm.fileName, 'pronunciation.webm');
  assert.equal(webm.supported, true);

  // Safari MediaRecorder output.
  const safari = describeRecordingMimeType('audio/mp4', 'audio/webm');
  assert.equal(safari.fileName, 'pronunciation.mp4');
  assert.equal(safari.supported, true);

  // iOS expo-audio output, unchanged from the mobile-only build.
  const ios = describeRecordingMimeType('audio/mp4');
  assert.equal(ios.mimeType, 'audio/mp4');
  assert.equal(ios.fileName, 'pronunciation.mp4');
});

test('falls back to the platform default when the browser reports no type', () => {
  const empty = describeRecordingMimeType('', 'audio/webm');
  assert.equal(empty.mimeType, 'audio/webm');
  assert.equal(empty.extension, 'webm');

  const missing = describeRecordingMimeType(undefined, 'audio/mp4');
  assert.equal(missing.mimeType, 'audio/mp4');
  assert.equal(missing.extension, 'mp4');
});

test('flags container formats OpenAI transcription cannot read', () => {
  const unsupported = describeRecordingMimeType('audio/amr', 'audio/webm');
  // Unknown types fall back rather than being sent with a misleading name.
  assert.equal(unsupported.mimeType, 'audio/webm');
  assert.equal(unsupported.supported, true);
});

test('speech cache keys are deterministic and separate by language', () => {
  const first = createSpeechCacheKey('Greek', 'καλημέρα');
  const second = createSpeechCacheKey('Greek', 'καλημέρα');
  const otherLanguage = createSpeechCacheKey('Levantine Arabic', 'καλημέρα');
  const otherText = createSpeechCacheKey('Greek', 'γεια σου');

  // A stable key is what stops a replay becoming a second paid TTS request.
  assert.equal(first, second);
  assert.notEqual(first, otherLanguage);
  assert.notEqual(first, otherText);
});

test('speech mime types map to playable extensions', () => {
  assert.equal(extensionForSpeechMimeType('audio/mpeg'), 'mp3');
  assert.equal(extensionForSpeechMimeType('audio/aac'), 'aac');
  assert.equal(extensionForSpeechMimeType('application/octet-stream'), 'mp3');
});
