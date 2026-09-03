import {
  consumeAiQuota,
  describeError,
  recordAiSpend,
  releaseAiReservation,
  type QuotaResult,
} from '../_shared/auth.ts';
import { estimateResponseCost } from '../_shared/pricing.ts';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import {
  createOpenAIResponse,
  getTextModel,
  parseJsonOutput,
} from '../_shared/openai.ts';

type RequestBody = {
  prompt: string;
  response: string;
  referenceAnswer: string;
  promptLanguage: string;
  answerLanguage: string;
};

type EvaluationResponse = {
  correct: boolean;
  feedback: string;
};

function clean(value: unknown, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
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
    const prompt = clean(body.prompt);
    const response = clean(body.response);
    const referenceAnswer = clean(body.referenceAnswer);
    const promptLanguage = clean(body.promptLanguage, 80);
    const answerLanguage = clean(body.answerLanguage, 80);

    if (
      !prompt ||
      !response ||
      !referenceAnswer ||
      !promptLanguage ||
      !answerLanguage
    ) {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse(
        {
          error:
            'prompt, response, referenceAnswer, promptLanguage, and answerLanguage are required.',
        },
        400,
        request,
      );
    }

    const evaluation = await createOpenAIResponse({
      model: getTextModel(),
      input: [
        {
          role: 'system',
          content:
            'You grade short language-learning translations. Decide whether the learner response preserves the meaning of the prompt. Accept natural synonyms, common everyday variants, dialectal Levantine Arabic, optional articles or pronouns, and harmless spelling mistakes. Reject changed negation, meaning, person, number, or tense when the change matters. The reference is an example, not the only valid wording. Return concise English feedback and only JSON matching the schema.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                promptLanguage,
                answerLanguage,
                prompt,
                learnerResponse: response,
                referenceAnswer,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'translation_evaluation',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              correct: { type: 'boolean' },
              feedback: { type: 'string' },
            },
            required: ['correct', 'feedback'],
          },
        },
      },
    }, markDispatched);

    await recordAiSpend(quota, estimateResponseCost(evaluation));
    settled = true;

    const parsed = parseJsonOutput<EvaluationResponse>(evaluation);

    return jsonResponse(
      {
        correct: Boolean(parsed.correct),
        feedback: clean(parsed.feedback, 180),
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
