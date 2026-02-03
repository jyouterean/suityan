/**
 * プロンプト合成モジュール
 * persona + slot + theme + memory から短いプロンプトを生成
 * 時間帯口調/曜日感覚/季節テーマ/数値具体性/エネルギー影響/独り言パターン を注入
 * 施策2: 文体バリエーション / 施策3: 天気連携 / 施策4: 文脈連続性
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { getJSTDate } from '../utils/jst.js';
import type { AgentState, PostRecord } from './state.js';
import { getCurrentWeather, weatherToPromptText } from './weather.js';

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
  micro_events: string[];
}

interface Quirks {
  soliloquy: string[];
  self_tsukkomi: string[];
  trailing: string[];
}

let persona: Persona | null = null;
let slots: Slots | null = null;
let themes: Themes | null = null;
let quirks: Quirks | null = null;

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

function loadQuirks(): Quirks {
  if (quirks) return quirks;
  const path = join(process.cwd(), 'config', 'quirks.yaml');
  const content = readFileSync(path, 'utf-8');
  quirks = parseYaml(content) as Quirks;
  return quirks;
}

// --- 施策1: 時間帯に応じた口調の揺れ ---
function getTimeBasedTone(hour: number): string {
  if (hour >= 6 && hour <= 7) {
    return '寝起き。ほぼ意識ない。「…」「むり」のような断片的な言葉だけ。';
  }
  if (hour >= 8 && hour <= 9) {
    return '眠い・テンション低め。「ねむ…」「だる」のような短い言葉が混ざる。口数少なめ。';
  }
  if (hour >= 10 && hour <= 14) {
    return '少し元気。通常の口調で、仕事モード。';
  }
  if (hour >= 15 && hour <= 19) {
    return '疲れ始め。弱音が混ざる。「あーもう」「しんど」のような言葉が出がち。';
  }
  if (hour >= 20 || hour === 0) {
    return '寂しい・甘えモード。甘え口調強め。「…ねぇ」「かまって」のようなニュアンスが出る。';
  }
  return '通常の口調。';
}

// --- 施策2(original): 季節テーマ ---
function getSeasonalContext(month: number): string {
  if (month >= 3 && month <= 5) return '春。花粉、暖かくなってきた、桜、新生活。';
  if (month >= 6 && month <= 8) return '夏。暑い、汗だく、日焼け、アイス、冷房。';
  if (month >= 9 && month <= 11) return '秋。涼しくなった、食欲、紅葉、日が短い。';
  return '冬。寒い、手がかじかむ、防寒、温かいもの飲みたい。';
}

// --- 施策2(original): 曜日の気分 ---
function getDayOfWeekContext(dow: number): string {
  const contexts: Record<number, string> = {
    0: '日曜。仕事あるけど気持ちはゆるい。',
    1: '月曜。憂鬱。週の始まりだるい。',
    2: '火曜。まだ週の前半、淡々と。',
    3: '水曜。折り返し、普通。',
    4: '木曜。あと少し、普通。',
    5: '金曜。開放感。週末が見える。',
    6: '土曜。仕事あるけどゆるい。少しだけ楽しい。',
  };
  return contexts[dow] || '';
}

// --- 施策3(original): 独り言・自己ツッコミ ---
function getQuirkInstruction(): string {
  if (Math.random() > 0.3) return '';

  const q = loadQuirks();
  const lists = [q.soliloquy, q.self_tsukkomi, q.trailing];
  const chosen = lists[Math.floor(Math.random() * lists.length)];
  const phrase = chosen[Math.floor(Math.random() * chosen.length)];

  return `\n【揺れ指示】ツイートのどこかに自然に「${phrase}」のようなニュアンスを入れて。`;
}

// --- 施策2(新): 文体バリエーション ---
function getStyleVariation(energy: number): string {
  const variations: string[] = [];

  // 句読点の揺れ
  if (Math.random() < 0.3) {
    variations.push('今回は「。」を使わず、体言止めや「…」で終わらせて。');
  } else if (Math.random() < 0.2) {
    variations.push('今回は句読点を普通に使って丁寧めに。');
  }

  // ひらがな率（疲れてるとき）
  if (energy < 30) {
    variations.push('疲れてるので漢字が減る。ひらがな多めで。「配達」→「はいたつ」みたいに。');
  }

  // 文末パターン
  const endings = [
    '文末は「〜な」「〜かも」で終わらせて。',
    '文末は「〜だわ」「〜よね」で終わらせて。',
    '文末を「〜…」で余韻を残して。',
    '文末は断言系で。「〜だ」「〜する」。',
  ];
  if (Math.random() < 0.25) {
    variations.push(endings[Math.floor(Math.random() * endings.length)]);
  }

  // 打ち間違い風（3%）
  if (Math.random() < 0.03) {
    variations.push('1文字だけ打ち間違いを入れて（例: 「おやすみ」→「おやすmい」「ねむい」→「ねむうい」）。自然なtypoで。');
  }

  return variations.length > 0 ? '\n【文体指示】' + variations.join(' ') : '';
}

// --- 施策4(original): 自己リプライ風プロンプト生成 ---
export function buildSelfReplyPrompt(state: AgentState): string | null {
  if (state.last_posts.length === 0) return null;
  if (Math.random() > 0.15) return null;

  const lastPost = state.last_posts[0];
  const p = loadPersona();
  const jst = getJSTDate();
  const hour = jst.getUTCHours();

  return `あなたは「${p.name}」（${p.age}歳、${p.location}在住、${p.job}）。
口調: ${p.speech_style.slice(0, 2).join('、')}

さっき自分でこうツイートした:
「${lastPost.text}」

これに対して「さっきの〜だけど」「てかさっきの」「いや関係ないけど」のように、自分の直前の投稿を自然に受けた続きの1ツイートを生成。
${getTimeBasedTone(hour)}
${getEnergyInstruction(state.energy)}
- 140字以内（理想30-60字）
- 絵文字2個以内
- 露骨/過激表現禁止`;
}

// --- 施策6(original): エネルギー影響 ---
function getEnergyInstruction(energy: number): string {
  if (energy < 20) return '体力ほぼゼロ。一言だけ。もう何も考えたくない感じ。';
  if (energy < 40) return '体力低い。短く、だるそうに。言葉を選ぶ余裕がない。';
  if (energy > 80) return '元気。テンション高め、言葉に勢いがある。';
  return '';
}

// --- 感情の色付け ---
function getMoodColor(mood: string): string {
  const colors: Record<string, string> = {
    happy: '嬉しい気持ち。「！」や明るい言葉が自然に出る。',
    angry: 'イライラしてる。言葉が荒っぽくなる。「は？」「マジで」が出る。',
    frustrated: 'もどかしい。うまくいかなくてモヤモヤ。',
    proud: 'ちょっと誇らしい。頑張った自分を認めたい。',
    melancholy: 'なんとなく切ない。「…」が多くなる。',
    playful: 'ふざけたい気分。軽い冗談やツッコミが出る。',
    tired: '疲れてる。言葉が短く、力がない。',
    lonely: '寂しい。誰かにかまってほしい。',
    excited: 'ワクワクしてる。テンション高い。',
    relieved: 'ほっとしてる。穏やかな言葉。',
    anxious: '不安。「大丈夫かな」「やばい」が出がち。',
    neutral: '普通。特に強い感情はない。',
  };
  return colors[mood] || '';
}

// --- 施策8(original): 数値の具体性 ---
function getConcreteNumbers(): string {
  const deliveryCount = Math.floor(Math.random() * 81) + 70; // 70-150
  const remaining = Math.floor(Math.random() * 30) + 1; // 1-30
  const floor = Math.floor(Math.random() * 15) + 1; // 1-15F
  const items = [
    `今日の配達件数: ${deliveryCount}件`,
    `残り: ${remaining}件`,
    `さっき${floor}Fまで階段で上がった`,
  ];
  // 1-2個をランダムに選択
  const count = Math.random() < 0.5 ? 1 : 2;
  const shuffled = items.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).join('、');
}

// --- 施策4(新): 今日の流れをプロンプトに注入 ---
function getNarrativeContext(state: AgentState): string {
  if (!state.today_narrative || state.today_post_count < 2) return '';
  return `\n今日の投稿の流れ: ${state.today_narrative}\n↑この流れを自然に受けた内容で。さっきの話題の続きや「さっき〜って言ったけど」のような繋がりを意識。`;
}

/**
 * 現在時刻に適したスロットを決定
 */
export function determineSlot(hour: number, state: AgentState): string {
  const slotsConfig = loadSlots();

  // morningは1日1回のみ
  if (!state.today_morning_posted && (hour === 6 || hour === 7)) {
    return 'morning';
  }

  // simple_goodnightは1日1回のみ（goodnightと排他）
  if (!state.today_simple_goodnight_posted && !state.today_goodnight_posted && (hour === 23 || hour === 0)) {
    // 50%の確率でsimple_goodnightかgoodnightを選ぶ
    if (Math.random() < 0.5) {
      return 'simple_goodnight';
    }
  }

  // goodnightは1日1回のみ
  if (!state.today_goodnight_posted && !state.today_simple_goodnight_posted && (hour === 23 || hour === 0)) {
    return 'goodnight';
  }

  // 時間帯に合うスロットを収集
  const candidates: { slot: string; weight: number }[] = [];

  for (const [slotName, config] of Object.entries(slotsConfig)) {
    // max_per_day制限のあるスロットで既に投稿済みならスキップ
    if (slotName === 'goodnight' && state.today_goodnight_posted) continue;
    if (slotName === 'simple_goodnight' && state.today_simple_goodnight_posted) continue;
    if (slotName === 'morning' && state.today_morning_posted) continue;

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
function pickRandomTheme(): { logistics: string; daily: string; emotion: string; microEvent: string | null } {
  const t = loadThemes();
  return {
    logistics: t.logistics[Math.floor(Math.random() * t.logistics.length)],
    daily: t.daily[Math.floor(Math.random() * t.daily.length)],
    emotion: t.emotion[Math.floor(Math.random() * t.emotion.length)],
    microEvent: Math.random() < 0.4
      ? t.micro_events[Math.floor(Math.random() * t.micro_events.length)]
      : null,
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
 * 天気テキスト取得（非同期）
 * 取得失敗時はnullを返す
 */
export async function getWeatherText(): Promise<string | null> {
  try {
    const weather = await getCurrentWeather();
    if (!weather) return null;
    return weatherToPromptText(weather);
  } catch {
    return null;
  }
}

/**
 * morning/simple_goodnight用の超短文プロンプト
 */
function buildShortPrompt(slot: string, state: AgentState): string {
  const p = loadPersona();
  const styleVar = getStyleVariation(state.energy);

  if (slot === 'morning') {
    return `あなたは「${p.name}」（${p.age}歳、${p.location}住み、${p.job}）。
口調: ${p.speech_style.slice(0, 2).join('、')}

寝起きの一言ツイートを1つ生成。
「おはよ」「ねむ…」「あさ…むり」のような超短い投稿。
仕事の話は不要。軽貨物ワードも不要。

直近のツイート: ${getRecentPostsSummary(state.last_posts)}
↑と被らない内容で。
${styleVar}
ルール: 15字以内、絵文字0-1個、露骨/過激表現禁止。
本人が寝ぼけながらスマホで打つ感じ。`;
  }

  // simple_goodnight
  return `あなたは「${p.name}」（${p.age}歳、${p.location}住み、${p.job}）。
口調: ${p.speech_style.slice(0, 2).join('、')}

寝る前の一言ツイートを1つ生成。
「おやすみ」「ねる」「もうむり、ねる」のような超短い投稿。
仕事の話は不要。軽貨物ワードも不要。

直近のツイート: ${getRecentPostsSummary(state.last_posts)}
↑と被らない内容で。
${styleVar}
ルール: 15字以内、絵文字0-1個、露骨/過激表現禁止。
もう眠くて限界な感じ。`;
}

/**
 * casual用の日常つぶやきプロンプト
 */
function buildCasualPrompt(state: AgentState, weatherText: string | null): string {
  const p = loadPersona();
  const jst = getJSTDate();
  const hour = jst.getUTCHours();
  const month = jst.getUTCMonth() + 1;
  const dow = jst.getUTCDay();

  const timeTone = getTimeBasedTone(hour);
  const seasonal = getSeasonalContext(month);
  const dayContext = getDayOfWeekContext(dow);
  const moodColor = getMoodColor(state.mood);
  const styleVar = getStyleVariation(state.energy);
  const narrative = getNarrativeContext(state);
  const weatherLine = weatherText ? `\n${weatherText}天気に触れてもいいし、触れなくてもいい。` : '';

  return `${p.name}、${p.age}歳、${p.location}住み、${p.job}。
${p.personality.slice(0, 3).join('、')}な性格。
口調: ${p.speech_style.slice(0, 2).join('、')}

仕事と無関係な日常のつぶやきを1つ生成。
ご飯、天気、テレビ、コンビニ、独り言、なんでもない日常。
軽貨物・配達・仕事の話は禁止。普通の23歳女子の投稿。

${timeTone}
${seasonal}${dayContext}
今の気持ち: ${moodColor}${weatherLine}${narrative}
${styleVar}
直近のツイート: ${getRecentPostsSummary(state.last_posts)}
↑と被らない内容で。

ルール: 140字以内（理想20-50字）、絵文字2個以内、露骨/過激表現禁止。
「〜しました」「今日は〜です」のような報告調は禁止。本人がスマホでボソッとつぶやく感じで。`;
}

/**
 * プロンプトを生成
 */
export function buildPrompt(slot: string, state: AgentState, weatherText?: string | null): string {
  // 新スロット用の特別プロンプト
  if (slot === 'morning' || slot === 'simple_goodnight') {
    return buildShortPrompt(slot, state);
  }
  if (slot === 'casual') {
    return buildCasualPrompt(state, weatherText ?? null);
  }

  const p = loadPersona();
  const s = loadSlots();
  const slotConfig = s[slot];
  const theme = pickRandomTheme();

  const jst = getJSTDate();
  const hour = jst.getUTCHours();
  const month = jst.getUTCMonth() + 1;
  const dow = jst.getUTCDay();

  const timeTone = getTimeBasedTone(hour);
  const seasonal = getSeasonalContext(month);
  const dayContext = getDayOfWeekContext(dow);
  const energyInst = getEnergyInstruction(state.energy);
  const numbers = getConcreteNumbers();
  const quirkInst = getQuirkInstruction();
  const styleVar = getStyleVariation(state.energy);
  const narrative = getNarrativeContext(state);

  const moodColor = getMoodColor(state.mood);
  const microEventLine = theme.microEvent ? `\nさっきあったこと: ${theme.microEvent}` : '';
  const weatherLine = weatherText ? `\n${weatherText}` : '';

  const prompt = `${p.name}、${p.age}歳、${p.location}住み、${p.job}。
${p.personality.slice(0, 3).join('、')}な性格。
口調: ${p.speech_style.slice(0, 2).join('、')}

今は${slotConfig.name}の時間。
${slotConfig.tone.trim()}

${timeTone}
${seasonal}${dayContext}${weatherLine}

今の気持ち: ${theme.emotion}。${moodColor}
体力${state.energy}%。${energyInst}
仕事のキーワード: ${theme.logistics}
日常: ${theme.daily}
使える数字: ${numbers}${microEventLine}
${quirkInst}${styleVar}${narrative}
直近のツイート: ${getRecentPostsSummary(state.last_posts)}
↑と被らない内容で。

ルール: 140字以内（理想30-60字）、絵文字2個以内、軽貨物関連ワード必須、露骨/過激表現禁止。
「〜しました」「今日は〜です」のような報告調は禁止。本人がスマホでボソッとつぶやく感じで。`;

  return prompt;
}

/**
 * スロット設定を取得
 */
export function getSlotConfig(slot: string): SlotConfig | null {
  const s = loadSlots();
  return s[slot] || null;
}
