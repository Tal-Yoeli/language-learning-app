import { consumeAiQuota, describeError } from '../_shared/auth.ts';
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

  try {
    await consumeAiQuota(request);

    const body = (await request.json()) as RequestBody;
    const expectedSentence = body.expectedSentence?.trim();

    if (!expectedSentence) {
      return jsonResponse(
        { error: 'expectedSentence is required.' },
        400,
        request,
      );
    }

    let transcript = body.transcript?.trim() ?? '';

    if (!transcript && body.audioBase64 && body.audioMimeType) {
      transcript = await transcribeAudio({
        audioBase64: body.audioBase64,
        audioMimeType: body.audioMimeType,
        fileName: body.fileName,
        prompt: expectedSentence,
      });
    }

    if (!transcript) {
      return jsonResponse(
        { error: 'transcript or audioBase64 is required.' },
        400,
        request,
      );
    }

    const response = await createOpenAIResponse({
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
    });

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
    const { message, status } = describeError(error);
    return jsonResponse({ error: message }, status, request);
  }
});
