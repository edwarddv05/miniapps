// Saved downloads: the shelf on the Downloader, the Descargas page with its
// storage bar as filter, and the undo bar shown after a deletion.

import { Button as NativeButton, ContextMenu, HStack, Image as NativeImage, RNHostView, ScrollView, Spacer, Text as NativeText, VStack, ZStack } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, accessibilityElement, accessibilityHidden, accessibilityLabel, animation, Animation, background, buttonStyle, clipShape, contentShape, contentTransition, font, foregroundStyle, frame, glassEffect, lineLimit, monospacedDigit, onTapGesture, opacity, padding, scrollClipDisabled, shapes } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useEffect, useState } from 'react';
import { Image as RNImage } from 'react-native';
import { UI } from '../ui-structure';
import { formatBytes, formatDuration, type DownloadHistoryItem } from '../downloader-api';
import { PageNative, SymbolImage, type ThemeTokens, nativeGlassAvailable, textModifiers, usePageWidth } from './shared';

export type SavedKind = 'video' | 'audio' | 'image';

export const KINDS: Record<SavedKind, { label: string; one: string; many: string; color: string; symbol: SFSymbol }> = {
  video: { label: 'Videos', one: 'video', many: 'videos', color: '#8C80FF', symbol: 'play.fill' },
  audio: { label: 'Audio', one: 'audio', many: 'audios', color: '#3DB5A5', symbol: 'music.note' },
  image: { label: 'Fotos', one: 'foto', many: 'fotos', color: '#E9A53A', symbol: 'photo' },
};
const KIND_ORDER: SavedKind[] = ['video', 'audio', 'image'];

export function kindOf(entry: DownloadHistoryItem): SavedKind {
  return entry.mode === 'audio' ? 'audio' : entry.mode === 'video' ? 'video' : 'image';
}

const bytesOf = (entries: DownloadHistoryItem[]) => entries.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0);

function dayLabel(time: number, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (time >= today) return 'Hoy';
  if (time >= today - day) return 'Ayer';
  if (time >= today - 6 * day) return 'Esta semana';
  const date = new Date(time);
  const month = new Intl.DateTimeFormat('es-PE', { month: 'long', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) }).format(date);
  return month.charAt(0).toUpperCase() + month.slice(1);
}

// The saved file's picture with its length (or kind) in the corner.
function SavedPictureNative({ entry, size, tokens }: { entry: DownloadHistoryItem; size: number; tokens: ThemeTokens }) {
  const kind = kindOf(entry);
  const length = formatDuration(entry.durationSeconds);
  const tag = kind === 'image' ? 'Foto' : length;
  return <ZStack alignment="bottomLeading" modifiers={[frame({ width: size, height: size }), clipShape('roundedRectangle', 14), accessibilityHidden()]}>
    {entry.thumbnail
      ? <VStack modifiers={[frame({ width: size, height: size })]}>
        <RNHostView>
          <RNImage source={{ uri: entry.thumbnail }} style={{ flex: 1, backgroundColor: tokens.mode === 'dark' ? '#2A2938' : '#E4E6EC' }} resizeMode="cover" />
        </RNHostView>
      </VStack>
      : <ZStack alignment="center" modifiers={[frame({ width: size, height: size }), background(tokens.slateSoft)]}>
        <NativeImage systemName={KINDS[kind].symbol} modifiers={[font({ size: size * 0.24 }), foregroundStyle(tokens.slate)]} />
      </ZStack>}
    {tag ? <HStack alignment="center" spacing={4} modifiers={[padding({ horizontal: 6, vertical: 3 }), background('#0000008C'), clipShape('roundedRectangle', 6), padding({ all: 7 })]}>
      {kind === 'image' ? null : <NativeImage systemName={KINDS[kind].symbol} modifiers={[font({ size: 8, weight: 'bold' }), foregroundStyle('#FFFFFF')]} />}
      <NativeText modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#FFFFFF'), monospacedDigit()]}>{tag}</NativeText>
    </HStack> : null}
  </ZStack>;
}

/** A saved download: tap shares it, the context menu deletes it. */
export function SavedTileNative({ entry, width, tokens, onOpen, onDelete }: { entry: DownloadHistoryItem; width: number; tokens: ThemeTokens; onOpen: (entry: DownloadHistoryItem) => void; onDelete: (entry: DownloadHistoryItem) => void }) {
  const size = entry.sizeBytes ? formatBytes(entry.sizeBytes) : null;
  return <ContextMenu>
    <ContextMenu.Trigger>
      <NativeButton onPress={() => onOpen(entry)} modifiers={[buttonStyle('plain'), accessibilityLabel([entry.title, size].filter(Boolean).join(', '))]}>
        <VStack alignment="leading" spacing={4} modifiers={[frame({ width, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
          <SavedPictureNative entry={entry} size={width} tokens={tokens} />
          <NativeText modifiers={[...textModifiers(tokens, { style: 'footnote', weight: 'medium' }), lineLimit(1)]}>{entry.title}</NativeText>
          {size ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption' }), monospacedDigit()]}>{size}</NativeText> : null}
        </VStack>
      </NativeButton>
    </ContextMenu.Trigger>
    <ContextMenu.Items>
      <NativeButton label="Compartir" systemImage="square.and.arrow.up" onPress={() => onOpen(entry)} />
      <NativeButton label="Eliminar del iPhone" systemImage="trash" role="destructive" onPress={() => onDelete(entry)} />
    </ContextMenu.Items>
  </ContextMenu>;
}

/** The Downloader's latest downloads as a scrolling row of pictures. */
export function SavedShelfNative({ history, tokens, onOpen, onDelete, onShowAll }: { history: DownloadHistoryItem[]; tokens: ThemeTokens; onOpen: (entry: DownloadHistoryItem) => void; onDelete: (entry: DownloadHistoryItem) => void; onShowAll: () => void }) {
  const pageWidth = usePageWidth();
  return <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 4 })]}>
      <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>Últimas descargas</NativeText>
      <Spacer />
      <NativeButton onPress={onShowAll} modifiers={[buttonStyle('plain')]}>
        <NativeText modifiers={textModifiers(tokens, { color: tokens.blue, style: 'subheadline', weight: 'semibold' })}>Ver todo</NativeText>
      </NativeButton>
    </HStack>
    <ScrollView axes="horizontal" showsIndicators={false} modifiers={[frame({ width: pageWidth }), scrollClipDisabled()]}>
      <HStack alignment="top" spacing={12}>
        {history.slice(0, 8).map((entry) => <SavedTileNative key={entry.id} entry={entry} width={128} tokens={tokens} onOpen={onOpen} onDelete={onDelete} />)}
      </HStack>
    </ScrollView>
  </VStack>;
}

/** The bar that offers to bring back what was just deleted. */
export function UndoBarNative({ title, tokens, onUndo }: { title: string; tokens: ThemeTokens; onUndo: () => void }) {
  const surface = nativeGlassAvailable
    ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })]
    : [background(tokens.surfaceRaised), clipShape('capsule')];
  return <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 52 }), padding({ leading: 20, trailing: 6 }), ...surface]}>
    <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline' }), lineLimit(1), frame({ maxWidth: Infinity, alignment: 'leading' })]}>{`«${title}» eliminado`}</NativeText>
    <NativeButton onPress={onUndo} modifiers={[buttonStyle('plain'), padding({ horizontal: 12, vertical: 10 }), contentShape(shapes.rectangle())]}>
      <NativeText modifiers={textModifiers(tokens, { color: tokens.blue, style: 'subheadline', weight: 'semibold' })}>Deshacer</NativeText>
    </NativeButton>
  </HStack>;
}

// The space used, as a bar split by kind. The bar and its legend are the
// filter: tapping a kind shows only that kind; tapping it again shows all.
function StorageFilterNative({ history, filter, tokens, onFilter }: { history: DownloadHistoryItem[]; filter: SavedKind | null; tokens: ThemeTokens; onFilter: (kind: SavedKind | null) => void }) {
  const pageWidth = usePageWidth();
  const kinds = KIND_ORDER.filter((kind) => history.some((entry) => kindOf(entry) === kind));
  const shown = filter ? history.filter((entry) => kindOf(entry) === filter) : history;
  const total = bytesOf(history);
  const shownBytes = bytesOf(shown);
  const count = shown.length;
  const countLabel = filter
    ? `${count} ${count === 1 ? KINDS[filter].one : KINDS[filter].many}`
    : `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
  const toggle = (kind: SavedKind) => onFilter(filter === kind ? null : kind);
  const gaps = Math.max(0, kinds.length - 1) * 3;
  return <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 4 })]}>
      <NativeText modifiers={[font({ size: 30, weight: 'bold', design: 'rounded' }), foregroundStyle(tokens.text), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.45 }), shownBytes)]}>{formatBytes(shownBytes)}</NativeText>
      <Spacer />
      <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{countLabel}</NativeText>
    </HStack>
    {total > 0 ? <HStack alignment="center" spacing={3} modifiers={[frame({ width: pageWidth, height: 10, alignment: 'leading' }), animation(Animation.spring({ duration: 0.5 }), total)]}>
      {kinds.map((kind) => {
        const bytes = bytesOf(history.filter((entry) => kindOf(entry) === kind));
        return <VStack key={kind} modifiers={[frame({ width: Math.max(8, (pageWidth - gaps) * bytes / total), height: 10 }), background(KINDS[kind].color), clipShape('capsule'), opacity(filter && filter !== kind ? 0.25 : 1), animation(Animation.easeOut({ duration: 0.2 }), filter === kind), contentShape(shapes.rectangle()), onTapGesture(() => toggle(kind)), accessibilityHidden()]}>{null}</VStack>;
      })}
    </HStack> : null}
    <HStack alignment="center" spacing={16} modifiers={[padding({ horizontal: 4 })]}>
      {kinds.map((kind) => {
        const bytes = bytesOf(history.filter((entry) => kindOf(entry) === kind));
        const selected = filter === kind;
        return <NativeButton key={kind} onPress={() => toggle(kind)} modifiers={[buttonStyle('plain'), opacity(filter && !selected ? 0.45 : 1), accessibilityLabel(`${KINDS[kind].label}${bytes ? `, ${formatBytes(bytes)}` : ''}`), ...(selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
          <HStack alignment="center" spacing={6} modifiers={[padding({ vertical: 6 }), contentShape(shapes.rectangle())]}>
            <VStack modifiers={[frame({ width: 9, height: 9 }), background(KINDS[kind].color), clipShape('circle')]}>{null}</VStack>
            <NativeText modifiers={textModifiers(tokens, { style: 'subheadline', weight: selected ? 'semibold' : 'regular' })}>{KINDS[kind].label}</NativeText>
            {bytes ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{formatBytes(bytes)}</NativeText> : null}
          </HStack>
        </NativeButton>;
      })}
    </HStack>
  </VStack>;
}

/** Everything saved, by day, in a two-column grid. */
export function DownloadsPageNative({ history, tokens, onBack, onOpen, onDelete, overlay }: { history: DownloadHistoryItem[]; tokens: ThemeTokens; onBack: () => void; onOpen: (entry: DownloadHistoryItem) => void; onDelete: (entry: DownloadHistoryItem) => void; overlay?: ReactNode }) {
  const pageWidth = usePageWidth();
  const [filter, setFilter] = useState<SavedKind | null>(null);
  // Deleting the last file of the chosen kind shows everything again.
  useEffect(() => {
    if (filter && !history.some((entry) => kindOf(entry) === filter)) setFilter(null);
  }, [history, filter]);
  const shown = filter ? history.filter((entry) => kindOf(entry) === filter) : history;
  const tileWidth = Math.floor((pageWidth - 12) / 2);
  const groups: Array<{ day: string; entries: DownloadHistoryItem[] }> = [];
  for (const entry of shown) {
    const day = dayLabel(entry.createdAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  const layoutKey = shown.reduce((sum, entry) => sum + (entry.createdAt % 100_000), shown.length);

  return <PageNative title="Descargas" tokens={tokens} onBack={onBack} backLabel="Volver al Downloader">
    <ZStack alignment="bottom" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <VStack alignment="leading" spacing={22} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 96 }), animation(Animation.spring({ duration: 0.45 }), layoutKey)]}>
          {history.length ? <StorageFilterNative history={history} filter={filter} tokens={tokens} onFilter={setFilter} /> : null}
          {history.length ? groups.map((group) => <VStack key={group.day} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' }), padding({ horizontal: 4 }), accessibilityAddTraits(['isHeader'])]}>{group.day}</NativeText>
            {Array.from({ length: Math.ceil(group.entries.length / 2) }, (_, row) => group.entries.slice(row * 2, row * 2 + 2)).map((pair) => <HStack key={pair[0].id} alignment="top" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              {pair.map((entry) => <SavedTileNative key={entry.id} entry={entry} width={tileWidth} tokens={tokens} onOpen={onOpen} onDelete={onDelete} />)}
            </HStack>)}
          </VStack>) : <VStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 320 }), accessibilityElement('combine')]}>
            <SymbolImage name="tray" color={tokens.muted} size={34} />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'headline', weight: 'semibold' })}>Sin descargas</NativeText>
          </VStack>}
        </VStack>
      </ScrollView>
      {overlay ?? null}
    </ZStack>
  </PageNative>;
}

/** The number on the Descargas button. */
export function SavedCountBadgeNative({ count, tokens }: { count: number; tokens: ThemeTokens }) {
  return <NativeText modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(tokens.inverseText), monospacedDigit(), padding({ horizontal: 5, vertical: 1 }), frame({ minWidth: 18 }), background(tokens.blue), clipShape('capsule'), accessibilityHidden()]}>{String(count)}</NativeText>;
}
