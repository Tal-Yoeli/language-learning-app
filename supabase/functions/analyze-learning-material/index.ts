import { consumeAiQuota, describeError } from '../_shared/auth.ts';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import {
  createOpenAIResponse,
  getTextModel,
  parseJsonOutput,
} from '../_shared/openai.ts';

type RequestBody = {
  mode: 'full_text' | 'pairs';
  nativeLanguage: string;
  learningLanguage: string;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  maxCards?: number;
};

type GeneratedCardsResponse = {
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
    const hasText = Boolean(body.text?.trim());
    const hasImage = Boolean(body.imageBase64 && body.imageMimeType);

    if (!hasText && !hasImage) {
      return jsonResponse({ error: 'Text or image is required.' }, 400, request);
    }

    const maxCards = Math.max(1, Math.min(body.maxCards ?? 12, 25));
    const userInstruction =
      body.mode === 'pairs'
        ? 'The material is expected to contain word-translation pairs such as "word - translation". Extract every clear pair.'
        : 'The material is free text. Choose the most useful vocabulary items for a learner. If the text describes a deck goal or topic, generate practical vocabulary for that goal.';

    const content: Array<Record<string, unknown>> = [
      {
        type: 'input_text',
        text:
          `${userInstruction}\n` +
          `Native language: ${body.nativeLanguage}.\n` +
          `Learning language: ${body.learningLanguage}.\n` +
          `Return up to ${maxCards} cards.\n` +
          `Each example sentence should be in the learning language.\n` +
          `Translate both the term and the full example sentence into the native language.\n\n` +
          `Text:\n${body.text ?? ''}`,
      },
    ];

    if (hasImage) {
      content.push({
        type: 'input_image',
        image_url: `data:${body.imageMimeType};base64,${body.imageBase64}`,
      });
    }

    const response = await createOpenAIResponse({
      model: getTextModel(),
      input: [
        {
          role: 'system',
          content:
            'You create concise flashcards for language learners. Return only valid JSON that matches the requested schema.',
        },
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'generated_flashcards',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
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
            required: ['cards'],
          },
        },
      },
    });

    const parsed = parseJsonOutput<GeneratedCardsResponse>(response);

    return jsonResponse(
      { cards: parsed.cards.slice(0, maxCards) },
      200,
      request,
    );
  } catch (error) {
    const { message, status } = describeError(error);
    return jsonResponse({ error: message }, status, request);
  }
});
