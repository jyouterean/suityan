/**
 * プロンプト合成モジュール
 * persona + slot + theme + memory から短いプロンプトを生成
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentState, PostRecord } from './state.js';

interface Persona {
  name: string;
  age: number;
  location: string;
  job: string;
  personality: string[];
  speech_style: string[];
  favorite_phrases: string[];
}

interface SlotConfig {
  name: string;
  hours: number[];
  weight: number;
  tone: string;
  required_elements: string[];
  max_per_day?: number;
  examples?: string[];
}

interface Slots {
  [key: string]: SlotConfig;
}

interface Themes {
  logistics: string[];
  daily: string[];
  emotion: string[];
  romance: string[];
}

let persona: Persona | null = null;
let slots: Slots | null = null;
let themes: Themes | null = null;

function loadPersona(): Persona {
  if (persona) return persona;
  const path = join(process.cwd(), 'config', 'persona.yaml');
  const content = readFileSync(path, 'utf-8');
  persona = parseYaml(content) as Persona;
  return persona;
}

function loadSlots(): Slots {
  if (slots) return slots;
  const path = join(process.cwd(), 'config', 'slots.yaml');
  const content = readFileSync(path, 'utf-8');
  slots = parseYaml(content) as Slots;
  return slots;
}

function loadThemes(): Themes {
  if (themes) return themes;
  const path = join(process.cwd(), 'config', 'themes.json');
  const content = readFileSync(path, 'utf-8');
  themes = JSON.parse(content) as Themes;
  return themes;
}

/**
 * 現在時刻に適したスロットを決定
 */
export function determineSlot(hour: number, state: AgentState): string {
  const slotsConfig = loadSlots();

  // goodnightは1日1回のみ
  if (!state.today_goodnight_posted && (hour === 23 || hour === 0)) {
    return 'goodnight';
  }

  // 時間帯に合うスロットを収集
  const candidates: { slot: string; weight: number }[] = [];

  for (const [slotName, config] of Object.entries(slotsConfig)) {
    if (slotName === 'goodnight' && state.today_goodnight_posted) {
      continue;
    }

    if (config.hours.includes(hour)) {
      candidates.push({ slot: slotName, weight: config.weight });
    }
  }

  if (candidates.length === 0) {
    // デフォルトはdelivery
    return 'delivery';
  }

  // 重み付きランダム選択
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  for (const candidate of candidates) {
    random -= candidate.weight;
    if (random <= 0) {
      return candidate.slot;
    }
  }

  return candidates[0].slot;
}

/**
 * ランダムにテーマを選択
 */
function pickRandomTheme(): { logistics: string; daily: string; emotion: string } {
  const t = loadThemes();
  return {
    logistics: t.logistics[Math.floor(Math.random() * t.logistics.length)],
    daily: t.daily[Math.floor(Math.random() * t.daily.length)],
    emotion: t.emotion[Math.floor(Math.random() * t.emotion.length)],
  };
}

/**
 * 直近投稿のサマリーを生成
 */
function getRecentPostsSummary(posts: PostRecord[]): string {
  if (posts.length === 0) {
    return 'なし';
  }
  return posts
    .slice(0, 3)
    .map(p => `「${p.text.slice(0, 20)}...」`)
    .join(' / ');
}

/**
 * プロンプトを生成
 */
export function buildPrompt(slot: string, state: AgentState): string {
  const p = loadPersona();
  const s = loadSlots();
  const slotConfig = s[slot];
  const theme = pickRandomTheme();

  // 簡潔なプロンプト（トークン節約）
  const prompt = `あなたは「${p.name}」（${p.age}歳、${p.location}在住、${p.job}）。
性格: ${p.personality.slice(0, 3).join('、')}
口調: ${p.speech_style.slice(0, 2).join('、')}

【状況】${slotConfig.name}
${slotConfig.tone.trim()}

【今回のテーマ】
- 軽貨物: ${theme.logistics}
- 日常: ${theme.daily}
- 感情: ${theme.emotion}

【制約】
- 140字以内（理想30-60字）
- 絵文字2個以内
- 軽貨物関連ワード必須
- 露骨/過激表現禁止

【直近投稿】${getRecentPostsSummary(state.last_posts)}
【気分】${state.mood} / 体力${state.energy}%

上記を踏まえ、自然な1ツイートを生成。`;

  return prompt;
}

/**
 * スロット設定を取得
 */
export function getSlotConfig(slot: string): SlotConfig | null {
  const s = loadSlots();
  return s[slot] || null;
}
