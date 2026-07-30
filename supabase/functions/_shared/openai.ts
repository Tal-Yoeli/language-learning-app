const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_TRANSCRIPTIONS_URL =
  'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_REQUEST_TIMEOUT_MS = 60_000;

async function fetchOpenAI(
  url: string,
  init: RequestInit,
  operation: string,
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${operation} timed out. Please try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getOpenAIKey() {
  const key = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPEN_API_KEY');

  if (!key) {
    throw new Error('Missing OPENAI_API_KEY Supabase secret.');
  }

  return key;
}

export function getTextModel() {
  return Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5.4-mini';
}

export function getTranscriptionModel() {
  return Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') ?? 'gpt-4o-transcribe';
}

export function getSpeechModel() {
  return Deno.env.get('OPENAI_SPEECH_MODEL') ?? 'gpt-4o-mini-tts';
}

export function getSpeechVoice() {
  return Deno.env.get('OPENAI_SPEECH_VOICE') ?? 'marin';
}

export async function createOpenAIResponse(payload: Record<string, unknown>) {
  const response = await fetchOpenAI(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, 'OpenAI response');

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'OpenAI Responses request failed.');
  }

  return body;
}

export function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const textParts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== 'object') {
        continue;
      }

      const maybeText = (contentItem as { text?: unknown }).text;

      if (typeof maybeText === 'string') {
        textParts.push(maybeText);
      }
    }
  }

  return textParts.join('\n').trim();
}

export function parseJsonOutput<T>(response: Record<string, unknown>): T {
  const text = extractOutputText(response);

  if (!text) {
    throw new Error('OpenAI response did not include text output.');
  }

  return JSON.parse(text) as T;
}

export async function transcribeAudio({
  audioBase64,
  audioMimeType,
  fileName = 'recording.m4a',
  prompt,
}: {
  audioBase64: string;
  audioMimeType: string;
  fileName?: string;
  prompt?: string;
}) {
  const bytes = Uint8Array.from(atob(audioBase64), (char) =>
    char.charCodeAt(0),
  );
  const formData = new FormData();

  formData.append('model', getTranscriptionModel());
  formData.append('file', new File([bytes], fileName, { type: audioMimeType }));
  formData.append('response_format', 'json');

  if (prompt) {
    formData.append('prompt', prompt);
  }

  const response = await fetchOpenAI(OPENAI_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: formData,
  }, 'OpenAI transcription');

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'OpenAI transcription failed.');
  }

  if (typeof body.text !== 'string') {
    throw new Error('OpenAI transcription did not return text.');
  }

  return body.text;
}

// iOS plays AAC natively and already has AAC files cached on device. Browsers
// are only guaranteed to decode MP3, so the web client asks for MP3 instead.
const SPEECH_FORMATS = {
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
} as const;

export type SpeechFormat = keyof typeof SPEECH_FORMATS;

export function normalizeSpeechFormat(value: unknown): SpeechFormat {
  return value === 'mp3' ? 'mp3' : 'aac';
}

export async function createSpeech({
  text,
  language,
  format = 'aac',
}: {
  text: string;
  language: string;
  format?: SpeechFormat;
}) {
  const model = getSpeechModel();
  const voice = getSpeechVoice();
  const response = await fetchOpenAI(OPENAI_SPEECH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: format,
      instructions:
        `Speak naturally as a warm native ${language} language teacher. ` +
        'Use an authentic accent, clear everyday pacing, natural rhythm, and no exaggerated announcer style.',
    }),
  }, 'OpenAI speech', 45_000);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'OpenAI speech request failed.');
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: SPEECH_FORMATS[format],
    model,
    voice,
  };
}
