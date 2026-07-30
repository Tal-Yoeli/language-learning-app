import { ensureSession, getAuthBootstrapError, supabase } from './supabase';

const DEFAULT_FUNCTION_TIMEOUT_MS = 60_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `${operation} timed out. Check your connection and try again.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function getFunctionErrorMessage(error: unknown) {
  const fallback =
    error instanceof Error ? error.message : 'The server request failed.';
  const context =
    error && typeof error === 'object' && 'context' in error
      ? (error as { context?: unknown }).context
      : null;

  if (
    !context ||
    typeof context !== 'object' ||
    !('json' in context) ||
    typeof (context as { json?: unknown }).json !== 'function'
  ) {
    return fallback;
  }

  const status = (context as { status?: unknown }).status;
  // A 401 almost always means anonymous sign-in never succeeded, so say what to
  // fix rather than surfacing a bare "sign-in required".
  const authHint =
    status === 401
      ? ` Anonymous sign-in did not complete${
          getAuthBootstrapError() ? `: ${getAuthBootstrapError()}` : ''
        }. Enable Anonymous sign-ins in the Supabase dashboard under Authentication → Providers.`
      : '';

  try {
    const body = (await (context as { json: () => Promise<unknown> }).json()) as
      | { error?: unknown; message?: unknown }
      | null;

    if (typeof body?.error === 'string' && body.error.trim()) {
      return `${body.error}${authHint}`;
    }
    if (typeof body?.message === 'string' && body.message.trim()) {
      return `${body.message}${authHint}`;
    }
  } catch {
    // Some network failures do not include a readable response body.
  }

  return `${fallback}${authHint}`;
}

async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  operation: string,
  timeoutMs = DEFAULT_FUNCTION_TIMEOUT_MS,
) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  // Attach a per-device anonymous session so the Edge Function can apply its
  // daily quota. A failure here is not fatal: the request still goes out and
  // the server decides, which keeps this client working against Edge Functions
  // deployed before the quota guard existed.
  await ensureSession();

  const { data, error } = await withTimeout(
    supabase.functions.invoke<T>(name, { body }),
    timeoutMs,
    operation,
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  return data;
}

export type GeneratedFlashcard = {
  term: string;
  translation: string;
  example: string;
  exampleTranslation: string;
  notes: string;
};

export type PronunciationFeedback = {
  transcript: string;
  score: number;
  missing_words: string[];
  corrections: string[];
  pronunciation_tips: string[];
  encouragement: string;
};

export type GeneratedSpeech = {
  audioBase64: string;
  mimeType: string;
  voice: string;
  model: string;
};

export type TranslationEvaluation = {
  correct: boolean;
  feedback: string;
};

export async function analyzeLearningMaterial(body: {
  mode: 'full_text' | 'pairs';
  nativeLanguage: string;
  learningLanguage: string;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  maxCards?: number;
}) {
  const data = await invokeFunction<{
    cards: GeneratedFlashcard[];
  }>('analyze-learning-material', body, 'Learning material analysis');

  return Array.isArray(data?.cards) ? data.cards : [];
}

export async function generateThemedDeck(body: {
  goal: string;
  nativeLanguage: string;
  learningLanguage: string;
  minCards?: number;
  maxCards?: number;
}) {
  const data = await invokeFunction<{
    deckName: string;
    cards: GeneratedFlashcard[];
  }>('generate-themed-deck', body, 'Deck generation');

  return {
    deckName: data?.deckName ?? body.goal,
    cards: Array.isArray(data?.cards) ? data.cards : [],
  };
}

export async function evaluateTranslationAnswer(body: {
  prompt: string;
  response: string;
  referenceAnswer: string;
  promptLanguage: string;
  answerLanguage: string;
}) {
  const data = await invokeFunction<TranslationEvaluation>(
    'evaluate-translation',
    body,
    'Translation evaluation',
    20_000,
  );

  if (typeof data?.correct !== 'boolean') {
    throw new Error('No translation evaluation returned.');
  }

  return {
    correct: data.correct,
    feedback: data.feedback ?? '',
  };
}

export async function getPronunciationFeedback(body: {
  expectedSentence: string;
  learningLanguage: string;
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
  fileName?: string;
}) {
  const data = await invokeFunction<PronunciationFeedback>(
    'pronunciation-feedback',
    body,
    'Speaking feedback',
  );

  if (!data) {
    throw new Error('No pronunciation feedback returned.');
  }

  return data;
}

export async function synthesizeSpeech(body: {
  text: string;
  language: string;
  /**
   * Browsers cannot all decode raw AAC, so the web build asks for MP3. An Edge
   * Function deployed before this parameter existed ignores it and returns AAC,
   * which still plays everywhere except Firefox.
   */
  format?: 'aac' | 'mp3';
}) {
  const data = await invokeFunction<GeneratedSpeech>(
    'synthesize-speech',
    body,
    'Voice generation',
    45_000,
  );

  if (!data?.audioBase64) {
    throw new Error('No speech audio returned.');
  }

  return data;
}
