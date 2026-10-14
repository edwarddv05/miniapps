import { normalizeClassKind, SCHEDULE_COLORS, splitCourseCode, type DayIndex, type ScheduleColor, type ScheduleEntry } from './schedule-data';

// Turns what the scanner read into classes. A day or time it could not read
// is never guessed: the class keeps placeholder values and lists the issue,
// so the review asks for a correction before importing it.

export type ScanIssue = 'day' | 'start' | 'end' | 'order';

export type ScannedClass = {
  entry: ScheduleEntry;
  issues: ScanIssue[];
  /** What the scanner returned for each field, shown next to the issue. */
  read: { day: string; start: string; end: string };
};

const DAY_NAMES: Array<[RegExp, DayIndex]> = [
  [/^lu(n(es)?)?\.?$/, 0],
  [/^ma(r(tes)?)?\.?$/, 1],
  [/^mi([eé](rcoles)?)?\.?$/, 2],
  [/^ju(e(ves)?)?\.?$/, 3],
  [/^vi(e(rnes)?)?\.?$/, 4],
  [/^s[aá](b(ado)?)?\.?$/, 5],
  [/^do(m(ingo)?)?\.?$/, 6],
];

/** A weekday from the scanner: 0–6 (Monday first) or a Spanish day name. */
export function parseScanDay(value: unknown): DayIndex | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 6 ? (value as DayIndex) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (/^[0-6]$/.test(text)) return Number(text) as DayIndex;
  return DAY_NAMES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** "8:00", "08:00", "08:00:00", "4:30 pm", "16.30" → "HH:MM"; anything else → null. */
export function parseScanTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().toLowerCase().match(/^(\d{1,2})[:.h](\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.startsWith('p') ? 'pm' : match[3] ? 'am' : null;
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const shown = (value: unknown) => (value == null ? '' : String(value).trim());

export function parseScannedClasses(items: unknown[], makeId: (index: number) => string): ScannedClass[] {
  // One colour per course, so repeated sessions of a subject match and
  // different subjects stay apart.
  const courseColors = new Map<string, ScheduleColor>();
  const colorFor = (title: string) => {
    const key = title.toLocaleLowerCase('es');
    if (!courseColors.has(key)) courseColors.set(key, SCHEDULE_COLORS[courseColors.size % SCHEDULE_COLORS.length]);
    return courseColors.get(key) as ScheduleColor;
  };
  const results: ScannedClass[] = [];
  items.forEach((value, index) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const title = shown(item.title);
    if (!title) return;
    const day = parseScanDay(item.day);
    const start = parseScanTime(item.start);
    const end = parseScanTime(item.end);
    const issues: ScanIssue[] = [];
    if (day === null) issues.push('day');
    if (!start) issues.push('start');
    if (!end) issues.push('end');
    if (start && end && end <= start) issues.push('order');
    // Code and section may arrive together ("GE703U") or apart.
    const rawCode = shown(item.code).toUpperCase();
    const split = splitCourseCode(rawCode);
    const code = split ? split.code : rawCode;
    const section = split ? split.section : shown(item.section).toUpperCase();
    const kind = normalizeClassKind(item.kind ?? item.type);
    const location = shown(item.location);
    results.push({
      entry: {
        id: makeId(index),
        title,
        ...(code ? { code } : {}),
        ...(section ? { section } : {}),
        ...(kind ? { kind } : {}),
        // Placeholders for the correction form only; a class with issues is
        // not imported until they are fixed.
        day: day ?? 0,
        start: start ?? '08:00',
        end: end && (!start || end > start) ? end : start && start < '23:00' ? `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:${start.slice(3)}` : '09:00',
        location,
        color: colorFor(title),
      },
      issues,
      read: { day: shown(item.day), start: shown(item.start), end: shown(item.end) },
    });
  });
  return results;
}

export function scanIssueText(item: ScannedClass) {
  return item.issues.map((issue) => {
    if (issue === 'day') return item.read.day ? `Día no reconocido: «${item.read.day}»` : 'Falta el día';
    if (issue === 'start') return item.read.start ? `Inicio no reconocido: «${item.read.start}»` : 'Falta la hora de inicio';
    if (issue === 'end') return item.read.end ? `Término no reconocido: «${item.read.end}»` : 'Falta la hora de término';
    return 'Termina antes de empezar';
  }).join(' · ');
}

/** Pulls the JSON array out of a model reply that may wrap it in text or fences. */
export function extractJsonArray(text: string): unknown[] {
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('La respuesta no tiene el formato de lista esperado.');
  return parsed;
}
