/**
 * フォールバックモジュール
 * OpenAI障害時のローカル定型文プール
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { PostRecord } from './state.js';
import { checkSimilarity } from './validate.js';

let fallbackTweets: string[] | null = null;

function loadFallbackTweets(): string[] {
  if (fallbackTweets !== null) {
    return fallbackTweets;
  }

  try {
    const path = join(process.cwd(), 'config', 'fallback_tweets.txt');
    const content = readFileSync(path, 'utf-8');
    fallbackTweets = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return fallbackTweets;
  } catch {
    console.warn('Failed to load fallback tweets, using empty list');
    fallbackTweets = [];
    return fallbackTweets;
  }
}

/**
 * ランダムにフォールバックツイートを選択
 * 直近投稿との類似度が高いものは除外
 */
export function getRandomFallbackTweet(
  recentPosts: PostRecord[],
  maxAttempts: number = 10
): string | null {
  const tweets = loadFallbackTweets();

  if (tweets.length === 0) {
    return null;
  }

  // シャッフル
  const shuffled = [...tweets].sort(() => Math.random() - 0.5);

  for (let i = 0; i < Math.min(maxAttempts, shuffled.length); i++) {
    const candidate = shuffled[i];
    const similarity = checkSimilarity(candidate, recentPosts, 0.5);

    if (similarity.valid) {
      return candidate;
    }
  }

  // 類似度チェックをパスできなかった場合でも、最初の候補を返す
  console.warn('Could not find non-similar fallback tweet, using first available');
  return shuffled[0];
}

/**
 * スロットに適したフォールバックツイートを選択
 */
export function getFallbackTweetForSlot(
  slot: string,
  recentPosts: PostRecord[]
): string | null {
  const tweets = loadFallbackTweets();

  if (tweets.length === 0) {
    return null;
  }

  // スロットに応じたキーワードでフィルタリング
  const slotKeywords: Record<string, string[]> = {
    delivery: ['配達', '荷物', '不在票', '件数'],
    commute: ['帰', '終わり', '返却'],
    night_ero: ['夜', '寂しい', '癒'],
    goodnight: ['おやすみ', '寝', '明日'],
  };

  const keywords = slotKeywords[slot] || [];
  let candidates = tweets;

  if (keywords.length > 0) {
    const filtered = tweets.filter(tweet =>
      keywords.some(kw => tweet.includes(kw))
    );
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  // シャッフルして類似度チェック
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);

  for (const candidate of shuffled) {
    const similarity = checkSimilarity(candidate, recentPosts, 0.5);
    if (similarity.valid) {
      return candidate;
    }
  }

  return shuffled[0] || null;
}
