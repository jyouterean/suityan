/**
 * ハッシュタグ管理モジュール
 */

import { readFileSync } from 'fs';
import { join } from 'path';

let hashtagsCache: string[] | null = null;

function loadHashtags(): string[] {
  if (hashtagsCache !== null) {
    return hashtagsCache;
  }

  try {
    const path = join(process.cwd(), 'config', 'hashtags.txt');
    const content = readFileSync(path, 'utf-8');
    hashtagsCache = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return hashtagsCache;
  } catch {
    console.warn('Failed to load hashtags, using empty list');
    hashtagsCache = [];
    return hashtagsCache;
  }
}

// 必須ハッシュタグ
const REQUIRED_HASHTAG = '#軽貨物';

/**
 * ランダムにハッシュタグを選択（必須タグ + 0-1個）
 */
export function getRandomHashtags(count: number = 2): string[] {
  const hashtags = loadHashtags();

  // 必須タグは常に含める
  const result: string[] = [REQUIRED_HASHTAG];

  // 必須タグ以外からランダムに0〜1個追加
  const others = hashtags.filter(tag => tag !== '軽貨物');

  if (others.length > 0 && Math.random() < 0.5) {
    const shuffled = [...others].sort(() => Math.random() - 0.5);
    result.push(`#${shuffled[0]}`);
  }

  return result;
}

/**
 * ツイートにハッシュタグを追加
 * 140字を超えないように調整
 */
export function appendHashtags(tweet: string, maxLength: number = 140): string {
  const hashtags = getRandomHashtags(2);

  if (hashtags.length === 0) {
    return tweet;
  }

  const hashtagStr = '\n' + hashtags.join(' ');
  const combined = tweet + hashtagStr;

  // 140字を超える場合はハッシュタグを減らす
  if ([...combined].length <= maxLength) {
    return combined;
  }

  // 1個だけ試す
  const singleTag = '\n' + hashtags[0];
  const withSingle = tweet + singleTag;

  if ([...withSingle].length <= maxLength) {
    return withSingle;
  }

  // それでも超える場合はハッシュタグなし
  return tweet;
}
