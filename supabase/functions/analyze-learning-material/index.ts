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
  mode: 'full_text' | 'pairs';
  nativeLanguage: string;
  learningLanguage: string;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  pdfBase64?: string;
  pdfFileName?: string;
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
    const hasText = Boolean(body.text?.trim());
    const hasImage = Boolean(body.imageBase64 && body.imageMimeType);
    const hasPdf = Boolean(body.pdfBase64);

    if (!hasText && !hasImage && !hasPdf) {
      await releaseAiReservation(quota);
      settled = true;
      return jsonResponse(
        { error: 'Text, an image, or a PDF is required.' },
        400,
        request,
      );
    }

    const maxCards = Math.max(1, Math.min(body.maxCards ?? 12, 25));
    const userInstruction =
      body.mode === 'pairs'
        ? 'The material is expected to contain word-translation pairs such as "word - translation". Extract every clear pair.'
        : 'The material is free text. Choose the most useful vocabulary items for a learner. If the text describes a deck goal or topic, generate practical vocabulary for that goal.';
    const sourceNote = hasPdf
      ? '\nThe attached PDF is the main source. Read the whole document, including text rendered inside page images, and ignore page furniture such as headers, footers, and page numbers.'
      : '';

    const content: Array<Record<string, unknown>> = [
      {
        type: 'input_text',
        text:
          `${userInstruction}${sourceNote}\n` +
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

    if (hasPdf) {
      // The Responses API expects a data URL rather than bare base64, and a
      // filename it can use to pick a parser.
      content.push({
        type: 'input_file',
        filename: body.pdfFileName?.trim() || 'document.pdf',
        file_data: `data:application/pdf;base64,${body.pdfBase64}`,
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
    }, markDispatched);

    await recordAiSpend(quota, estimateResponseCost(response));
    settled = true;

    const parsed = parseJsonOutput<GeneratedCardsResponse>(response);

    return jsonResponse(
      { cards: parsed.cards.slice(0, maxCards) },
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
