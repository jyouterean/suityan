/**
 * エージェント実行エントリポイント
 * slot決定→image判定→生成→検証→投稿→state更新
 *
 * 施策1: 投稿間隔の揺れ（連投・沈黙の波）
 * 施策5: 投稿しない日・少ない日（today_max_posts）
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
  minutesSinceLastPost,
  type AgentState,
} from '../core/state.js';
import { buildPrompt, buildSelfReplyPrompt, determineSlot, getWeatherText } from '../core/prompt.js';
import { validateTweet } from '../core/validate.js';
import { getFallbackTweetForSlot } from '../core/fallback.js';
import { appendHashtags } from '../core/hashtags.js';
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
    simple_goodnight: 'daily',
    morning: 'daily',
    casual: 'daily',
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
 * 施策1: スキップ確率を投稿間隔に基づいて計算
 * 前回投稿から近い場合はスキップ確率を下げる（連投モード）
 * 前回投稿から遠い場合はスキップ確率を上げる（沈黙の波）
 */
function calculateSkipProbability(state: AgentState): number {
  const minutes = minutesSinceLastPost(state);

  // 初回投稿
  if (minutes === null) return 0.05;

  // 60分以内: 連投モード → スキップ確率低い
  if (minutes < 60) return 0.03;

  // 60-120分: 通常
  if (minutes < 120) return 0.08;

  // 120分以上: 沈黙の波 → スキップ確率高い（ただし上限2回まで）
  if (state.today_skip_count < 2) return 0.20;

  return 0.05;
}

/**
 * メイン実行関数
 */
async function main(): Promise<void> {
  console.log(`[${getJSTTimestamp()}] Starting agent run...`);

  // 状態を読み込み
  let state = loadState();
  console.log(`Current state: mood=${state.mood}, energy=${state.energy}, today_posts=${state.today_post_count}, today_max=${state.today_max_posts}`);

  // 施策5: 日ごとの投稿上限チェック
  if (state.today_post_count >= state.today_max_posts) {
    console.log(`Daily post limit reached (${state.today_max_posts} posts for today). Skipping.`);
    return;
  }

  // 現在時刻からスロットを決定
  const hour = getJSTHour();
  const slot = determineSlot(hour, state);
  console.log(`Selected slot: ${slot} (hour: ${hour})`);

  // 施策1: 投稿間隔に基づくスキップ判定
  // goodnight/simple_goodnight/morningはスキップしない
  const skipExemptSlots = new Set(['goodnight', 'simple_goodnight', 'morning']);
  if (!skipExemptSlots.has(slot)) {
    const skipProb = calculateSkipProbability(state);
    const minSinceLastStr = minutesSinceLastPost(state);
    console.log(`Skip probability: ${(skipProb * 100).toFixed(1)}% (minutes since last: ${minSinceLastStr ? Math.round(minSinceLastStr) : 'N/A'})`);

    if (Math.random() < skipProb) {
      console.log('Silence mode: skipping this post (human-like pause)');
      state.today_skipped = true;
      state.today_skip_count++;
      saveState(state);
      return;
    }
  }

  // 施策3: 天気情報を取得（非同期、失敗しても続行）
  let weatherText: string | null = null;
  try {
    weatherText = await getWeatherText();
    if (weatherText) {
      console.log(`Weather: ${weatherText}`);
    }
  } catch {
    console.log('Weather fetch failed, continuing without weather data');
  }

  // 画像投稿判定
  // 施策6: morning/simple_goodnightでは画像なし
  const noImageSlots = new Set(['morning', 'simple_goodnight']);
  const shouldImage = noImageSlots.has(slot) ? false : shouldPostImage(state);
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

  // 施策4(original): 自己リプライ風（15%の確率）
  const selfReplyPrompt = buildSelfReplyPrompt(state);

  if (isOpenAIAvailable()) {
    // OpenAIで生成を試みる
    for (let attempt = 0; attempt <= MAX_GENERATION_RETRIES; attempt++) {
      try {
        const prompt = selfReplyPrompt && attempt === 0
          ? selfReplyPrompt
          : buildPrompt(slot, state, weatherText);
        if (selfReplyPrompt && attempt === 0) {
          console.log('Using self-reply mode');
        }
        console.log(`Generating tweet (attempt ${attempt + 1})...`);

        const result = await generateTweet(prompt);
        const validation = validateTweet(result.tweet, state.last_posts, slot);

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

  // 施策7: ハッシュタグをスロットに応じて追加
  const tweetWithHashtags = appendHashtags(tweetText, 140, slot);
  console.log(`Tweet with hashtags: "${tweetWithHashtags}"`);

  // X APIが利用可能かチェック
  if (!isXApiAvailable()) {
    console.log('X API not available (no token). Tweet would be:');
    console.log(`"${tweetWithHashtags}"`);
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
      ? await createTweetWithMedia(tweetWithHashtags, [mediaId])
      : await createTweet(tweetWithHashtags);

    if (response) {
      console.log(`Tweet posted successfully! ID: ${response.data.id}`);
    }

    // 状態を更新（ハッシュタグなしのテキストを保存）
    state = updateStateAfterPost(state, tweetText, slot, !!mediaId);
    saveState(state);

    console.log(`State updated: today_posts=${state.today_post_count}, month_posts=${state.month_total_posts}, max_today=${state.today_max_posts}`);
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
