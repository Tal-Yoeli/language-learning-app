import { consumeAiQuota, describeError } from '../_shared/auth.ts';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { createSpeech, normalizeSpeechFormat } from '../_shared/openai.ts';

type RequestBody = {
  text: string;
  language: string;
  format?: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse(request);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, request);
  }

  try {
    await consumeAiQuota(request);

    const body = (await request.json()) as RequestBody;
    const text = body.text?.trim();
    const language = body.language?.trim();

    if (!text || !language) {
      return jsonResponse(
        { error: 'text and language are required.' },
        400,
        request,
      );
    }

    if (text.length > 1200) {
      return jsonResponse({ error: 'Speech text is too long.' }, 400, request);
    }

    const speech = await createSpeech({
      text,
      language,
      format: normalizeSpeechFormat(body.format),
    });

    return jsonResponse(
      {
        audioBase64: bytesToBase64(speech.bytes),
        mimeType: speech.mimeType,
        model: speech.model,
        voice: speech.voice,
      },
      200,
      request,
    );
  } catch (error) {
    const { message, status } = describeError(error);
    return jsonResponse({ error: message }, status, request);
  }
});
