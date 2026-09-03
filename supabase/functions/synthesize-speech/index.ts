import {
  consumeAiQuota,
  describeError,
  recordAiSpend,
  releaseAiReservation,
  type QuotaResult,
} from '../_shared/auth.ts';
import { estimateSpeechCost } from '../_shared/pricing.ts';
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

  // Declared outside the try so the catch can see them. `settled` means "the
  // reservation is committed" -- set once an OpenAI call has been started or a
  // cost recorded, so the catch only refunds requests that never reached the
  // model at all.
  let quota: QuotaResult | null = null;
  let settled = false;
  // Fired by the OpenAI helper the instant a request is actually dispatched:
  // after the API key resolves (so a missing key still refunds) and before the
  // response arrives (so a timeout does not). A spend guard must err toward
  // over-counting rather than refunding a call OpenAI already billed.
  const markDispatched = () => {
    settled = true;
  };

  try {
    quota = await consumeAiQuota(request);

    // request.json() throws on a malformed body, and that would otherwise
    // escape to the catch block with the reservation still charged for a
    // request that never reached OpenAI.
    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse({ error: 'Invalid JSON body.' }, 400, request);
    }
    const text = body.text?.trim();
    const language = body.language?.trim();

    if (!text || !language) {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse(
        { error: 'text and language are required.' },
        400,
        request,
      );
    }

    if (text.length > 1200) {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse({ error: 'Speech text is too long.' }, 400, request);
    }

    const speech = await createSpeech({
      text,
      language,
      format: normalizeSpeechFormat(body.format),
      onDispatch: markDispatched,
    });

    await recordAiSpend(quota, estimateSpeechCost(text));
    settled = true;

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
    // Nothing was billed, so give the reservation back. Without this a broken
    // OPENAI_API_KEY -- which throws before any network call -- would let a
    // handful of retries burn a user's whole month for zero AI work.
    if (quota && !settled) {
      await releaseAiReservation(quota);
    }

    const { message, status } = describeError(error);
    return jsonResponse({ error: message }, status, request);
  }
});
