export type ScheduleEntry = {
  id: string;
  title: string;
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  location: string;
  color: 'slate' | 'coral' | 'sage';
};

export function todayAgenda(entries: ScheduleEntry[], now: Date) {
  const day = (now.getDay() + 6) % 7;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = entries.filter((entry) => entry.day === day).sort((a, b) => a.start.localeCompare(b.start));
  const remaining = today.filter((entry) => entry.end > time);
  const next = remaining[0];
  return { today, remaining, next, ongoing: Boolean(next && next.start <= time) };
}

export function parseSchedule(raw: string | null): ScheduleEntry[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Invalid schedule');
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' ||
      typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() ||
      !Number.isInteger(item.day) || item.day < 0 || item.day > 6 ||
      typeof item.start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start) ||
      typeof item.end !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.end) ||
      item.end <= item.start || typeof item.location !== 'string' ||
      !['slate', 'coral', 'sage'].includes(item.color)) {
      throw new Error('Invalid schedule entry');
    }
    ids.add(item.id);
  }
  return value;
}
