import { consumeAiQuota, describeError } from '../_shared/auth.ts';
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

  try {
    await consumeAiQuota(request);

    const body = (await request.json()) as RequestBody;
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
    });

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
    const { message, status } = describeError(error);
    return jsonResponse({ error: message }, status, request);
  }
});
