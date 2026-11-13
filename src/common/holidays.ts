const HOLIDAYS = new Set<string>([
  '2026-12-25',
  '2027-01-01',
  '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
  '2027-03-01',
]);

export function isHoliday(date: string): boolean {
  return HOLIDAYS.has(date);
}

/** 0=일 ... 6=토 */
export function dayOfWeek(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export function isWeekendOrHoliday(date: string): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6 || isHoliday(date);
}

/** ISO 주 키: '2026-W50' */
export function isoWeekKey(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${week}`;
}

export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** 한국 시간 기준 오늘 YYYY-MM-DD */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
