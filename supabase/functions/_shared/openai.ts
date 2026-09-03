const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_TRANSCRIPTIONS_URL =
  'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Called at the instant a request is actually dispatched to OpenAI -- after the
 * API key has resolved, so a missing key never fires it, and before the
 * response arrives, so a timeout still does.
 *
 * The spend guard uses this to decide whether a failed request may have been
 * billed upstream. Signalling any earlier would let a broken key burn a user's
 * budget for zero work; any later would refund calls OpenAI really charged for.
 */
export type DispatchListener = () => void;

async function fetchOpenAI(
  url: string,
  init: RequestInit,
  operation: string,
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
  onDispatch?: DispatchListener,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    // A 4xx means OpenAI rejected the request outright -- a bad key, a
    // malformed payload, a rate limit -- and did not bill for it, so the
    // reservation must be given back. Anything else (success, or a 5xx that
    // may have completed server-side) is treated as billable.
    //
    // Committing unconditionally here would let an OpenAI rate-limit window
    // burn a user's whole month in a handful of retries with no AI response.
    if (response.status < 400 || response.status >= 500) {
      onDispatch?.();
    }

    return response;
  } catch (error) {
    // No response at all: the request may still have completed and been billed
    // upstream, so commit. Over-counting is the safe way for a spend guard to
    // be wrong.
    onDispatch?.();

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

export async function createOpenAIResponse(
  payload: Record<string, unknown>,
  onDispatch?: DispatchListener,
) {
  const response = await fetchOpenAI(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, 'OpenAI response', undefined, onDispatch);

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
  onDispatch,
}: {
  audioBase64: string;
  audioMimeType: string;
  fileName?: string;
  prompt?: string;
  onDispatch?: DispatchListener;
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
  }, 'OpenAI transcription', undefined, onDispatch);

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
  onDispatch,
}: {
  text: string;
  language: string;
  format?: SpeechFormat;
  onDispatch?: DispatchListener;
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
  }, 'OpenAI speech', 45_000, onDispatch);

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
