import {
  consumeAiQuota,
  describeError,
  recordAiSpend,
  releaseAiReservation,
  type QuotaResult,
} from '../_shared/auth.ts';
import {
  estimateResponseCost,
  estimateTranscriptionCost,
} from '../_shared/pricing.ts';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import {
  createOpenAIResponse,
  getTextModel,
  parseJsonOutput,
  transcribeAudio,
} from '../_shared/openai.ts';

type RequestBody = {
  expectedSentence: string;
  learningLanguage: string;
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
  fileName?: string;
};

type FeedbackResponse = {
  transcript: string;
  score: number;
  missing_words: string[];
  corrections: string[];
  pronunciation_tips: string[];
  encouragement: string;
};

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
    const expectedSentence = body.expectedSentence?.trim();

    if (!expectedSentence) {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse(
        { error: 'expectedSentence is required.' },
        400,
        request,
      );
    }

    let transcript = body.transcript?.trim() ?? '';
    // This endpoint makes two paid calls. Their costs are summed and reported
    // in a SINGLE recordAiSpend at the end: each call reconciles against the
    // one reservation consume_ai_quota took, so reporting twice would refund
    // that reservation twice and drive the month's total downwards.
    let costMicroUsd = 0;

    if (!transcript && body.audioBase64 && body.audioMimeType) {
      transcript = await transcribeAudio({
        audioBase64: body.audioBase64,
        audioMimeType: body.audioMimeType,
        fileName: body.fileName,
        prompt: expectedSentence,
        onDispatch: markDispatched,
      });
      // Counted only once the transcription actually succeeded, so a failed
      // call is never billed against the learner's budget.
      costMicroUsd += estimateTranscriptionCost(body.audioBase64.length);
    }

    if (!transcript) {
      // A silent clip still ran a real, paid transcription. Releasing the
      // reservation here would refund it, so repeated silent recordings could
      // run unlimited paid calls while driving recorded spend to zero.
      if (costMicroUsd > 0) {
        await recordAiSpend(quota, costMicroUsd);
      } else {
        await releaseAiReservation(quota);
      }
      settled = true;

      return jsonResponse(
        { error: 'No speech was detected in that recording.' },
        400,
        request,
      );
    }

    // If this second call fails, the transcription above has already been paid
    // for. Letting the error escape unrecorded would leave only the
    // reservation standing against a larger real cost -- under-counting, which
    // is the wrong direction for a spend guard to be wrong in.
    let response;
    try {
      response = await createOpenAIResponse({
      model: getTextModel(),
      input: [
        {
          role: 'system',
          content:
            'You are a kind pronunciation coach. Compare what the learner said with the expected sentence and return concise JSON feedback.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `Learning language: ${body.learningLanguage}.\n` +
                `Expected sentence: ${expectedSentence}\n` +
                `Learner transcript: ${transcript}\n` +
                'Score from 0 to 100. Keep feedback practical and short.',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'pronunciation_feedback',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              transcript: { type: 'string' },
              score: { type: 'number' },
              missing_words: {
                type: 'array',
                items: { type: 'string' },
              },
              corrections: {
                type: 'array',
                items: { type: 'string' },
              },
              pronunciation_tips: {
                type: 'array',
                items: { type: 'string' },
              },
              encouragement: { type: 'string' },
            },
            required: [
              'transcript',
              'score',
              'missing_words',
              'corrections',
              'pronunciation_tips',
              'encouragement',
            ],
          },
        },
      },
    }, markDispatched);
    } catch (error) {
      // Deliberately records nothing. record_ai_spend subtracts the
      // reservation from whatever it is given, so reporting just the
      // transcription cost here would net out as a REFUND for a request that
      // made two paid calls. Leaving the reservation standing is the
      // conservative outcome, and markDispatched has already committed it.
      throw error;
    }

    costMicroUsd += estimateResponseCost(response);
    await recordAiSpend(quota, costMicroUsd);
    settled = true;

    const parsed = parseJsonOutput<FeedbackResponse>(response);

    return jsonResponse(
      {
        ...parsed,
        transcript: parsed.transcript || transcript,
        score: Math.max(0, Math.min(100, Math.round(parsed.score))),
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
