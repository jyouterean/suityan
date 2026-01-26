/**
 * エージェント実行エントリポイント
 * slot決定→image判定→生成→検証→投稿→state更新
 */

import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getJSTHour, getJSTTimestamp } from '../utils/jst.js';
import {
  loadState,
  saveState,
  updateStateAfterPost,
  shouldPostImage,
  incrementNgRetry,
  incrementFallbackUsed,
  type AgentState,
} from '../core/state.js';
import { buildPrompt, determineSlot } from '../core/prompt.js';
import { validateTweet } from '../core/validate.js';
import { getFallbackTweetForSlot } from '../core/fallback.js';
import { generateTweet, isOpenAIAvailable } from '../clients/openai.js';
import { createTweet, createTweetWithMedia, uploadMediaChunked, isXApiAvailable } from '../clients/x.js';

const MAX_GENERATION_RETRIES = 2;
const IMAGES_DIR = join(process.cwd(), 'assets', 'images');

/**
 * スロットに対応する画像ディレクトリを取得
 */
function getImageDirForSlot(slot: string): string {
  const slotDirMap: Record<string, string> = {
    delivery: 'delivery',
    commute: 'commute',
    night_ero: 'night',
    goodnight: 'daily',
  };
  const dir = slotDirMap[slot] || 'daily';
  return join(IMAGES_DIR, dir);
}

/**
 * ディレクトリからランダムに画像を選択
 */
function selectRandomImage(directory: string): string | null {
  if (!existsSync(directory)) {
    return null;
  }

  const files = readdirSync(directory).filter(f => {
    const ext = f.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');
  });

  if (files.length === 0) {
    return null;
  }

  const selected = files[Math.floor(Math.random() * files.length)];
  return join(directory, selected);
}

/**
 * メイン実行関数
 */
async function main(): Promise<void> {
  console.log(`[${getJSTTimestamp()}] Starting agent run...`);

  // 状態を読み込み
  let state = loadState();
  console.log(`Current state: mood=${state.mood}, energy=${state.energy}, today_posts=${state.today_post_count}`);

  // 1日7回制限チェック
  if (state.today_post_count >= 7) {
    console.log('Daily post limit reached (7 posts). Skipping.');
    return;
  }

  // 現在時刻からスロットを決定
  const hour = getJSTHour();
  const slot = determineSlot(hour, state);
  console.log(`Selected slot: ${slot} (hour: ${hour})`);

  // 画像投稿判定
  const shouldImage = shouldPostImage(state);
  let imagePath: string | null = null;

  if (shouldImage) {
    const imageDir = getImageDirForSlot(slot);
    imagePath = selectRandomImage(imageDir);
    if (imagePath) {
      console.log(`Will post with image: ${imagePath}`);
    } else {
      console.log('Image posting requested but no images available');
    }
  }

  // ツイート生成
  let tweetText: string | null = null;
  let usedFallback = false;

  if (isOpenAIAvailable()) {
    // OpenAIで生成を試みる
    for (let attempt = 0; attempt <= MAX_GENERATION_RETRIES; attempt++) {
      try {
        const prompt = buildPrompt(slot, state);
        console.log(`Generating tweet (attempt ${attempt + 1})...`);

        const result = await generateTweet(prompt);
        const validation = validateTweet(result.tweet, state.last_posts);

        if (validation.valid) {
          tweetText = result.tweet;
          // 気分を更新
          state.mood = result.mood;
          console.log(`Generated valid tweet: "${tweetText}"`);
          break;
        } else {
          console.warn(`Validation failed:`, validation.errors);
          state = incrementNgRetry(state);

          if (attempt === MAX_GENERATION_RETRIES) {
            console.warn('Max retries reached, will use fallback');
          }
        }
      } catch (error) {
        console.error(`Generation failed:`, error);
        if (attempt === MAX_GENERATION_RETRIES) {
          console.warn('OpenAI unavailable, will use fallback');
        }
      }
    }
  } else {
    console.log('OpenAI not available (no API key)');
  }

  // フォールバック
  if (!tweetText) {
    console.log('Using fallback tweet pool...');
    tweetText = getFallbackTweetForSlot(slot, state.last_posts);
    usedFallback = true;

    if (tweetText) {
      state = incrementFallbackUsed(state);
      console.log(`Fallback tweet: "${tweetText}"`);
    } else {
      console.error('No fallback tweet available. Aborting.');
      saveState(state);
      return;
    }
  }

  // X APIが利用可能かチェック
  if (!isXApiAvailable()) {
    console.log('X API not available (no token). Tweet would be:');
    console.log(`"${tweetText}"`);
    // 状態は更新しない（実際には投稿されていないため）
    return;
  }

  // 投稿
  try {
    let mediaId: string | null = null;

    if (imagePath) {
      console.log('Uploading media...');
      mediaId = await uploadMediaChunked(imagePath);
      console.log(`Media uploaded: ${mediaId}`);
    }

    console.log('Posting tweet...');
    const response = mediaId
      ? await createTweetWithMedia(tweetText, [mediaId])
      : await createTweet(tweetText);

    if (response) {
      console.log(`Tweet posted successfully! ID: ${response.data.id}`);
    }

    // 状態を更新
    state = updateStateAfterPost(state, tweetText, slot, !!mediaId);
    saveState(state);

    console.log(`State updated: today_posts=${state.today_post_count}, month_posts=${state.month_total_posts}`);
  } catch (error) {
    console.error('Failed to post tweet:', error);
    saveState(state);
    process.exit(1);
  }
}

// 実行
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
