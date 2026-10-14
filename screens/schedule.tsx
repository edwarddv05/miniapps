// Horario: day and week views, class editor and the scan review.

import * as Haptics from 'expo-haptics';
import { BottomSheet, Button as NativeButton, ConfirmationDialog, ContentUnavailableView, DatePicker, Form, Group, HStack, List, Picker, Popover, ProgressView, Section, SecureField, ScrollView, Spacer, Text as NativeText, TextField, type TextFieldRef, VStack, ZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityAddTraits, accessibilityElement, accessibilityHint, accessibilityValue, blur, buttonStyle, clipShape, contentShape, controlSize, disabled, interactiveDismissDisabled, font, frame, autocorrectionDisabled, textInputAutocapitalization, lineLimit, listRowBackground, listRowSeparator, listStyle, minimumScaleFactor, monospacedDigit, multilineTextAlignment, onSubmit, offset, onLongPressGesture, onTapGesture, opacity, padding, pickerStyle, presentationDetents, presentationDragIndicator, scrollContentBackground, scrollDismissesKeyboard, shapes, submitLabel, tag, textFieldStyle, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { CLASS_KINDS, classesClash, classKindLabel, courseLabel, formatScheduleTime, sameCourse, shortCourseName, splitCourseCode, type ClassKind, type DayIndex, type ScheduleColor, type ScheduleEntry } from '../schedule-data';
import { useCurrentTime } from '../use-current-time';
import { UI } from '../ui-structure';
import { background, foregroundStyle, strokeBorder, tint } from '../native-colors';
import { scanIssueText, type ScannedClass } from '../schedule-scan';
import { AdaptiveRow, ColorSwatchesNative, DAYS, GlassControlGroup, NativeCircleButton, PageNative, SHEET_ACTION_INSET, type ScheduleView, SymbolImage, type ThemeTokens, colorForKey, currentDayIndex, dateToTime, durationLabel, findConflict, groupedListModifiers, hasNativeView, isValidTime, makeId, minutesFromTime, sortedEntries, textModifiers, timeRange, timeToDate, usePageWidth, withAlpha } from './shared';

export function AIScanReviewNative({
  scanned,
  existing,
  tokens,
  onImport,
  onClose,
}: {
  scanned: ScannedClass[];
  existing: ScheduleEntry[];
  tokens: ThemeTokens;
  onImport: (selected: ScheduleEntry[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [items, setItems] = useState(scanned);
  // Classes that overlap the stored schedule start unselected so an import
  // never silently creates a double-booked slot. Classes with a day or time
  // the scanner could not read cannot be selected until they are corrected.
  const conflicts = useMemo(() => new Map(items.map((item) => [item.entry.id, findConflict(item.entry, existing)])), [items, existing]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scanned.filter((item) => !item.issues.length && !findConflict(item.entry, existing)).map((item) => item.entry.id)));
  const [importing, setImporting] = useState(false);
  const [fixing, setFixing] = useState<ScannedClass | null>(null);
  const readable = items.filter((item) => !item.issues.length);
  const unread = items.filter((item) => item.issues.length);
  const days = DAYS.filter((day) => readable.some((item) => item.entry.day === day.index));

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (importing || !selected.size) return;
    setImporting(true);
    const ok = await onImport(readable.filter((item) => selected.has(item.entry.id)).map((item) => item.entry));
    if (!ok) setImporting(false);
  };

  const applyFix = (entry: ScheduleEntry) => {
    setItems((current) => current.map((item) => (item.entry.id === entry.id ? { ...item, entry, issues: [] } : item)));
    if (!findConflict(entry, existing)) setSelected((current) => new Set(current).add(entry.id));
    setFixing(null);
  };

  if (fixing) return <ScanFixNative item={fixing} tokens={tokens} onSave={applyFix} onClose={() => setFixing(null)} />;

  return (
    <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), interactiveDismissDisabled(importing)]}>
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
        <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
          <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} disabled={importing} />
          <Spacer />
          <VStack alignment="center" spacing={2}>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>Horario detectado</NativeText>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'caption', color: tokens.secondary }), monospacedDigit()]}>{`${selected.size} de ${items.length} seleccionadas`}</NativeText>
          </VStack>
          <Spacer />
          <NativeCircleButton tokens={tokens} accent label={`Importar ${selected.size} clases`} systemName="checkmark" onPress={() => void confirm()} disabled={!selected.size} busy={importing} />
        </HStack>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), disabled(importing)]}>
          {unread.length ? <Section title="Por corregir">
            {unread.map((item) => (
              <NativeButton key={item.entry.id} onPress={() => setFixing(item)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${item.entry.title}, ${scanIssueText(item)}`), accessibilityHint('Corregir')]}>
                <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 6 }), contentShape(shapes.rectangle())]}>
                  <SymbolImage name="exclamationmark.circle.fill" color={tokens.danger} size={22} />
                  <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                    <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{item.entry.title}</NativeText>
                    <NativeText modifiers={textModifiers(tokens, { style: 'footnote', color: tokens.danger, weight: 'medium' })}>{scanIssueText(item)}</NativeText>
                  </VStack>
                  <SymbolImage name="chevron.right" color={tokens.secondary} size={14} />
                </HStack>
              </NativeButton>
            ))}
          </Section> : null}
          {days.map((day) => (
            <Section key={day.index} title={day.long}>
              {sortedEntries(readable.filter((item) => item.entry.day === day.index).map((item) => item.entry)).map((entry) => {
                const isSelected = selected.has(entry.id);
                const conflict = conflicts.get(entry.id);
                return (
                  <NativeButton key={entry.id} onPress={() => toggle(entry.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${entry.title}, ${timeRange(entry)}${conflict ? `, se cruza con ${conflict.title}` : ''}`), accessibilityValue(isSelected ? 'Seleccionada' : 'No seleccionada')]}>
                    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 6 }), contentShape(shapes.rectangle())]}>
                      <SymbolImage name={isSelected ? 'checkmark.circle.fill' : 'circle'} color={isSelected ? tokens.blue : tokens.secondary} size={22} />
                      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                        <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{entry.title}</NativeText>
                        <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', color: tokens.secondary }), monospacedDigit()]}>{[courseLabel(entry), entry.kind, timeRange(entry), entry.location].filter(Boolean).join(' · ')}</NativeText>
                        {conflict ? <NativeText modifiers={textModifiers(tokens, { style: 'footnote', color: tokens.danger, weight: 'medium' })}>{`Se cruza con ${conflict.title}`}</NativeText> : null}
                      </VStack>
                    </HStack>
                  </NativeButton>
                );
              })}
            </Section>
          ))}
        </List>
      </VStack>
    </Group>
  );
}

// Sets the day and hours of a scanned class the scanner could not read.
function ScanFixNative({ item, tokens, onSave, onClose }: { item: ScannedClass; tokens: ThemeTokens; onSave: (entry: ScheduleEntry) => void; onClose: () => void }) {
  const [day, setDay] = useState<DayIndex>(item.entry.day);
  const [start, setStart] = useState(item.entry.start);
  const [end, setEnd] = useState(item.entry.end);
  const valid = minutesFromTime(end) > minutesFromTime(start);
  return (
    <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
        <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
          <NativeCircleButton tokens={tokens} label="Volver" systemName="chevron.left" onPress={onClose} />
          <Spacer />
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1), accessibilityAddTraits(['isHeader'])]}>{item.entry.title}</NativeText>
          <Spacer />
          <NativeCircleButton tokens={tokens} accent label="Guardar corrección" systemName="checkmark" onPress={() => onSave({ ...item.entry, day, start, end })} disabled={!valid} />
        </HStack>
        <Form modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          <Section title={scanIssueText(item)}>
            <Picker label="Día" selection={day} onSelectionChange={(value) => setDay(value as DayIndex)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
              {DAYS.map((option) => <NativeText key={option.index} modifiers={[tag(option.index)]}>{option.long}</NativeText>)}
            </Picker>
            <DatePicker title="Empieza" selection={timeToDate(start)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setStart(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
            <DatePicker title="Termina" selection={timeToDate(end)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setEnd(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
            {!valid ? <NativeText modifiers={textModifiers(tokens, { color: tokens.danger, style: 'footnote', weight: 'medium' })}>La hora de término debe ser posterior a la de inicio.</NativeText> : null}
          </Section>
        </Form>
      </VStack>
    </Group>
  );
}

export function APIKeySheetNative({
  tokens,
  onSaveKey,
  onClose,
}: {
  tokens: ThemeTokens;
  onSaveKey: (key: string) => void;
  onClose: () => void;
}) {
  const keyState = useNativeState('');
  const [draft, setDraft] = useState('');
  const save = () => {
    const value = draft.trim();
    if (value) onSaveKey(value);
  };

  return (
    <Group modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}>
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
        <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
          <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} />
          <Spacer />
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>API de Gemini</NativeText>
          <Spacer />
          <NativeCircleButton tokens={tokens} accent label="Guardar y escanear" systemName="checkmark" onPress={save} disabled={!draft.trim()} />
        </HStack>
        <Form modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          <Section title="Clave">
            <SecureField
              text={keyState}
              placeholder="AIzaSy…"
              autoFocus
              onTextChange={setDraft}
              modifiers={[font({ textStyle: 'body' }), textInputAutocapitalization('never'), autocorrectionDisabled(), accessibilityLabel('Clave de la API de Gemini'), submitLabel('done'), onSubmit(save)]}
            />
          </Section>
        </Form>
      </VStack>
    </Group>
  );
}

type AgendaState = 'past' | 'now' | undefined;

function ScheduleEntryRowNative({ entry, tokens, state, onPress }: { entry: ScheduleEntry; tokens: ThemeTokens; state?: AgendaState; onPress: () => void }) {
  const status = state === 'now' ? ', en curso' : state === 'past' ? ', terminada' : '';
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`Editar ${entry.title}, de ${formatScheduleTime(entry.start)} a ${formatScheduleTime(entry.end)}${entry.location ? `, ${entry.location}` : ''}${status}`)]}>
      <AgendaContentNative entry={entry} tokens={tokens} state={state} />
    </NativeButton>
  );
}

function AgendaContentNative({ entry, tokens, state }: { entry: ScheduleEntry; tokens: ThemeTokens; state?: AgendaState }) {
  const entryColor = colorForKey(entry.color, tokens.mode);
  const past = state === 'past';
  return <AdaptiveRow modifiers={[frame({ maxWidth: Infinity, minHeight: 64, alignment: 'leading' }), padding({ vertical: 10 }), contentShape(shapes.rectangle())]}>
        <VStack alignment="leading" spacing={3}>
          <NativeText modifiers={[...textModifiers(tokens, { color: state === 'now' ? tokens.blue : past ? tokens.secondary : tokens.text, style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{formatScheduleTime(entry.start)}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{formatScheduleTime(entry.end)}</NativeText>
        </VStack>
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack alignment="firstTextBaseline" spacing={7}>
            <SymbolImage name="circle.fill" color={past ? tokens.border : entryColor.main} size={8} />
            <NativeText modifiers={textModifiers(tokens, { color: past ? tokens.secondary : tokens.text, style: 'headline', weight: 'semibold' })}>{entry.title}</NativeText>
          </HStack>
          {entry.location || entry.code || state === 'now' ? <NativeText modifiers={textModifiers(tokens, { color: state === 'now' ? tokens.blue : tokens.secondary, style: 'subheadline', weight: state === 'now' ? 'medium' : 'regular' })}>{[state === 'now' ? 'En curso' : '', courseLabel(entry), entry.kind, entry.location].filter(Boolean).join(' · ')}</NativeText> : null}
        </VStack>
      </AdaptiveRow>;
}

// Loading, error and empty states sit on the page itself, not in a grouped card.
const CLEAR_ROW: ViewModifier[] = [listRowBackground('#00000000'), listRowSeparator('hidden')];

function StateRowNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode }) {
  return <VStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ vertical: 20 }), ...CLEAR_ROW]}>{children}</VStack>;
}

const supportsPopover = hasNativeView('PopoverView');

// When this class happens next, relative to now: in progress, later today,
// tomorrow, or a weekday with how many days away.
function nextOccurrence(entry: ScheduleEntry, now: Date) {
  const today = ((now.getDay() + 6) % 7) as DayIndex;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = minutesFromTime(entry.start);
  const end = minutesFromTime(entry.end);
  if (entry.day === today && start <= nowMinutes && nowMinutes < end) {
    return { live: true, text: `En curso · termina en ${durationLabel(end - nowMinutes)}` };
  }
  let daysAhead = (entry.day - today + 7) % 7;
  if (daysAhead === 0 && nowMinutes >= end) daysAhead = 7;
  if (daysAhead === 0) return { live: false, text: `Hoy, en ${durationLabel(start - nowMinutes)}` };
  if (daysAhead === 1) return { live: false, text: `Mañana, ${formatScheduleTime(entry.start)}` };
  return { live: false, text: `${DAYS[entry.day].long}, en ${daysAhead} días` };
}

// The card behind a tap on a week block. Beyond the block's own facts it
// answers what a single block cannot: when the class happens next, every
// session of the course this week with its room, the weekly hours, and any
// class it collides with.
function ClassCardNative({ entry, entries, tokens, now, width, onEdit }: { entry: ScheduleEntry; entries: ScheduleEntry[]; tokens: ThemeTokens; now: Date; width: number; onEdit: () => void }) {
  const color = colorForKey(entry.color, tokens.mode);
  const next = nextOccurrence(entry, now);
  const sessions = entries.filter((item) => sameCourse(item, entry)).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  const weeklyMinutes = sessions.reduce((sum, item) => sum + minutesFromTime(item.end) - minutesFromTime(item.start), 0);
  const conflicts = entries.filter((item) => classesClash(entry, item));
  const minutes = minutesFromTime(entry.end) - minutesFromTime(entry.start);
  const row = (symbol: SFSymbol, text: string) => <HStack alignment="firstTextBaseline" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SymbolImage name={symbol} color={tokens.secondary} size={17} />
    <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline' }), monospacedDigit()]}>{text}</NativeText>
  </HStack>;

  return <VStack alignment="leading" spacing={14} modifiers={[padding({ all: 18 }), frame({ width, alignment: 'leading' })]}>
    <HStack alignment="top" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      {entry.code || entry.kind ? <NativeText modifiers={textModifiers(tokens, { color: color.ink, style: 'subheadline', weight: 'bold' })}>{[courseLabel(entry), classKindLabel(entry.kind)].filter(Boolean).join(' · ')}</NativeText> : null}
      <NativeText modifiers={textModifiers(tokens, { style: 'title3', weight: 'bold' })}>{entry.title}</NativeText>
      <HStack alignment="center" spacing={6}>
        {next.live ? <VStack modifiers={[frame({ width: 8, height: 8 }), background(color.main), clipShape('circle')]}>{null}</VStack> : null}
        <NativeText modifiers={[...textModifiers(tokens, { color: next.live ? color.ink : tokens.secondary, style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{next.text}</NativeText>
      </HStack>
    </VStack>
    <NativeCircleButton tokens={tokens} label={`Editar ${entry.title}`} systemName="pencil" onPress={onEdit} />
    </HStack>

    <VStack alignment="leading" spacing={8}>
      {row('clock', `${DAYS[entry.day].long} · ${timeRange(entry)} · ${durationLabel(minutes)}`)}
      {entry.location ? row('mappin.and.ellipse', `Aula ${entry.location}`) : null}
    </VStack>

    {sessions.length > 1 ? <VStack alignment="leading" spacing={6}>
      <HStack alignment="firstTextBaseline" spacing={6}>
        <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote', weight: 'semibold' })}>Esta semana</NativeText>
        <Spacer />
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit()]}>{`${durationLabel(weeklyMinutes)} en total`}</NativeText>
      </HStack>
      {sessions.map((item) => <HStack key={item.id} alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 10, vertical: 7 }), background(withAlpha(color.main, item.id === entry.id ? (tokens.mode === 'dark' ? 0.32 : 0.2) : 0.08)), clipShape('roundedRectangle', 10)]}>
        <NativeText modifiers={[...textModifiers(tokens, { color: item.id === entry.id ? color.ink : tokens.text, style: 'footnote', weight: 'bold' }), frame({ width: 32, alignment: 'leading' })]}>{DAYS[item.day].short}</NativeText>
        {item.kind ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'bold' }), frame({ width: 30, alignment: 'leading' })]}>{item.kind}</NativeText> : null}
        <NativeText modifiers={[...textModifiers(tokens, { style: 'footnote' }), monospacedDigit(), lineLimit(1)]}>{timeRange(item)}</NativeText>
        <Spacer />
        {item.location ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), lineLimit(1)]}>{item.location}</NativeText> : null}
      </HStack>)}
    </VStack> : null}

    {conflicts.length ? <HStack alignment="firstTextBaseline" spacing={8}>
      <SymbolImage name="exclamationmark.triangle.fill" color={tokens.danger} size={16} />
      <NativeText modifiers={textModifiers(tokens, { color: tokens.danger, style: 'footnote', weight: 'semibold' })}>{`Se cruza con ${conflicts.map((item) => (item.code ? courseLabel(item) : item.title)).join(', ')}`}</NativeText>
    </HStack> : null}
  </VStack>;
}

const WEEK_HOUR_HEIGHT = 56;
const WEEK_COLUMN_GAP = 4;
const WEEK_BLOCK_GAP = 4;

// The week as a timetable: one column per day, each class a block filled
// with its own colour, placed and sized by its hours. Gaps and overlaps read
// at a glance, and the week's colours are the page's colour.
function WeekGridNative({ entries, tokens, onEdit }: { entries: ScheduleEntry[]; tokens: ThemeTokens; onEdit: (entry: ScheduleEntry) => void }) {
  const today = currentDayIndex();
  const now = useCurrentTime();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const days = DAYS.filter((day) => day.index < 5 || entries.some((entry) => entry.day === day.index));
  // Only the hours that hold classes, so each hour gets more height.
  const firstHour = Math.min(...entries.map((entry) => Math.floor(minutesFromTime(entry.start) / 60)));
  const lastHour = Math.max(...entries.map((entry) => Math.ceil(minutesFromTime(entry.end) / 60)));
  const hours = Array.from({ length: Math.max(1, lastHour - firstHour) }, (_, index) => firstHour + index);
  const height = hours.length * WEEK_HOUR_HEIGHT;
  const pageWidth = usePageWidth();
  const hourColumn = 34;
  const columnWidth = (pageWidth - hourColumn - WEEK_COLUMN_GAP * days.length) / days.length;
  // The class card fits the screen with a margin, never wider than a comfortable 320 pt.
  const cardWidth = Math.min(320, pageWidth - 8);
  const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;

  return <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <VStack alignment="leading" spacing={8} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 14, bottom: 16 })]}>
      <HStack alignment="center" spacing={WEEK_COLUMN_GAP}>
        <VStack modifiers={[frame({ width: hourColumn })]}>{null}</VStack>
        {days.map((day) => <NativeText key={day.index} modifiers={[...textModifiers(tokens, { color: day.index === today ? tokens.blue : tokens.secondary, style: 'footnote', weight: 'bold' }), frame({ width: columnWidth })]}>{day.short}</NativeText>)}
      </HStack>
      <HStack alignment="top" spacing={WEEK_COLUMN_GAP}>
        <VStack alignment="leading" spacing={0} modifiers={[frame({ width: hourColumn })]}>
          {hours.map((hour) => <NativeText key={hour} modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption2', weight: 'semibold' }), monospacedDigit(), frame({ width: hourColumn, height: WEEK_HOUR_HEIGHT, alignment: 'topLeading' })]}>{hourLabel(hour)}</NativeText>)}
        </VStack>
        {days.map((day) => (
          <ZStack key={day.index} alignment="topLeading" modifiers={[frame({ width: columnWidth, height, alignment: 'topLeading' }), background(withAlpha(tokens.mode === 'dark' ? '#FFFFFF' : '#16181D', day.index === today ? 0.06 : 0.03)), clipShape('roundedRectangle', 10)]}>
            {hours.slice(1).map((hour, index) => <VStack key={hour} modifiers={[frame({ width: columnWidth, height: 1 }), background(withAlpha(tokens.mode === 'dark' ? '#FFFFFF' : '#16181D', 0.07)), offset({ y: (index + 1) * WEEK_HOUR_HEIGHT })]}>{null}</VStack>)}
            {weekLanes(entries.filter((entry) => entry.day === day.index)).map(({ entry, lane, lanes }) => {
              const color = colorForKey(entry.color, tokens.mode);
              const top = ((minutesFromTime(entry.start) - firstHour * 60) / 60) * WEEK_HOUR_HEIGHT;
              const blockHeight = Math.max(30, ((minutesFromTime(entry.end) - minutesFromTime(entry.start)) / 60) * WEEK_HOUR_HEIGHT - WEEK_BLOCK_GAP);
              const laneWidth = columnWidth / lanes;
              const narrow = laneWidth < 44;
              const label = entry.code ? courseLabel(entry) : shortCourseName(entry);
              const place: ViewModifier[] = [frame({ width: laneWidth - WEEK_BLOCK_GAP, height: blockHeight }), offset({ x: lane * laneWidth + WEEK_BLOCK_GAP / 2, y: top + WEEK_BLOCK_GAP / 2 })];
              // Tap shows the class card; a long press goes straight to the editor.
              const block = <VStack alignment="leading" spacing={2} modifiers={[
                padding({ horizontal: narrow ? 3 : 6, vertical: 6 }),
                frame({ width: laneWidth - WEEK_BLOCK_GAP, height: blockHeight, alignment: 'topLeading' }),
                background(withAlpha(color.main, selectedId === entry.id ? (tokens.mode === 'dark' ? 0.45 : 0.34) : (tokens.mode === 'dark' ? 0.3 : 0.2))),
                clipShape('roundedRectangle', 9),
                strokeBorder({ content: withAlpha(color.main, tokens.mode === 'dark' ? 0.55 : 0.45), shape: 'roundedRectangle', cornerRadius: 9 }),
                contentShape(shapes.rectangle()),
                onTapGesture(() => setSelectedId(entry.id)),
                onLongPressGesture(() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setSelectedId(null);
                  onEdit(entry);
                }, 0.4),
                accessibilityElement('combine'),
                accessibilityAddTraits(['isButton']),
                accessibilityLabel(`${entry.title}${entry.code ? `, ${courseLabel(entry)}` : ''}, ${DAYS[entry.day].long}, de ${formatScheduleTime(entry.start)} a ${formatScheduleTime(entry.end)}${entry.location ? `, aula ${entry.location}` : ''}`),
                accessibilityHint('Mantén pulsado para editar'),
              ]}>
                {/* A block carries the course code (or the name's initials): it fits a
                    narrow column without breaking words. The full name is in the card. */}
                <NativeText modifiers={[foregroundStyle(color.ink), font({ size: 12, weight: 'bold', design: 'rounded' }), lineLimit(narrow ? 3 : 2), minimumScaleFactor(0.7)]}>{label}</NativeText>
                {(entry.location || entry.kind) && !narrow ? <NativeText modifiers={[foregroundStyle(color.ink), font({ size: 10, weight: 'medium' }), opacity(0.85), lineLimit(1), minimumScaleFactor(0.75)]}>{[entry.kind, entry.location].filter(Boolean).join(' · ')}</NativeText> : null}
                {blockHeight > 64 ? <NativeText modifiers={[foregroundStyle(color.ink), font({ size: 10, weight: 'medium' }), monospacedDigit(), opacity(0.75), lineLimit(1), minimumScaleFactor(0.75)]}>{formatScheduleTime(entry.start).replace(' ', '')}</NativeText> : null}
              </VStack>;
              if (!supportsPopover) return <VStack key={entry.id} modifiers={place}>{block}</VStack>;
              const below = top + blockHeight / 2 < height / 2;
              return <Popover key={entry.id} isPresented={selectedId === entry.id} onIsPresentedChange={(open) => { if (!open) setSelectedId((current) => (current === entry.id ? null : current)); }} attachmentAnchor={below ? 'bottom' : 'top'} arrowEdge={below ? 'top' : 'bottom'} modifiers={place}>
                <Popover.Trigger>{block}</Popover.Trigger>
                <Popover.Content>
                  <ClassCardNative entry={entry} entries={entries} tokens={tokens} now={now} width={cardWidth} onEdit={() => { setSelectedId(null); onEdit(entry); }} />
                </Popover.Content>
              </Popover>;
            })}
          </ZStack>
        ))}
      </HStack>
      {!supportsPopover ? <BottomSheet isPresented={Boolean(selected)} onIsPresentedChange={(open) => { if (!open) setSelectedId(null); }} onDismiss={() => setSelectedId(null)}>
        {selected ? <Group modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}>
          <ClassCardNative entry={selected} entries={entries} tokens={tokens} now={now} width={pageWidth} onEdit={() => { setSelectedId(null); onEdit(selected); }} />
        </Group> : null}
      </BottomSheet> : null}
    </VStack>
  </ScrollView>;
}

// Classes that overlap on the same day share the column side by side: each
// group of overlapping classes is split into lanes, first free lane first.
function weekLanes(dayEntries: ScheduleEntry[]) {
  const sorted = sortedEntries(dayEntries);
  const placed: Array<{ entry: ScheduleEntry; lane: number; lanes: number }> = [];
  let group: typeof placed = [];
  let groupEnd = -1;
  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    group.forEach((item) => { item.lanes = lanes; });
    placed.push(...group);
    group = [];
  };
  for (const entry of sorted) {
    const start = minutesFromTime(entry.start);
    if (group.length && start >= groupEnd) closeGroup();
    const busy = new Set(group.filter((item) => minutesFromTime(item.entry.end) > start).map((item) => item.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    group.push({ entry, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, minutesFromTime(entry.end));
  }
  if (group.length) closeGroup();
  return placed;
}

export function ScheduleNative({ entries, tokens, selectedDay, onCreate, onScanAI, isScanningAI, onEdit, onBack, loading, error, onRetry, view, setView, onClear }: { entries: ScheduleEntry[]; tokens: ThemeTokens; selectedDay: DayIndex; onCreate: () => void; onScanAI: () => void; isScanningAI: boolean; onEdit: (entry: ScheduleEntry) => void; onBack: () => void; loading: boolean; error: string | null; onRetry: () => void; view: ScheduleView; setView: (view: ScheduleView) => void; onClear: () => void }) {
  const now = useCurrentTime();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = selectedDay === currentDayIndex();
  const dayEntries = sortedEntries(entries.filter((entry) => entry.day === selectedDay));
  const ready = !loading && !error;
  const dayCount = new Set(entries.map((entry) => entry.day)).size;
  const heading = view === 'week' ? 'Semana' : DAYS[selectedDay].long;
  const detail = !ready ? null : view === 'week'
    ? entries.length ? `${entries.length === 1 ? '1 clase' : `${entries.length} clases`} en ${dayCount === 1 ? '1 día' : `${dayCount} días`}` : null
    : `${new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long' }).format(now)}${dayEntries.length ? ` · ${dayEntries.length === 1 ? '1 clase' : `${dayEntries.length} clases`}` : ''}`;
  const entryState = (entry: ScheduleEntry) => {
    if (view !== 'day' || !isToday) return undefined;
    if (minutesFromTime(entry.end) <= nowMinutes) return 'past' as const;
    if (minutesFromTime(entry.start) <= nowMinutes) return 'now' as const;
    return undefined;
  };

  return (
    <PageNative title="Horario" tokens={tokens} onBack={onBack} settings={ready && entries.length ? <Section>
      <NativeButton label="Borrar horario" systemImage="trash" role="destructive" onPress={onClear} />
    </Section> : undefined} action={
      <GlassControlGroup>
        <NativeCircleButton tokens={tokens} label="Escanear horario desde fotos" systemName="text.viewfinder" onPress={onScanAI} disabled={!ready} busy={isScanningAI} />
        <NativeCircleButton tokens={tokens} accent label="Añadir clase" systemName="plus" onPress={onCreate} disabled={!ready || isScanningAI} />
      </GlassControlGroup>
    }>
      <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 2, bottom: 4 })]}>
        <VStack alignment="leading" spacing={2}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{heading}</NativeText>
          {detail ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' }), monospacedDigit()]}>{detail}</NativeText> : null}
        </VStack>
        <Picker selection={view} onSelectionChange={(value) => setView(value as ScheduleView)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), accessibilityLabel('Vista del horario')]}>
          <NativeText modifiers={[tag('day')]}>Hoy</NativeText>
          <NativeText modifiers={[tag('week')]}>Semana</NativeText>
        </Picker>
      </VStack>
      {view === 'week' && ready && entries.length > 0 && !isScanningAI ? <WeekGridNative entries={entries} tokens={tokens} onEdit={onEdit} /> : <List modifiers={groupedListModifiers(tokens)}>
        {isScanningAI ? <Section>
          <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
            <ProgressView modifiers={[controlSize('small')]} />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'callout' })}>Analizando imágenes…</NativeText>
          </HStack>
        </Section> : null}
        {loading ? <Section>
          <StateRowNative tokens={tokens}>
            <ProgressView />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'callout' })}>Cargando horario…</NativeText>
          </StateRowNative>
        </Section> : error ? <Section>
          <StateRowNative tokens={tokens}>
            <SymbolImage name="exclamationmark.triangle" color={tokens.danger} size={26} />
            <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>No se pudo abrir el horario</NativeText>
            <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), multilineTextAlignment('center')]}>{error}</NativeText>
            <NativeButton label="Reintentar" onPress={onRetry} modifiers={[buttonStyle('bordered'), controlSize('regular'), tint(tokens.blue)]} />
          </StateRowNative>
        </Section> : (view === 'day' ? !dayEntries.length : !entries.length) ? <Section>
          <ContentUnavailableView title={entries.length ? 'Día libre' : 'Sin clases'} systemImage={entries.length ? 'sun.max' : 'calendar'} modifiers={[padding({ vertical: 32 }), ...CLEAR_ROW]} />
        </Section> : view === 'day' ? (
          <Section>
            {dayEntries.map((entry) => <ScheduleEntryRowNative key={entry.id} entry={entry} tokens={tokens} state={entryState(entry)} onPress={() => onEdit(entry)} />)}
          </Section>
        ) : null}
      </List>}
    </PageNative>
  );
}

export function ScheduleEditorNative({ entry, defaultDay, tokens, onSave, onDelete, onClose }: { entry: ScheduleEntry | null; defaultDay: DayIndex; tokens: ThemeTokens; onSave: (entry: ScheduleEntry) => Promise<string | null>; onDelete: (id: string) => void; onClose: () => void }) {
  const [initial] = useState(() => entry ?? { id: makeId(), title: '', day: defaultDay, start: '08:00', end: '09:00', location: '', color: 'blue' as ScheduleColor });
  const [title, setTitle] = useState(initial.title);
  const [code, setCode] = useState(initial.code ?? '');
  const [section, setSection] = useState(initial.section ?? '');
  const [kind, setKind] = useState<ClassKind | ''>(initial.kind ?? '');
  const [day, setDay] = useState<DayIndex>(initial.day);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [location, setLocation] = useState(initial.location);
  const [color, setColor] = useState<ScheduleColor>(initial.color);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savingRef = useRef(false);
  const dirty = title !== initial.title || code !== (initial.code ?? '') || section !== (initial.section ?? '') || kind !== (initial.kind ?? '') || day !== initial.day || start !== initial.start || end !== initial.end || location !== initial.location || color !== initial.color;
  const requestClose = () => {
    if (savingRef.current) return;
    if (!dirty) return onClose();
    Alert.alert('¿Descartar cambios?', 'Los cambios de esta clase no se han guardado.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar cambios', style: 'destructive', onPress: onClose },
    ]);
  };
  useEffect(() => {
    if (validationError) AccessibilityInfo.announceForAccessibility(validationError);
  }, [validationError]);
  const titleState = useNativeState(initial.title);
  const locationState = useNativeState(initial.location);
  const locationInput = useRef<TextFieldRef>(null);
  const titleInput = useRef<TextFieldRef>(null);
  const codeState = useNativeState(initial.code ?? '');
  const sectionState = useNativeState(initial.section ?? '');
  const codeInput = useRef<TextFieldRef>(null);
  const sectionInput = useRef<TextFieldRef>(null);
  // Typing the code and section together ("GE703U") fills both fields.
  const changeCode = (value: string) => {
    const split = splitCourseCode(value);
    const nextCode = split ? split.code : value.toUpperCase();
    setCode(nextCode);
    codeState.set(nextCode);
    if (split) {
      setSection(split.section);
      sectionState.set(split.section);
    }
  };

  const save = async () => {
    if (savingRef.current) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setValidationError('Escribe el nombre de la clase.');
      return;
    }
    if (!isValidTime(start) || !isValidTime(end)) {
      setValidationError('Usa un horario válido.');
      return;
    }
    if (minutesFromTime(end) <= minutesFromTime(start)) {
      setValidationError('La hora de término debe ser posterior a la de inicio.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const cleanCode = code.trim().toUpperCase();
    const cleanSection = section.trim().toUpperCase();
    const error = await onSave({ id: entry?.id ?? initial.id, title: cleanTitle, ...(cleanCode ? { code: cleanCode } : {}), ...(cleanSection ? { section: cleanSection } : {}), ...(kind ? { kind } : {}), day, start, end, location: location.trim(), color });
    savingRef.current = false;
    setSaving(false);
    if (error) setValidationError(error);
  };

  return (
    <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), interactiveDismissDisabled(dirty || saving)]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(tokens.background)]}>
      <HStack spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
        <NativeCircleButton tokens={tokens} label="Cancelar" systemName="xmark" onPress={requestClose} disabled={saving} />
        <Spacer />
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader']), onTapGesture(() => { void titleInput.current?.blur(); void codeInput.current?.blur(); void sectionInput.current?.blur(); void locationInput.current?.blur(); })]}>{entry ? 'Editar clase' : 'Nueva clase'}</NativeText>
        <Spacer />
        <NativeCircleButton tokens={tokens} accent label={saving ? 'Guardando' : 'Guardar'} systemName="checkmark" onPress={() => void save()} disabled={saving} />
      </HStack>
      {validationError ? (
        <NativeText modifiers={[
          ...textModifiers(tokens, { color: tokens.danger, style: 'callout', weight: 'semibold' }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          padding({ horizontal: SHEET_ACTION_INSET, bottom: 12 }),
        ]}>{validationError}</NativeText>
      ) : null}
    <Form modifiers={[scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), listStyle('insetGrouped'), scrollDismissesKeyboard('immediately'), disabled(saving)]}>
      <Section title="Clase">
        <VStack alignment="leading" spacing={6}>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Nombre</NativeText>
          <TextField ref={titleInput} text={titleState} onTextChange={(value) => { setTitle(value); titleState.set(value); }} placeholder="Nombre de la clase" modifiers={[font({ textStyle: 'title2', weight: 'semibold' }), padding({ vertical: 8 }), textFieldStyle('plain'), accessibilityLabel('Nombre de la clase'), submitLabel('next'), onSubmit(() => { void codeInput.current?.focus(); })]} />
        </VStack>
        <HStack alignment="top" spacing={16} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Código</NativeText>
            <TextField ref={codeInput} text={codeState} onTextChange={changeCode} placeholder="GE703" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), textInputAutocapitalization('characters'), autocorrectionDisabled(), accessibilityLabel('Código del curso, opcional'), submitLabel('next'), onSubmit(() => { void sectionInput.current?.focus(); })]} />
          </VStack>
          <VStack alignment="leading" spacing={6} modifiers={[frame({ width: 88, alignment: 'leading' })]}>
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Sección</NativeText>
            <TextField ref={sectionInput} text={sectionState} onTextChange={(value) => { const next = value.toUpperCase(); setSection(next); sectionState.set(next); }} placeholder="U" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), textInputAutocapitalization('characters'), autocorrectionDisabled(), accessibilityLabel('Sección, opcional'), submitLabel('next'), onSubmit(() => { void locationInput.current?.focus(); })]} />
          </VStack>
        </HStack>
      </Section>
      <Section title="Horario">
        <Picker label="Día" selection={day} onSelectionChange={(value) => setDay(value as DayIndex)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
          {DAYS.map((item) => <NativeText key={item.index} modifiers={[tag(item.index)]}>{item.long}</NativeText>)}
        </Picker>
        <Picker label="Tipo" selection={kind} onSelectionChange={(value) => setKind(value as ClassKind | '')} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
          <NativeText modifiers={[tag('')]}>Sin tipo</NativeText>
          {CLASS_KINDS.map((item) => <NativeText key={item.key} modifiers={[tag(item.key)]}>{`${item.label} (${item.key})`}</NativeText>)}
        </Picker>
        <DatePicker title="Empieza" selection={timeToDate(start)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setStart(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
        <DatePicker title="Termina" selection={timeToDate(end)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setEnd(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
        {minutesFromTime(end) > minutesFromTime(start) ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{`Cada ${DAYS[day].long.toLowerCase()} · ${minutesFromTime(end) - minutesFromTime(start)} min`}</NativeText> : null}
      </Section>
      <Section title="Detalles">
        <VStack alignment="leading" spacing={6}>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Aula</NativeText>
          <TextField ref={locationInput} text={locationState} onTextChange={(value) => { setLocation(value); locationState.set(value); }} placeholder="S4-216" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), textInputAutocapitalization('characters'), accessibilityLabel('Aula, opcional'), submitLabel('done'), onSubmit(() => { void locationInput.current?.blur(); })]} />
        </VStack>
        <ColorSwatchesNative selection={color} tokens={tokens} onChange={setColor} />
      </Section>

      {entry ? (
        <Section>
          <ConfirmationDialog title="Eliminar clase" isPresented={confirmDelete} onIsPresentedChange={setConfirmDelete}>
            <ConfirmationDialog.Trigger>
              <NativeButton label="Eliminar clase" systemImage="trash" role="destructive" onPress={() => setConfirmDelete(true)} modifiers={[buttonStyle('borderless'), tint(tokens.danger)]} />
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Message><NativeText>¿Quieres eliminar “{entry.title}” de tu horario?</NativeText></ConfirmationDialog.Message>
            <ConfirmationDialog.Actions>
              <NativeButton label="Eliminar" role="destructive" onPress={() => { setConfirmDelete(false); onDelete(entry.id); }} />
              <NativeButton label="Cancelar" role="cancel" onPress={() => setConfirmDelete(false)} />
            </ConfirmationDialog.Actions>
          </ConfirmationDialog>
        </Section>
      ) : null}
    </Form>
    </VStack>
    </Group>
  );
}
