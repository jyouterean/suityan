/**
 * 天気情報取得モジュール
 * Open-Meteo API（無料・キー不要）で大久保(新宿区)付近の天気を取得
 */

interface WeatherData {
  description: string;
  temperature: number;
  isRainy: boolean;
  isHot: boolean;
  isCold: boolean;
}

// WMOコード → 日本語
function wmoToDescription(code: number): string {
  const map: Record<number, string> = {
    0: '快晴',
    1: 'ほぼ晴れ',
    2: '一部曇り',
    3: '曇り',
    45: '霧',
    48: '霧',
    51: '小雨',
    53: '雨',
    55: '強い雨',
    56: '凍雨',
    57: '凍雨',
    61: '小雨',
    63: '雨',
    65: '大雨',
    66: '凍雨',
    67: '凍雨',
    71: '小雪',
    73: '雪',
    75: '大雪',
    77: '霰',
    80: 'にわか雨',
    81: 'にわか雨',
    82: '激しいにわか雨',
    85: 'にわか雪',
    86: '激しいにわか雪',
    95: '雷雨',
    96: '雷雨（雹）',
    99: '激しい雷雨',
  };
  return map[code] || '不明';
}

let cachedWeather: { data: WeatherData; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1時間

/**
 * 現在の天気を取得（大久保/新宿区付近）
 * Open-Meteo API: 無料・キー不要
 */
export async function getCurrentWeather(): Promise<WeatherData | null> {
  // キャッシュチェック
  if (cachedWeather && Date.now() - cachedWeather.fetchedAt < CACHE_TTL) {
    return cachedWeather.data;
  }

  try {
    // 新宿区の緯度経度
    const lat = 35.6938;
    const lon = 139.7034;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Weather API returned ${response.status}`);
      return null;
    }

    const json = await response.json() as {
      current: {
        temperature_2m: number;
        weather_code: number;
      };
    };

    const temp = json.current.temperature_2m;
    const code = json.current.weather_code;
    const desc = wmoToDescription(code);
    const isRainy = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);

    const data: WeatherData = {
      description: desc,
      temperature: Math.round(temp),
      isRainy,
      isHot: temp >= 30,
      isCold: temp <= 5,
    };

    cachedWeather = { data, fetchedAt: Date.now() };
    return data;
  } catch (error) {
    console.warn('Failed to fetch weather:', error);
    return null;
  }
}

/**
 * 天気情報をプロンプト用テキストに変換
 */
export function weatherToPromptText(weather: WeatherData): string {
  let text = `今の天気: ${weather.description}、気温${weather.temperature}℃。`;
  if (weather.isRainy) text += ' 雨が降ってる。';
  if (weather.isHot) text += ' めちゃくちゃ暑い。';
  if (weather.isCold) text += ' かなり寒い。';
  return text;
}
