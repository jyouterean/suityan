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
  month_total_posts: number;
  month_image_posts: number;
  month_string?: string;
  last_image_date: string | null;
  last_post_date: string | null;
  last_post_time: string | null;
  today_skipped: boolean;
  ng_retry_count: number;
  fallback_used_count: number;
  created_at: string | null;
  updated_at: string | null;
}

const STATE_PATH = join(process.cwd(), 'state', 'state.json');

const DEFAULT_STATE: AgentState = {
  mood: 'neutral',
  energy: 70,
  last_posts: [],
  today_slots_used: [],
  today_post_count: 0,
  today_goodnight_posted: false,
  month_total_posts: 0,
  month_image_posts: 0,
  month_string: undefined,
  last_image_date: null,
  last_post_date: null,
  last_post_time: null,
  today_skipped: false,
  ng_retry_count: 0,
  fallback_used_count: 0,
  created_at: null,
  updated_at: null,
};

export function loadState(): AgentState {
  if (!existsSync(STATE_PATH)) {
    const newState = { ...DEFAULT_STATE, created_at: getJSTTimestamp() };
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
      state.today_skipped = false;
      // 朝のエネルギー回復
      state.energy = 80;
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
    return { ...DEFAULT_STATE, created_at: getJSTTimestamp() };
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

  state.last_post_date = now;
  state.last_post_time = time;

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
