/**
 * JST時刻・日付処理ユーティリティ
 */

const JST_OFFSET = 9 * 60 * 60 * 1000; // UTC+9

export function getJSTDate(): Date {
  const now = new Date();
  return new Date(now.getTime() + JST_OFFSET);
}

export function getJSTHour(): number {
  const jst = getJSTDate();
  return jst.getUTCHours();
}

export function getJSTDateString(): string {
  const jst = getJSTDate();
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getJSTMonthString(): string {
  const jst = getJSTDate();
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getJSTTimeString(): string {
  const jst = getJSTDate();
  const hours = String(jst.getUTCHours()).padStart(2, '0');
  const minutes = String(jst.getUTCMinutes()).padStart(2, '0');
  const seconds = String(jst.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function getJSTTimestamp(): string {
  return `${getJSTDateString()} ${getJSTTimeString()}`;
}

export function isSameJSTDay(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr === getJSTDateString();
}

export function isSameJSTMonth(monthStr: string | null): boolean {
  if (!monthStr) return false;
  return monthStr.startsWith(getJSTMonthString());
}
