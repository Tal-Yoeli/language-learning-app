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
  goal: string;
  nativeLanguage: string;
  learningLanguage: string;
  minCards?: number;
  maxCards?: number;
};

type GeneratedDeckResponse = {
  deckName: string;
  cards: Array<{
    term: string;
    translation: string;
    example: string;
    exampleTranslation: string;
    notes: string;
  }>;
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
    const goal = body.goal?.trim();
    const nativeLanguage = body.nativeLanguage?.trim();
    const learningLanguage = body.learningLanguage?.trim();

    if (!goal || !nativeLanguage || !learningLanguage) {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse(
        { error: 'goal, nativeLanguage, and learningLanguage are required.' },
        400,
        request,
      );
    }

    const minCards = Math.max(10, Math.min(body.minCards ?? 10, 20));
    const maxCards = Math.max(minCards, Math.min(body.maxCards ?? 12, 25));

    const response = await createOpenAIResponse({
      model: getTextModel(),
      input: [
        {
          role: 'system',
          content:
            'You create practical language-learning decks. Return only valid JSON that matches the requested schema.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `Create a new vocabulary deck for this goal: ${goal}\n` +
                `Learning language: ${learningLanguage}.\n` +
                `Translation language: ${nativeLanguage}.\n` +
                `Return ${maxCards} useful beginner-to-intermediate cards, never fewer than ${minCards}.\n` +
                'Use everyday words or short phrases that clearly belong to the goal.\n' +
                'For each card, include an example sentence in the learning language and translate that full sentence into the translation language.\n' +
                'Keep terms concise and avoid duplicates.',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'generated_themed_deck',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              deckName: { type: 'string' },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    term: { type: 'string' },
                    translation: { type: 'string' },
                    example: { type: 'string' },
                    exampleTranslation: { type: 'string' },
                    notes: { type: 'string' },
                  },
                  required: [
                    'term',
                    'translation',
                    'example',
                    'exampleTranslation',
                    'notes',
                  ],
                },
              },
            },
            required: ['deckName', 'cards'],
          },
        },
      },
    }, markDispatched);

    await recordAiSpend(quota, estimateResponseCost(response));
    settled = true;

    const parsed = parseJsonOutput<GeneratedDeckResponse>(response);
    const cards = parsed.cards
      .filter((card) => card.term.trim() && card.translation.trim())
      .slice(0, maxCards);

    if (cards.length < minCards) {
      return jsonResponse(
        {
          error: `Generated only ${cards.length} cards. Please try a broader deck goal.`,
        },
        502,
        request,
      );
    }

    return jsonResponse(
      { deckName: parsed.deckName.trim() || goal, cards },
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
