/**
 * バリデーションモジュール
 * 140字/絵文字/禁止語/軽貨物要素/類似度チェック
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { PostRecord } from './state.js';

// 設定ファイルを読み込み
function loadLines(filename: string): string[] {
  try {
    const path = join(process.cwd(), 'config', filename);
    const content = readFileSync(path, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const LOGISTICS_WORDS = loadLines('logistics_words.txt');
const FORBIDDEN_WORDS = loadLines('forbidden.txt');

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 文字数チェック（140字以内）
 */
export function checkLength(text: string): boolean {
  return [...text].length <= 140;
}

/**
 * 絵文字カウント
 */
export function countEmoji(text: string): number {
  const emojiRegex = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

/**
 * 絵文字チェック（2個以内）
 */
export function checkEmoji(text: string): boolean {
  return countEmoji(text) <= 2;
}

/**
 * 禁止語チェック
 */
export function checkForbiddenWords(text: string): { valid: boolean; found: string[] } {
  const lowerText = text.toLowerCase();
  const found = FORBIDDEN_WORDS.filter(word =>
    lowerText.includes(word.toLowerCase())
  );
  return { valid: found.length === 0, found };
}

/**
 * 軽貨物語彙チェック（1つ以上含む）
 */
export function checkLogisticsWord(text: string): { valid: boolean; found: string[] } {
  const found = LOGISTICS_WORDS.filter(word => text.includes(word));
  return { valid: found.length > 0, found };
}

/**
 * 文字bigramを生成
 */
function getBigrams(text: string): Set<string> {
  const chars = [...text.replace(/\s/g, '')];
  const bigrams = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.add(chars[i] + chars[i + 1]);
  }
  return bigrams;
}

/**
 * Jaccard類似度を計算
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * 類似度チェック（直近投稿との類似度が0.6以下）
 */
export function checkSimilarity(
  text: string,
  recentPosts: PostRecord[],
  threshold: number = 0.6
): { valid: boolean; maxSimilarity: number; mostSimilar: string | null } {
  if (recentPosts.length === 0) {
    return { valid: true, maxSimilarity: 0, mostSimilar: null };
  }

  const newBigrams = getBigrams(text);
  let maxSimilarity = 0;
  let mostSimilar: string | null = null;

  for (const post of recentPosts) {
    const oldBigrams = getBigrams(post.text);
    const similarity = jaccardSimilarity(newBigrams, oldBigrams);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      mostSimilar = post.text;
    }
  }

  return {
    valid: maxSimilarity <= threshold,
    maxSimilarity,
    mostSimilar,
  };
}

/**
 * 総合バリデーション
 */
export function validateTweet(
  text: string,
  recentPosts: PostRecord[] = []
): ValidationResult {
  const errors: string[] = [];

  // 文字数チェック
  if (!checkLength(text)) {
    const len = [...text].length;
    errors.push(`文字数超過: ${len}字 (最大140字)`);
  }

  // 絵文字チェック
  if (!checkEmoji(text)) {
    const count = countEmoji(text);
    errors.push(`絵文字超過: ${count}個 (最大2個)`);
  }

  // 禁止語チェック
  const forbidden = checkForbiddenWords(text);
  if (!forbidden.valid) {
    errors.push(`禁止語検出: ${forbidden.found.join(', ')}`);
  }

  // 軽貨物語彙チェック
  const logistics = checkLogisticsWord(text);
  if (!logistics.valid) {
    errors.push('軽貨物関連の単語が含まれていません');
  }

  // 類似度チェック
  const similarity = checkSimilarity(text, recentPosts);
  if (!similarity.valid) {
    errors.push(
      `類似度が高すぎます: ${(similarity.maxSimilarity * 100).toFixed(1)}%`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
