export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SCHEDULE_KEY = '@miniapps/schedule';

export const SCHEDULE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown'] as const;
export type ScheduleColor = typeof SCHEDULE_COLORS[number];

// The first palette only had three keys. 'coral' was shown as blue, so each
// legacy key maps to the hue people actually saw.
const LEGACY_COLORS: Record<string, ScheduleColor> = { slate: 'indigo', coral: 'blue', sage: 'green' };

export function normalizeScheduleColor(value: unknown): ScheduleColor | null {
  if (typeof value !== 'string') return null;
  if ((SCHEDULE_COLORS as readonly string[]).includes(value)) return value as ScheduleColor;
  return LEGACY_COLORS[value] ?? null;
}

export type ScheduleEntry = {
  id: string;
  title: string;
  /** Course code, e.g. "GE703". Optional: older records have none. */
  code?: string;
  /** Section letter(s), e.g. "U". */
  section?: string;
  /** Session type: theory, practice or lab, as enrolment slips print it. */
  kind?: ClassKind;
  day: DayIndex;
  start: string;
  end: string;
  /** Classroom (shown as "Aula"); the key keeps its original name for stored data. */
  location: string;
  color: ScheduleColor;
};

export const CLASS_KINDS = [
  { key: 'T', label: 'Teoría' },
  { key: 'PRA', label: 'Práctica' },
  { key: 'LAB', label: 'Laboratorio' },
] as const;
export type ClassKind = typeof CLASS_KINDS[number]['key'];

/** Reads a slip's TIPO value ("T", "PRA", "Práctica", "LAB"…) into a kind. */
export function normalizeClassKind(value: unknown): ClassKind | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toUpperCase();
  if (!text) return undefined;
  if (text === 'T' || text.startsWith('TEO')) return 'T';
  if (text === 'P' || text.startsWith('PR')) return 'PRA';
  if (text === 'L' || text.startsWith('LAB')) return 'LAB';
  return undefined;
}

export function classKindLabel(kind: ClassKind | undefined) {
  return CLASS_KINDS.find((item) => item.key === kind)?.label ?? '';
}

export function sameCourse(a: Pick<ScheduleEntry, 'code' | 'title'>, b: Pick<ScheduleEntry, 'code' | 'title'>) {
  return a.code && b.code ? a.code === b.code : a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
}

/**
 * Whether two classes collide. A course's theory and practice may share hours,
 * so different session types of the same course never count as a clash.
 */
export function classesClash(a: ScheduleEntry, b: ScheduleEntry) {
  if (a.id === b.id || a.day !== b.day) return false;
  if (!(a.start < b.end && a.end > b.start)) return false;
  return !(sameCourse(a, b) && a.kind && b.kind && a.kind !== b.kind);
}

/**
 * University systems often print code and section together ("GE703U"): the
 * letters after the digits are the section. Returns the split, or null when the
 * text is not in that shape.
 */
export function splitCourseCode(value: string): { code: string; section: string } | null {
  const match = value.trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,5}\d{2,4})([A-Z]{1,2})$/);
  return match ? { code: match[1], section: match[2] } : null;
}

/** "GE703 U", "GE703", or "" — how a class's code reads in the interface. */
export function courseLabel(entry: Pick<ScheduleEntry, 'code' | 'section'>) {
  return [entry.code, entry.section].filter(Boolean).join(' ');
}

const MINOR_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'para', 'con', 'por', 'al']);

/**
 * A few characters that stand for the course where space is tight: its code
 * when it has one, else the initials of its main words, keeping a trailing
 * roman numeral ("Investigación de Operaciones II" → "IO II").
 */
export function shortCourseName(entry: Pick<ScheduleEntry, 'title' | 'code'>) {
  if (entry.code) return entry.code;
  const words = entry.title.split(/[\s\-–—]+/).filter(Boolean);
  const numeral = words.length > 1 && /^(I{1,3}|IV|V|VI{0,3}|\d+)$/i.test(words[words.length - 1]) ? words.pop() : null;
  const initials = words.filter((word) => !MINOR_WORDS.has(word.toLowerCase())).map((word) => word[0].toUpperCase()).join('');
  if (!initials) return entry.title.slice(0, 6);
  return [initials.slice(0, 4), numeral?.toUpperCase()].filter(Boolean).join(' ');
}

export function formatScheduleTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value;
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${period}`;
}

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
      (item.code !== undefined && typeof item.code !== 'string') ||
      (item.section !== undefined && typeof item.section !== 'string') ||
      (item.kind !== undefined && !CLASS_KINDS.some((kind) => kind.key === item.kind)) ||
      !normalizeScheduleColor(item.color)) {
      throw new Error('Invalid schedule entry');
    }
    ids.add(item.id);
  }
  return value.map((item) => ({ ...item, color: normalizeScheduleColor(item.color) as ScheduleColor }));
}
