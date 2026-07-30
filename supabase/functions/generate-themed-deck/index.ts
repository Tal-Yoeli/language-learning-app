import { consumeAiQuota, describeError } from '../_shared/auth.ts';
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

  try {
    await consumeAiQuota(request);

    const body = (await request.json()) as RequestBody;
    const goal = body.goal?.trim();
    const nativeLanguage = body.nativeLanguage?.trim();
    const learningLanguage = body.learningLanguage?.trim();

    if (!goal || !nativeLanguage || !learningLanguage) {
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
    });

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
    const { message, status } = describeError(error);
    return jsonResponse({ error: message }, status, request);
  }
});
