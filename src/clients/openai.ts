/**
 * OpenAIクライアント
 * Responses APIでjson_schema出力（Structured Outputs）
 */

import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Structured Outputsのスキーマ
const TWEET_SCHEMA = {
  type: 'object',
  properties: {
    tweet: {
      type: 'string',
      description: 'ツイート本文（140字以内）',
    },
    mood: {
      type: 'string',
      enum: ['happy', 'neutral', 'tired', 'lonely', 'excited', 'angry', 'frustrated', 'proud', 'melancholy', 'playful', 'relieved', 'anxious'],
      description: '投稿後の気分',
    },
  },
  required: ['tweet', 'mood'],
  additionalProperties: false,
} as const;

export interface GeneratedTweet {
  tweet: string;
  mood: 'happy' | 'neutral' | 'tired' | 'lonely' | 'excited' | 'angry' | 'frustrated' | 'proud' | 'melancholy' | 'playful' | 'relieved' | 'anxious';
}

export interface GenerateOptions {
  maxRetries?: number;
  maxOutputTokens?: number;
}

/**
 * ツイートを生成
 */
export async function generateTweet(
  prompt: string,
  options: GenerateOptions = {}
): Promise<GeneratedTweet> {
  const { maxRetries = 2, maxOutputTokens = 150 } = options;
  const openai = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `あなたはキャラクターそのものとしてツイートを書く。アシスタントではない。
本人が実際にスマホでつぶやいているように書くこと。
- 整った文章にしない。途中で切れたり、誤字っぽくても良い
- 「〜しました」のような報告調は絶対に使わない
- テンプレ感を出さない。毎回少し違う書き出し・構造にする
- 感情は素直に出す。嬉しい時は「！」が増え、怒りは荒っぽく、悲しい時は「…」が増える
- moodは今のツイートを書いた時の本当の気持ちで選ぶ
指定された形式でJSONを出力。`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'tweet_response',
            strict: true,
            schema: TWEET_SCHEMA,
          },
        },
        max_tokens: maxOutputTokens,
        temperature: 0.9,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content) as GeneratedTweet;

      // 基本的な検証
      if (!parsed.tweet || typeof parsed.tweet !== 'string') {
        throw new Error('Invalid tweet format');
      }

      return parsed;
    } catch (error) {
      lastError = error as Error;
      console.warn(`OpenAI attempt ${attempt + 1} failed:`, lastError.message);

      if (attempt < maxRetries) {
        // リトライ前に少し待機
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(`OpenAI generation failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * OpenAIが利用可能かチェック
 */
export function isOpenAIAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
