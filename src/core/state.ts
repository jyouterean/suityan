/**
 * State管理モジュール
 * state/state.json の読み書きを担当
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getJSTDateString, getJSTTimeString, getJSTTimestamp, isSameJSTDay } from '../utils/jst.js';

export interface PostRecord {
  text: string;
  slot: string;
  timestamp: string;
  hasImage: boolean;
}

export interface AgentState {
  mood: 'happy' | 'neutral' | 'tired' | 'lonely' | 'excited' | 'angry' | 'frustrated' | 'proud' | 'melancholy' | 'playful' | 'relieved' | 'anxious';
  energy: number; // 0-100
  last_posts: PostRecord[];
  today_slots_used: string[];
  today_post_count: number;
  today_goodnight_posted: boolean;
  today_simple_goodnight_posted: boolean;
  today_morning_posted: boolean;
  today_max_posts: number; // 施策5: 日ごとの最大投稿数（8-15）
  today_narrative: string; // 施策4: 今日のストーリーライン
  month_total_posts: number;
  month_image_posts: number;
  month_string?: string;
  last_image_date: string | null;
  last_post_date: string | null;
  last_post_time: string | null;
  last_post_timestamp_ms: number | null; // 施策1: 連投検出用
  today_skipped: boolean;
  today_skip_count: number; // 施策1: 連続スキップ対応
  ng_retry_count: number;
  fallback_used_count: number;
  created_at: string | null;
  updated_at: string | null;
}

const STATE_PATH = join(process.cwd(), 'state', 'state.json');

/**
 * 施策5: 日ごとの最大投稿数をランダムに決定（8-15）
 */
function randomDailyMaxPosts(): number {
  // 70%の確率で13-15、30%の確率で8-12（少ない日）
  if (Math.random() < 0.3) {
    return Math.floor(Math.random() * 5) + 8; // 8-12
  }
  return Math.floor(Math.random() * 3) + 13; // 13-15
}

const DEFAULT_STATE: AgentState = {
  mood: 'neutral',
  energy: 70,
  last_posts: [],
  today_slots_used: [],
  today_post_count: 0,
  today_goodnight_posted: false,
  today_simple_goodnight_posted: false,
  today_morning_posted: false,
  today_max_posts: 15,
  today_narrative: '',
  month_total_posts: 0,
  month_image_posts: 0,
  month_string: undefined,
  last_image_date: null,
  last_post_date: null,
  last_post_time: null,
  last_post_timestamp_ms: null,
  today_skipped: false,
  today_skip_count: 0,
  ng_retry_count: 0,
  fallback_used_count: 0,
  created_at: null,
  updated_at: null,
};

export function loadState(): AgentState {
  if (!existsSync(STATE_PATH)) {
    const newState = { ...DEFAULT_STATE, created_at: getJSTTimestamp(), today_max_posts: randomDailyMaxPosts() };
    saveState(newState);
    return newState;
  }

  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    const state = JSON.parse(raw) as AgentState;

    // 日付が変わっていたら日次カウンターをリセット
    if (!isSameJSTDay(state.last_post_date)) {
      state.today_slots_used = [];
      state.today_post_count = 0;
      state.today_goodnight_posted = false;
      state.today_simple_goodnight_posted = false;
      state.today_morning_posted = false;
      state.today_skipped = false;
      state.today_skip_count = 0;
      state.today_max_posts = randomDailyMaxPosts();
      state.today_narrative = '';
      // 朝のエネルギー回復
      state.energy = 80;
    }

    // 既存stateに新フィールドがない場合のマイグレーション
    if (state.today_simple_goodnight_posted === undefined) {
      state.today_simple_goodnight_posted = false;
    }
    if (state.today_morning_posted === undefined) {
      state.today_morning_posted = false;
    }
    if (state.today_max_posts === undefined) {
      state.today_max_posts = randomDailyMaxPosts();
    }
    if (state.today_narrative === undefined) {
      state.today_narrative = '';
    }
    if (state.last_post_timestamp_ms === undefined) {
      state.last_post_timestamp_ms = null;
    }
    if (state.today_skip_count === undefined) {
      state.today_skip_count = 0;
    }

    // 月が変わっていたら月次カウンターをリセット
    const currentMonth = getJSTDateString().slice(0, 7);
    if (state.month_string !== currentMonth) {
      state.month_total_posts = 0;
      state.month_image_posts = 0;
      state.month_string = currentMonth;
    }

    return state;
  } catch (e) {
    console.error('Failed to load state, using default:', e);
    return { ...DEFAULT_STATE, created_at: getJSTTimestamp(), today_max_posts: randomDailyMaxPosts() };
  }
}

export function saveState(state: AgentState): void {
  state.updated_at = getJSTTimestamp();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

export function updateStateAfterPost(
  state: AgentState,
  text: string,
  slot: string,
  hasImage: boolean
): AgentState {
  const now = getJSTDateString();
  const time = getJSTTimeString();

  // 直近7投稿を保持
  const newPost: PostRecord = {
    text,
    slot,
    timestamp: getJSTTimestamp(),
    hasImage,
  };

  state.last_posts = [newPost, ...state.last_posts].slice(0, 7);
  state.today_slots_used.push(slot);
  state.today_post_count++;
  state.month_total_posts++;

  if (hasImage) {
    state.month_image_posts++;
    state.last_image_date = now;
  }

  if (slot === 'goodnight') {
    state.today_goodnight_posted = true;
  }
  if (slot === 'simple_goodnight') {
    state.today_simple_goodnight_posted = true;
  }
  if (slot === 'morning') {
    state.today_morning_posted = true;
  }

  state.last_post_date = now;
  state.last_post_time = time;
  state.last_post_timestamp_ms = Date.now();

  // 施策4: ナラティブ更新
  const shortText = text.length > 20 ? text.slice(0, 20) + '…' : text;
  state.today_narrative += (state.today_narrative ? ' → ' : '') + shortText;

  // エネルギーと気分を更新
  state.energy = Math.max(10, state.energy - 10);
  // 投稿後の気分はOpenAIの返却値で上書きされるが、フォールバック用
  if (state.energy < 20) {
    state.mood = 'tired';
  } else if (state.energy < 40) {
    const lowMoods: AgentState['mood'][] = ['tired', 'frustrated', 'melancholy'];
    state.mood = lowMoods[Math.floor(Math.random() * lowMoods.length)];
  } else if (slot === 'night_ero') {
    state.mood = 'lonely';
  }

  return state;
}

/**
 * 施策1: 前回投稿からの経過分数を計算
 */
export function minutesSinceLastPost(state: AgentState): number | null {
  if (!state.last_post_timestamp_ms) return null;
  return (Date.now() - state.last_post_timestamp_ms) / (1000 * 60);
}

export function incrementNgRetry(state: AgentState): AgentState {
  state.ng_retry_count++;
  return state;
}

export function incrementFallbackUsed(state: AgentState): AgentState {
  state.fallback_used_count++;
  return state;
}

export function getCurrentImageRatio(state: AgentState): number {
  if (state.month_total_posts === 0) return 0;
  return state.month_image_posts / state.month_total_posts;
}

export function shouldPostImage(state: AgentState): boolean {
  const TARGET_RATIO = 0.10; // 10%
  const currentRatio = getCurrentImageRatio(state);

  // 月初めは確率的に判定
  if (state.month_total_posts < 10) {
    return Math.random() < TARGET_RATIO;
  }

  // 画像比率が目標より低ければ高確率で画像投稿
  if (currentRatio < TARGET_RATIO - 0.02) {
    return Math.random() < 0.3; // 30%の確率
  }

  // 目標に近いか超えていれば低確率
  if (currentRatio >= TARGET_RATIO) {
    return Math.random() < 0.02; // 2%の確率
  }

  return Math.random() < TARGET_RATIO;
}
