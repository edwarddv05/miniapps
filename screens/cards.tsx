// Tarjetas: cards, statements, purchases and Hoy's card section.

import * as Haptics from 'expo-haptics';
import { BottomSheet, Button as NativeButton, ConfirmationDialog, ContentUnavailableView, DatePicker, Form, Group, HStack, Image as NativeImage, Picker, ProgressView, RNHostView, Section, Spacer, Stepper, Text as NativeText, TextField, type TextFieldRef, Toggle, VStack, ZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityAddTraits, accessibilityElement, accessibilityHidden, accessibilityHint, accessibilityValue, animation, Animation, blur, buttonStyle, clipShape, contentShape, contentTransition, controlSize, disabled, interactiveDismissDisabled, font, fixedSize, frame, italic, rotationEffect, textCase, keyboardType, lineLimit, listRowBackground, listRowInsets, listStyle, minimumScaleFactor, monospacedDigit, multilineTextAlignment, onSubmit, offset, rotation3DEffect, onTapGesture, opacity, padding, pickerStyle, presentationDetents, presentationDragIndicator, scrollContentBackground, scaleEffect, scrollDismissesKeyboard, shadow, shapes, submitLabel, tag, textFieldStyle, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated as RNAnimated, Easing as RNEasing, Image as RNImage, StyleSheet, useWindowDimensions, View, type ColorValue } from 'react-native';
import { useCurrentTime } from '../use-current-time';
import { UI } from '../ui-structure';
import { LinearGradient } from 'expo-linear-gradient';
import { background, foregroundStyle, strokeBorder, tint } from '../native-colors';
import { zIndex } from '@expo/ui/swift-ui/modifiers';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle as SvgCircle, G as SvgG } from 'react-native-svg';
import { bestCardsFor, cashbackFor, cashbackRate, categoryLabel, CATEGORIES, type CategorySpend, chargesFor, CURRENCY_SYMBOLS, closingFor, creditUse, cycleFor, cycleSummary, effectiveRate, dayLabel, daysBetween, formatAmounts, formatMoney, formatRate, parseRate, installmentCents, NO_AMOUNTS, isoToDate, lastStatement, parseMoney, shiftClose, statementFor, todayISO, unpaidStatements, type Amounts, type CardNetwork, type Currency, type CashbackRule, type Charge, type CreditCard, type Cycle, type ISODate, type Payment, type Purchase, type RateSettings, type SpendCategory, type Statement } from '../cards-data';
import { deleteCardImage, fetchMarketRate, keepCardImage, refreshMarketRateIfStale, loadCards, makeCardsId, updateCards, useCards, type CardsData } from '../cards-store';
import { DAYS, type FilterChip, FilterChipsNative, GlassControlGroup, NativeCircleButton, PageNative, ReadingCanvasNative, SHEET_ACTION_INSET, SectionHeadingNative, SymbolImage, type ThemeTokens, capitalize, mixHex, surfaceModifiers, textModifiers, usePageWidth, withAlpha } from './shared';

// ─── Tarjetas ────────────────────────────────────────────────────────────────

// Card faces are drawn, not copied from the issuer: a gradient in the card's
// colour with a chip, or a photo of the card's own art (a Wallet screenshot).
// iOS does not let other apps read the cards in Wallet.
type CardDesign = { key: string; label: string; colors: [string, string, string]; ink: string; accent: string };

const CARD_DESIGNS: CardDesign[] = [
  { key: 'graphite', label: 'Grafito', colors: ['#45454B', '#232327', '#0B0B0D'], ink: '#FFFFFF', accent: '#8E8E93' },
  { key: 'silver', label: 'Plata', colors: ['#F4F5F7', '#CDD1D7', '#9EA4AD'], ink: '#1C1C1E', accent: '#8A9099' },
  { key: 'gold', label: 'Oro', colors: ['#F6DE95', '#D6AC48', '#9C7424'], ink: '#2B1D00', accent: '#C9962E' },
  { key: 'platinum', label: 'Platino', colors: ['#ECEAE4', '#C9C5BC', '#8F8B82'], ink: '#1F1D19', accent: '#A39E93' },
  { key: 'emerald', label: 'Esmeralda', colors: ['#1FC077', '#0A8A4E', '#04502C'], ink: '#FFFFFF', accent: '#12A160' },
  { key: 'ocean', label: 'Océano', colors: ['#3B8BFF', '#0A54C9', '#062F7A'], ink: '#FFFFFF', accent: '#1F6FE8' },
  { key: 'navy', label: 'Marino', colors: ['#2463AA', '#0E3466', '#061A38'], ink: '#FFFFFF', accent: '#2A6CB8' },
  { key: 'crimson', label: 'Carmesí', colors: ['#F03A52', '#B3112A', '#6E0516'], ink: '#FFFFFF', accent: '#D91F3A' },
  { key: 'sunset', label: 'Naranja', colors: ['#FFA24A', '#F26419', '#B83A06'], ink: '#FFFFFF', accent: '#F26B1D' },
  { key: 'violet', label: 'Violeta', colors: ['#AE78E6', '#6E33B5', '#3B1470'], ink: '#FFFFFF', accent: '#8A4FD0' },
  { key: 'teal', label: 'Turquesa', colors: ['#3ADBC6', '#0E9488', '#075E57'], ink: '#FFFFFF', accent: '#14A396' },
  { key: 'rose', label: 'Rosa', colors: ['#FD7E9A', '#E03E6B', '#9D1846'], ink: '#FFFFFF', accent: '#E8487A' },
];

const CATEGORY_STYLES: Record<SpendCategory, { symbol: SFSymbol; color: string }> = {
  supermarket: { symbol: 'cart.fill', color: '#34C759' },
  restaurants: { symbol: 'fork.knife', color: '#FF9500' },
  delivery: { symbol: 'takeoutbag.and.cup.and.straw.fill', color: '#FF6B3D' },
  transport: { symbol: 'car.fill', color: '#007AFF' },
  fuel: { symbol: 'fuelpump.fill', color: '#5856D6' },
  shopping: { symbol: 'bag.fill', color: '#AF52DE' },
  entertainment: { symbol: 'popcorn.fill', color: '#FF2D55' },
  subscriptions: { symbol: 'play.rectangle.fill', color: '#E0245E' },
  travel: { symbol: 'airplane', color: '#30B0C7' },
  health: { symbol: 'cross.case.fill', color: '#FF3B30' },
  education: { symbol: 'book.fill', color: '#A2845E' },
  services: { symbol: 'bolt.fill', color: '#E6A700' },
  other: { symbol: 'ellipsis.circle.fill', color: '#8E8E93' },
};

const CARD_NETWORKS: Array<{ key: CardNetwork; label: string }> = [
  { key: 'visa', label: 'Visa' },
  { key: 'mastercard', label: 'Mastercard' },
  { key: 'amex', label: 'Amex' },
  { key: 'diners', label: 'Diners' },
];

export const CARDS_ICON = { light: '#0F766E', dark: '#5EEAD4' };
const WARNING = { light: '#C2410C', dark: '#FDBA74' };
const PAID = { light: '#15803D', dark: '#4ADE80' };
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const CARD_RATIO = 1.586;
// How much of each card shows above the next one in the stack: its name and the cycle's spending.
const STACK_PEEK = 62;
const STACK_DEPTH = 16;
// One spring for everything the stack moves, so cards travel together.
const STACK_SPRING = Animation.spring({ response: 0.5, dampingFraction: 0.82 });
// A function, not a constant: Expo UI's delay() changes the animation it is called on.
const revealSpring = () => Animation.spring({ response: 0.55, dampingFraction: 0.86 });

function cardDesign(key: string) {
  return CARD_DESIGNS.find((design) => design.key === key) ?? CARD_DESIGNS[0];
}

// Readable text in the card's colour on the page ground.
function cardInk(card: CreditCard, tokens: ThemeTokens) {
  const accent = cardDesign(card.design).accent;
  return tokens.mode === 'dark' ? mixHex(accent, '#FFFFFF', 0.35) : mixHex(accent, '#000000', 0.3);
}

function dayMonth(iso: ISODate, weekday = false) {
  const date = isoToDate(iso);
  const day = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return weekday ? `${DAYS[(date.getDay() + 6) % 7].short} ${day}` : day;
}

function cycleRange(cycle: Cycle) {
  return `${dayMonth(cycle.start)} – ${dayMonth(cycle.close)}`;
}

function percentLabel(value: number) {
  return `${value.toLocaleString('es-PE', { maximumFractionDigits: 2 })} %`;
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduce(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

// True from the frame after mount, so values can animate in from their start.
function useShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
  }, []);
  return shown;
}

// The card's plastic, drawn in React Native: Expo Go's SwiftUI build has no gradient fills.
function CardArtRN({ design, image }: { design: CardDesign; image: string | null }) {
  if (image) {
    return <View style={{ flex: 1, backgroundColor: design.colors[2] }}>
      <RNImage source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {/* Scrims keep the name and figures legible on any artwork. */}
      <LinearGradient colors={['#00000080', '#00000000']} locations={[0, 0.42]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['#00000000', '#00000066']} locations={[0.62, 1]} style={StyleSheet.absoluteFill} />
    </View>;
  }
  return <View style={{ flex: 1, backgroundColor: design.colors[1], overflow: 'hidden' }}>
    <LinearGradient colors={design.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    <View style={{ position: 'absolute', width: '95%', aspectRatio: 1, borderRadius: 999, right: '-40%', top: '-62%', backgroundColor: '#FFFFFF', opacity: 0.08 }} />
    <View style={{ position: 'absolute', width: '75%', aspectRatio: 1, borderRadius: 999, left: '-30%', bottom: '-78%', backgroundColor: '#000000', opacity: 0.1 }} />
    <LinearGradient colors={['#FFFFFF38', '#FFFFFF00']} start={{ x: 0, y: 0 }} end={{ x: 0.55, y: 0.65 }} style={StyleSheet.absoluteFill} />
    <View style={{ position: 'absolute', left: '7%', top: '39%', width: '13%', aspectRatio: 1.3, borderRadius: 6, overflow: 'hidden' }}>
      <LinearGradient colors={['#F7E3A6', '#C9A24E', '#EBD290']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: '33%', height: 1, backgroundColor: '#8A6A2466' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: '66%', height: 1, backgroundColor: '#8A6A2466' }} />
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: '45%', width: 1, backgroundColor: '#8A6A2466' }} />
    </View>
  </View>;
}

function NetworkMarkNative({ network, ink, scale }: { network: CardNetwork; ink: string; scale: number }) {
  if (network === 'mastercard') {
    const size = Math.round(26 * scale);
    return <HStack alignment="center" spacing={-size * 0.4} modifiers={[accessibilityLabel('Mastercard')]}>
      <VStack modifiers={[frame({ width: size, height: size }), background('#EB001B'), clipShape('circle')]}>{null}</VStack>
      <VStack modifiers={[frame({ width: size, height: size }), background('#F79E1B'), clipShape('circle'), opacity(0.9)]}>{null}</VStack>
    </HStack>;
  }
  const text = network === 'visa' ? 'VISA' : network === 'amex' ? 'AMEX' : 'Diners Club';
  const size = network === 'visa' ? 22 : network === 'amex' ? 15 : 13;
  return <NativeText modifiers={[foregroundStyle(ink), font({ size: Math.round(size * scale), weight: network === 'diners' ? 'semibold' : 'heavy' }), ...(network === 'visa' ? [italic()] : []), lineLimit(1)]}>{text}</NativeText>;
}

type CardFace = Pick<CreditCard, 'name' | 'network' | 'last4' | 'design' | 'image'>;

function CardFaceNative({ card, width, amount }: { card: CardFace; width: number; amount?: Amounts | null }) {
  const design = cardDesign(card.design);
  const height = Math.round(width / CARD_RATIO);
  const ink = card.image ? '#FFFFFF' : design.ink;
  const inset = Math.round(width * 0.06);
  const scale = width / 340;
  return <ZStack alignment="topLeading" modifiers={[frame({ width, height }), clipShape('roundedRectangle', Math.round(width * 0.055))]}>
    <VStack modifiers={[frame({ width, height }), accessibilityHidden()]}>
      <RNHostView><CardArtRN design={design} image={card.image} /></RNHostView>
    </VStack>
    {/* Padding sits inside the frame, so the card keeps its exact size. */}
    <VStack alignment="leading" spacing={0} modifiers={[padding({ horizontal: inset, top: Math.round(inset * 0.85), bottom: inset }), frame({ width, height, alignment: 'topLeading' })]}>
      <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
        <NativeText modifiers={[foregroundStyle(ink), font({ size: Math.round(17 * scale), weight: 'semibold' }), lineLimit(1)]}>{card.name.trim() || 'Tarjeta'}</NativeText>
        <Spacer />
        {amount ? <NativeText modifiers={[foregroundStyle(ink), font({ size: Math.round(17 * scale), weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7), contentTransition('numericText'), animation(Animation.spring({ duration: 0.4 }), amount.PEN + amount.USD * 1000)]}>{formatAmounts(amount, { decimals: !amount.USD || !amount.PEN })}</NativeText> : null}
      </HStack>
      <Spacer />
      <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
        {card.last4 ? <NativeText modifiers={[foregroundStyle(withAlpha(ink, 0.85)), font({ size: Math.round(15 * scale), weight: 'semibold', design: 'monospaced' }), lineLimit(1)]}>{`•••• ${card.last4}`}</NativeText> : null}
        <Spacer />
        <NetworkMarkNative network={card.network} ink={ink} scale={scale} />
      </HStack>
    </VStack>
  </ZStack>;
}

// A small card for rows: the same art at 40 pt.
function CardThumbNative({ card }: { card: CardFace }) {
  return <VStack modifiers={[frame({ width: 40, height: 26 }), clipShape('roundedRectangle', 5), accessibilityHidden()]}>
    <RNHostView><CardArtRN design={cardDesign(card.design)} image={card.image} /></RNHostView>
  </VStack>;
}

// The wallet. Without a selection the cards stack like Wallet's, each showing
// its name and what the open cycle has spent. Choosing one springs it to the
// top while the others tuck behind it as a deck, tilted back, their edges
// still showing; tapping an edge switches cards, tapping the front one returns.
function CardStackNative({ cards, selectedId, amounts, width, reduceMotion, onSelect }: { cards: CreditCard[]; selectedId: string | null; amounts: Record<string, Amounts>; width: number; reduceMotion: boolean; onSelect: (id: string | null) => void }) {
  const height = Math.round(width / CARD_RATIO);
  const selectedIndex = cards.findIndex((card) => card.id === selectedId);
  const behind = Math.min(2, cards.length - 1);
  const stackHeight = selectedIndex < 0 ? height + (cards.length - 1) * STACK_PEEK : height + behind * 12;
  const motion = reduceMotion ? Animation.easeInOut({ duration: 0.2 }) : STACK_SPRING;
  return <ZStack alignment="top" modifiers={[frame({ width, height: stackHeight, alignment: 'top' }), animation(motion, selectedIndex)]}>
    {cards.map((card, index) => {
      const selected = index === selectedIndex;
      const rank = selectedIndex < 0 ? 0 : Math.abs(index - selectedIndex);
      const depth = Math.min(rank, 3);
      const y = selectedIndex < 0 ? index * STACK_PEEK : depth * STACK_DEPTH;
      return <ZStack key={card.id} modifiers={[
        frame({ width, height }),
        shadow({ radius: selected || selectedIndex < 0 ? 14 : 6, y: 6, color: '#00000038' }),
        ...(reduceMotion ? [] : [rotation3DEffect({ angle: depth ? -8 : 0, axis: { x: 1 }, perspective: 0.6 })]),
        scaleEffect(1 - depth * 0.05),
        offset({ y }),
        opacity(rank > 2 ? 0 : 1),
        zIndex(selectedIndex < 0 ? index : 100 - rank),
        animation(motion, selectedIndex),
        contentShape(shapes.roundedRectangle({ cornerRadius: Math.round(width * 0.055) })),
        onTapGesture(() => onSelect(selected ? null : card.id)),
        accessibilityElement('combine'),
        accessibilityAddTraits(['isButton', ...(selected ? ['isSelected' as const] : [])]),
        accessibilityLabel(`${card.name}${card.last4 ? `, terminada en ${card.last4}` : ''}, ${formatAmounts(amounts[card.id] ?? NO_AMOUNTS)} este ciclo`),
      ]}>
        <CardFaceNative card={card} width={width} amount={amounts[card.id] ?? NO_AMOUNTS} />
      </ZStack>;
    })}
  </ZStack>;
}

// Sections under the stack rise into place one after another.
function RevealNative({ index = 0, reduceMotion, children }: { index?: number; reduceMotion: boolean; children: ReactNode }) {
  const shown = useShown();
  return <VStack alignment="leading" spacing={0} modifiers={[
    frame({ maxWidth: Infinity, alignment: 'leading' }),
    opacity(shown ? 1 : 0),
    offset({ y: shown || reduceMotion ? 0 : 28 }),
    animation(reduceMotion ? Animation.easeOut({ duration: 0.2 }) : revealSpring().delay(0.05 + index * 0.06), shown),
  ]}>{children}</VStack>;
}

// A bar split into coloured parts, growing in from the left one after another.
function SegmentBarNative({ segments, total, width, height = 12, tokens }: { segments: Array<{ key: string; cents: number; color: string }>; total: number; width: number; height?: number; tokens: ThemeTokens }) {
  const shown = useShown();
  const visible = segments.filter((segment) => segment.cents > 0);
  const gaps = Math.max(0, visible.length - 1) * 2;
  return <HStack alignment="center" spacing={2} modifiers={[frame({ width, height, alignment: 'leading' }), background(tokens.mode === 'dark' ? '#FFFFFF1F' : '#0000000F'), clipShape('capsule'), accessibilityHidden()]}>
    {visible.map((segment, index) => <VStack key={segment.key} modifiers={[frame({ width: shown && total > 0 ? Math.max(3, Math.round(((width - gaps) * Math.min(segment.cents, total)) / total)) : 0, height }), background(segment.color), animation(Animation.spring({ duration: 0.9, bounce: 0.1 }).delay(index * 0.06), shown ? segment.cents : -1)]}>{null}</VStack>)}
    <Spacer />
  </HStack>;
}

function CategoryIconNative({ category, size = 34 }: { category: SpendCategory; size?: number }) {
  const style = CATEGORY_STYLES[category];
  return <ZStack alignment="center" modifiers={[frame({ width: size, height: size }), background(withAlpha(style.color, 0.16)), clipShape('circle'), accessibilityHidden()]}>
    <NativeImage systemName={style.symbol} modifiers={[font({ size: Math.round(size * 0.44), weight: 'semibold' }), foregroundStyle(style.color)]} />
  </ZStack>;
}

// A movement leads with what it cost in its own currency. A dollar purchase
// shows the bank's soles under it, or that they are still missing.
function ChargeRowNative({ charge, cardName, upcoming = false, tokens, onPress }: { charge: Charge; cardName?: string; upcoming?: boolean; tokens: ThemeTokens; onPress: () => void }) {
  const title = charge.title.trim() || categoryLabel(charge.category);
  const missingSoles = charge.currency === 'USD' && (charge.penCents === null || charge.estimated);
  const detail = [
    upcoming ? `Programado ${dayMonth(charge.date)}` : dayMonth(charge.date, true),
    charge.installment ? `Cuota ${charge.installment.index}/${charge.installment.count}` : null,
    charge.recurring && !upcoming ? 'Mensual' : null,
    cardName ?? null,
  ].filter(Boolean).join(' · ');
  const soles = charge.currency === 'USD' ? (charge.penCents === null ? 'Sin soles' : `${charge.estimated ? '≈ ' : ''}${formatMoney(charge.penCents)}`) : null;
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel([title, formatMoney(charge.cents, { currency: charge.currency }), soles, detail].filter(Boolean).join(', '))]}>
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 52, alignment: 'leading' }), contentShape(shapes.rectangle()), opacity(upcoming ? 0.55 : 1)]}>
      <CategoryIconNative category={charge.category} />
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'semibold' }), lineLimit(1)]}>{title}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit(), lineLimit(1)]}>{detail}</NativeText>
      </VStack>
      <VStack alignment="trailing" spacing={2}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{formatMoney(charge.cents, { currency: charge.currency })}</NativeText>
        {soles ? <NativeText modifiers={[...textModifiers(tokens, { color: missingSoles ? WARNING[tokens.mode] : tokens.secondary, style: 'footnote', weight: missingSoles ? 'semibold' : 'regular' }), monospacedDigit(), lineLimit(1)]}>{soles}</NativeText> : null}
      </VStack>
    </HStack>
  </NativeButton>;
}

function dueColor(statement: Statement, today: ISODate, tokens: ThemeTokens) {
  if (statement.status === 'overdue') return tokens.danger;
  return daysBetween(today, statement.due) <= 3 ? WARNING[tokens.mode] : tokens.blue;
}

function statementLine(statement: Statement, today: ISODate) {
  if (statement.status === 'overdue') return `Venció ${dayLabel(daysBetween(today, statement.due))}`;
  return capitalize(dayLabel(daysBetween(today, statement.due)));
}

// The payment day as a calendar leaf: the day large, the month above it,
// tinted by how close it is.
function DueLeafNative({ statement, today, tokens, size = 52 }: { statement: Statement; today: ISODate; tokens: ThemeTokens; size?: number }) {
  const color = dueColor(statement, today, tokens);
  const date = isoToDate(statement.due);
  return <VStack alignment="center" spacing={0} modifiers={[frame({ width: size, height: size }), background(withAlpha(String(color), tokens.mode === 'dark' ? 0.22 : 0.13)), clipShape('roundedRectangle', 14), accessibilityHidden()]}>
    <NativeText modifiers={[foregroundStyle(color), font({ size: Math.round(size * 0.21), weight: 'bold' }), textCase('uppercase')]}>{MONTHS_SHORT[date.getMonth()]}</NativeText>
    <NativeText modifiers={[foregroundStyle(color), font({ size: Math.round(size * 0.44), weight: 'heavy', design: 'rounded' }), monospacedDigit()]}>{String(date.getDate())}</NativeText>
  </VStack>;
}

// One figure per currency owed.
function AmountsNative({ amounts, tokens, size = 'title3' }: { amounts: Amounts; tokens: ThemeTokens; size?: 'title2' | 'title3' | 'headline' }) {
  const owed = (['PEN', 'USD'] as Currency[]).filter((currency) => amounts[currency] > 0);
  return <VStack alignment="leading" spacing={0}>
    {(owed.length ? owed : ['PEN' as Currency]).map((currency) => <NativeText key={currency} modifiers={[foregroundStyle(tokens.text), font({ textStyle: size, weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7), contentTransition('numericText'), animation(Animation.spring({ duration: 0.4 }), amounts[currency])]}>{formatMoney(amounts[currency], { currency })}</NativeText>)}
  </VStack>;
}

// Without a selection: what has to be paid across the cards, then the latest purchases.
function CardsOverviewNative({ data, today, tokens, reduceMotion, onOpenCard, onEditPurchase, onOpenRate }: { data: CardsData; today: ISODate; tokens: ThemeTokens; reduceMotion: boolean; onOpenCard: (id: string) => void; onEditPurchase: (purchase: Purchase) => void; onOpenRate: () => void }) {
  const rate = effectiveRate(data.rate);
  const dues = data.cards.flatMap((card) => unpaidStatements(card, data.purchases, data.payments, today).map((statement) => ({ card, statement })))
    .sort((a, b) => a.statement.due.localeCompare(b.statement.due));
  const recent = data.cards.flatMap((card) => chargesFor(card, data.purchases, today, effectiveRate(data.rate)).filter((charge) => !charge.installment || charge.installment.index === 1).map((charge) => ({ card, charge })))
    .sort((a, b) => b.charge.date.localeCompare(a.charge.date))
    .slice(0, 8);
  return <VStack alignment="leading" spacing={24} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    {dues.length ? <RevealNative index={0} reduceMotion={reduceMotion}>
      <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SectionHeadingNative title="Por pagar" tokens={tokens} />
        <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
          {dues.map(({ card, statement }) => <NativeButton key={`${card.id}:${statement.close}`} onPress={() => onOpenCard(card.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${card.name}, ${formatAmounts(statement.balance)}, ${statementLine(statement, today)}`)]}>
            <HStack alignment="center" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
              <DueLeafNative statement={statement} today={today} tokens={tokens} size={48} />
              <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <AmountsNative amounts={statement.balance} tokens={tokens} size="headline" />
                <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(1)]}>{card.name}</NativeText>
              </VStack>
              <CardThumbNative card={card} />
            </HStack>
          </NativeButton>)}
        </VStack>
      </VStack>
    </RevealNative> : null}
    {recent.length ? <RevealNative index={1} reduceMotion={reduceMotion}>
      <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SectionHeadingNative title="Recientes" tokens={tokens} />
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
          {recent.map(({ card, charge }) => {
            const purchase = data.purchases.find((item) => item.id === charge.purchaseId);
            return <ChargeRowNative key={`${charge.purchaseId}:${charge.date}`} charge={charge} cardName={card.name} tokens={tokens} onPress={() => purchase && onEditPurchase(purchase)} />;
          })}
        </VStack>
      </VStack>
    </RevealNative> : null}
    {data.purchases.some((purchase) => purchase.currency === 'USD') ? <RevealNative index={2} reduceMotion={reduceMotion}>
      <NativeButton onPress={onOpenRate} modifiers={[buttonStyle('plain'), accessibilityLabel(rate ? `Tipo de cambio, ${formatRate(rate)} soles por dólar, ${data.rate.mode === 'auto' ? 'automático' : 'manual'}` : 'Tipo de cambio, sin definir')]}>
        <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4, vertical: 6 }), contentShape(shapes.rectangle())]}>
          <NativeImage systemName="dollarsign.arrow.circlepath" modifiers={[font({ textStyle: 'title3' }), foregroundStyle(tokens.secondary)]} />
          <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'semibold' }), monospacedDigit()]}>{rate ? `US$ 1 = S/ ${formatRate(rate)}` : 'Tipo de cambio'}</NativeText>
          <Spacer />
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{data.rate.mode === 'auto' ? 'Automático' : 'Manual'}</NativeText>
          <SymbolImage name="chevron.right" color={tokens.secondary} size={13} />
        </HStack>
      </NativeButton>
    </RevealNative> : null}
  </VStack>;
}

// The exchange rate. Automatic takes the market rate once a day plus the
// bank's usual margin; manual is a rate typed here. It only estimates the
// soles of dollar purchases the bank has not converted yet. ✓ applies it.
function RateSheetNative({ settings, tokens, onSave, onClose }: { settings: RateSettings; tokens: ThemeTokens; onSave: (settings: RateSettings) => Promise<string | null>; onClose: () => void }) {
  const [mode, setMode] = useState(settings.mode);
  const [marginText, setMarginText] = useState(settings.marginPercent ? String(settings.marginPercent) : '');
  const [manualText, setManualText] = useState(settings.manual ? String(settings.manual) : '');
  const [market, setMarket] = useState(settings.market);
  const [marketOn, setMarketOn] = useState(settings.marketOn);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const margin = marginText.trim() ? Number(marginText.replace(',', '.')) : 0;
  const manual = parseRate(manualText);
  const draft: RateSettings = { mode, market, marketOn, marginPercent: Number.isFinite(margin) ? margin : 0, manual };
  const preview = effectiveRate(draft);
  const dirty = mode !== settings.mode || draft.marginPercent !== settings.marginPercent || manual !== settings.manual || market !== settings.market;

  const refresh = async () => {
    if (fetching) return;
    setFetching(true);
    setError(null);
    try {
      setMarket(await fetchMarketRate());
      setMarketOn(todayISO());
    } catch {
      setError('No se pudo obtener el tipo de cambio. Revisa tu conexión.');
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    if (saving) return;
    if (!dirty) return onClose();
    if (mode === 'manual' && !manual) return setError('Escribe un tipo de cambio como 3.75.');
    if (mode === 'auto' && (!Number.isFinite(margin) || margin < 0 || margin >= 20)) return setError('El margen debe estar entre 0 y 20 %.');
    setSaving(true);
    const message = await onSave(draft);
    setSaving(false);
    if (message) setError(message);
  };

  return <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), interactiveDismissDisabled(dirty || saving)]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(tokens.background)]}>
      <SheetHeaderNative title="Tipo de cambio" tokens={tokens} saving={saving} onClose={() => confirmDiscard(dirty, onClose, 'el tipo de cambio')} onSave={() => void save()} />
      {error ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.danger, style: 'callout', weight: 'semibold' }), frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: SHEET_ACTION_INSET, bottom: 12 })]}>{error}</NativeText> : null}
      <VStack alignment="center" spacing={2} modifiers={[frame({ maxWidth: Infinity }), padding({ bottom: 12 })]}>
        <NativeText modifiers={[foregroundStyle(preview ? tokens.text : tokens.secondary), font({ size: 44, weight: 'heavy', design: 'rounded' }), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.4 }), preview ?? 0)]}>{preview ? `S/ ${formatRate(preview)}` : '—'}</NativeText>
        <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>por dólar</NativeText>
      </VStack>
      <Picker selection={mode} onSelectionChange={(value) => setMode(value as RateSettings['mode'])} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), padding({ horizontal: SHEET_ACTION_INSET, bottom: 4 }), accessibilityLabel('Modo')]}>
        <NativeText modifiers={[tag('auto')]}>Automático</NativeText>
        <NativeText modifiers={[tag('manual')]}>Manual</NativeText>
      </Picker>
      <Form modifiers={[scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), listStyle('insetGrouped'), scrollDismissesKeyboard('immediately'), disabled(saving)]}>
        {mode === 'auto' ? <Section>
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <VStack alignment="leading" spacing={1}>
              <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>Mercado</NativeText>
              {marketOn ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{dayMonth(marketOn, true)}</NativeText> : null}
            </VStack>
            <Spacer />
            <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: 'semibold' }), monospacedDigit()]}>{market ? `S/ ${formatRate(market)}` : '—'}</NativeText>
          </HStack>
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>Margen del banco</NativeText>
            <Spacer />
            <SheetFieldNative initial={marginText} placeholder="0" label="Margen del banco, porcentaje" keyboard="decimal-pad" width={60} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={setMarginText} />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>%</NativeText>
          </HStack>
          <NativeButton label={fetching ? 'Actualizando…' : 'Actualizar ahora'} systemImage="arrow.clockwise" onPress={() => void refresh()} modifiers={[buttonStyle('borderless'), disabled(fetching)]} />
        </Section> : <Section>
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>Soles por dólar</NativeText>
            <Spacer />
            <SheetFieldNative initial={manualText} placeholder="3.75" label="Soles por dólar" keyboard="decimal-pad" width={90} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={setManualText} />
          </HStack>
        </Section>}
      </Form>
    </VStack>
  </Group>;
}

const AnimatedSvgCircle = RNAnimated.createAnimatedComponent(SvgCircle);

// The budget as a ring that winds up when the card opens. A fainter arc runs
// ahead of it to where the cycle will close at the current pace.
function BudgetRingRN({ size, stroke, fraction, projected, color, track, reduceMotion }: { size: number; stroke: number; fraction: number; projected: number | null; color: string; track: string; reduceMotion: boolean }) {
  const fill = useRef(new RNAnimated.Value(0)).current;
  const ahead = useRef(new RNAnimated.Value(0)).current;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  useEffect(() => {
    const to = Math.min(1, Math.max(0, fraction));
    const pace = projected === null ? 0 : Math.min(1, Math.max(to, projected));
    if (reduceMotion) {
      fill.setValue(to);
      ahead.setValue(pace);
      return;
    }
    RNAnimated.parallel([
      RNAnimated.spring(fill, { toValue: to, damping: 16, stiffness: 90, mass: 1, useNativeDriver: false }),
      RNAnimated.timing(ahead, { toValue: pace, duration: 1100, delay: 250, easing: RNEasing.out(RNEasing.cubic), useNativeDriver: false }),
    ]).start();
  }, [fraction, projected, reduceMotion, fill, ahead]);
  const offsetFor = (value: RNAnimated.Value) => value.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });
  const center = size / 2;
  return <Svg width={size} height={size}>
    <SvgG rotation={-90} origin={`${center}, ${center}`}>
      <SvgCircle cx={center} cy={center} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
      <AnimatedSvgCircle cx={center} cy={center} r={radius} stroke={color} strokeOpacity={0.3} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={offsetFor(ahead)} />
      <AnimatedSvgCircle cx={center} cy={center} r={radius} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={offsetFor(fill)} />
    </SvgG>
  </Svg>;
}

// The cycle day by day: one bar per day for what was bought on it, rising in
// a wave when the card opens. Days still to come are faint stubs, today has a
// dot under it. Sliding a finger along the chart picks a day (with a tick of
// haptics per day) and the movements below follow; tapping it again clears it.
function CycleChartRN({ days, todayIndex, selected, color, ink, faint, width, height, reduceMotion, onSelect }: { days: Array<{ date: ISODate; cents: number }>; todayIndex: number; selected: number | null; color: string; ink: string; faint: string; width: number; height: number; reduceMotion: boolean; onSelect: (index: number | null) => void }) {
  const count = days.length;
  const slot = width / count;
  const barWidth = Math.max(2, Math.min(14, slot - (slot > 8 ? 3 : 1.5)));
  const chartHeight = height - 10;
  const peak = Math.max(1, ...days.map((day) => day.cents));
  const grows = useRef(days.map(() => new RNAnimated.Value(reduceMotion ? 1 : 0))).current;
  const touch = useRef<{ start: number | null; moved: boolean; last: number | null }>({ start: null, moved: false, last: null });
  useEffect(() => {
    if (reduceMotion) return;
    RNAnimated.stagger(14, grows.map((value) => RNAnimated.spring(value, { toValue: 1, damping: 14, stiffness: 160, useNativeDriver: true }))).start();
  }, [grows, reduceMotion]);

  const indexAt = (x: number) => Math.max(0, Math.min(count - 1, Math.floor(x / slot)));
  const pick = (x: number) => {
    const index = indexAt(x);
    if (index !== touch.current.last) {
      touch.current.last = index;
      void Haptics.selectionAsync();
      onSelect(index);
    }
  };

  return <View style={{ width, height }}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {days.map((day, index) => {
        const future = index > todayIndex;
        const barHeight = day.cents > 0 ? Math.max(4, Math.round((chartHeight * day.cents) / peak)) : 3;
        const dimmed = selected !== null && selected !== index;
        return <RNAnimated.View key={day.date} style={{
          position: 'absolute',
          left: index * slot + (slot - barWidth) / 2,
          bottom: 10,
          width: barWidth,
          height: barHeight,
          borderRadius: Math.min(barWidth / 2, 4),
          backgroundColor: day.cents > 0 ? color : faint,
          opacity: future ? 0.5 : dimmed ? 0.3 : 1,
          transformOrigin: 'bottom',
          transform: [{ scaleY: grows[index] ?? 1 }],
        }} />;
      })}
      {todayIndex >= 0 && todayIndex < count ? <View style={{ position: 'absolute', left: todayIndex * slot + slot / 2 - 2.5, bottom: 0, width: 5, height: 5, borderRadius: 3, backgroundColor: ink }} /> : null}
    </View>
    <View
      style={StyleSheet.absoluteFill}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        touch.current = { start: event.nativeEvent.locationX, moved: false, last: selected };
        const index = indexAt(event.nativeEvent.locationX);
        if (index !== selected) pick(event.nativeEvent.locationX);
      }}
      onResponderMove={(event) => {
        if (touch.current.start !== null && Math.abs(event.nativeEvent.locationX - touch.current.start) > 4) touch.current.moved = true;
        pick(event.nativeEvent.locationX);
      }}
      onResponderRelease={(event) => {
        // A tap on the day already picked clears the selection.
        const index = indexAt(event.nativeEvent.locationX);
        if (!touch.current.moved && index === selected && touch.current.last === selected) onSelect(null);
        touch.current.start = null;
      }}
    />
  </View>;
}

type MovementFilter = { kind: 'day'; date: ISODate } | { kind: 'category'; category: SpendCategory } | { kind: 'pending' } | null;

// What the cycle went on: one bar in category colours, then a chip per
// category with its amount (and its limit, coloured as it fills). Tapping a
// chip shows only its movements.
function CategoryBreakdownNative({ categories, total, width, filter, tokens, onFilter }: { categories: CategorySpend[]; total: number; width: number; filter: MovementFilter; tokens: ThemeTokens; onFilter: (filter: MovementFilter) => void }) {
  const { fontScale } = useWindowDimensions();
  const items = categories.filter((item) => item.cents > 0 || item.limitCents);
  const rows: CategorySpend[][] = [];
  let used = width;
  for (const item of items) {
    const label = item.limitCents ? `${formatMoney(item.cents, { decimals: false })} / ${formatMoney(item.limitCents, { decimals: false }).replace('S/ ', '')}` : formatMoney(item.cents, { decimals: false });
    const estimate = 46 + label.length * 8 * fontScale;
    if (used + 8 + estimate > width) {
      rows.push([item]);
      used = estimate;
    } else {
      rows[rows.length - 1].push(item);
      used += 8 + estimate;
    }
  }
  return <VStack alignment="leading" spacing={12} modifiers={[frame({ width, alignment: 'leading' })]}>
    <SegmentBarNative width={width} height={14} total={Math.max(1, total)} tokens={tokens} segments={items.filter((item) => item.cents > 0).map((item) => ({ key: item.category, cents: item.cents, color: CATEGORY_STYLES[item.category].color }))} />
    <VStack alignment="leading" spacing={8}>
      {rows.map((row) => <HStack key={row[0].category} alignment="center" spacing={8}>
        {row.map((item) => {
          const chosen = filter?.kind === 'category' && filter.category === item.category;
          const share = item.limitCents ? item.cents / item.limitCents : 0;
          const ink = item.limitCents && share >= 1 ? tokens.danger : item.limitCents && share >= 0.8 ? WARNING[tokens.mode] : tokens.text;
          const label = item.limitCents ? `${formatMoney(item.cents, { decimals: false })} / ${formatMoney(item.limitCents, { decimals: false }).replace('S/ ', '')}` : formatMoney(item.cents, { decimals: false });
          return <NativeButton key={item.category} onPress={() => onFilter(chosen ? null : { kind: 'category', category: item.category })} modifiers={[buttonStyle('plain'), accessibilityLabel(`${categoryLabel(item.category)}, ${label}`), ...(chosen ? [accessibilityAddTraits(['isSelected'])] : [])]}>
            <HStack alignment="center" spacing={6} modifiers={[padding({ leading: 5, trailing: 12, vertical: 5 }), background(chosen ? withAlpha(CATEGORY_STYLES[item.category].color, tokens.mode === 'dark' ? 0.32 : 0.2) : tokens.surface), clipShape('capsule'), contentShape(shapes.capsule()), scaleEffect(chosen ? 1.04 : 1), animation(Animation.spring({ duration: 0.3, bounce: 0.3 }), chosen)]}>
              <CategoryIconNative category={item.category} size={26} />
              <NativeText modifiers={[foregroundStyle(ink), font({ textStyle: 'subheadline', weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{label}</NativeText>
            </HStack>
          </NativeButton>;
        })}
      </HStack>)}
    </VStack>
  </VStack>;
}

function CardDetailNative({ card, data, today, offset: cycleOffset, width, tokens, reduceMotion, onOffsetChange, onEditPurchase, onPay, onUndoPayment, onOpenRate }: {
  card: CreditCard;
  data: CardsData;
  today: ISODate;
  offset: number;
  width: number;
  tokens: ThemeTokens;
  reduceMotion: boolean;
  onOffsetChange: (offset: number) => void;
  onEditPurchase: (purchase: Purchase) => void;
  onPay: (statement: Statement) => void;
  onUndoPayment: (statement: Statement) => void;
  onOpenRate: () => void;
}) {
  const rate = effectiveRate(data.rate);
  const currentClose = closingFor(card.closingDay, today);
  const close = shiftClose(currentClose, cycleOffset, card.closingDay);
  const summary = cycleSummary(card, data.purchases, close, today, effectiveRate(data.rate));
  const isCurrent = cycleOffset === 0;
  const isPast = close < currentClose;
  const accent = cardDesign(card.design).accent;
  const ink = cardInk(card, tokens);
  const shown = useShown();
  const [filter, setFilter] = useState<MovementFilter>(null);
  const [cashbackOpen, setCashbackOpen] = useState(false);
  useEffect(() => setFilter(null), [cycleOffset]);

  // The cycles that hold anything: back to the first purchase, forward to the last installment.
  const own = data.purchases.filter((purchase) => purchase.cardId === card.id);
  const earliest = own.reduce<ISODate>((first, purchase) => (purchase.date < first ? purchase.date : first), today);
  const lastCycle = chargesFor(card, data.purchases, today).reduce<ISODate>((last, charge) => (charge.cycle > last ? charge.cycle : last), currentClose);
  const canBack = close > closingFor(card.closingDay, earliest);
  const canForward = close < lastCycle;

  const budget = isCurrent ? card.budgetCents : null;
  const used = budget ? summary.spentCents / budget : 0;
  const ringColor = used >= 1 ? tokens.danger : used >= 0.8 ? WARNING[tokens.mode] : accent;
  const statement = isPast ? statementFor(card, data.purchases, data.payments, close, today) : null;
  const unpaid = isCurrent ? unpaidStatements(card, data.purchases, data.payments, today) : [];
  const last = isCurrent ? lastStatement(card, data.purchases, data.payments, today) : null;
  const credit = creditUse(card, data.purchases, data.payments, today, effectiveRate(data.rate));
  const cashback = cashbackFor(card, data.purchases, close, effectiveRate(data.rate));
  const earnsCashback = card.baseCashback > 0 || card.cashback.length > 0;
  const todayIndex = isCurrent ? daysBetween(summary.cycle.start, today) : isPast ? summary.daysTotal : -1;
  const hasDays = summary.days.some((day) => day.cents > 0);
  const selectedDay = filter?.kind === 'day' ? summary.days.findIndex((day) => day.date === filter.date) : -1;
  const shownUsd = summary.spent.USD;
  const label = isCurrent ? 'Este ciclo' : isPast ? 'Facturado' : 'Por facturar';

  const all = [...summary.upcoming.map((charge) => ({ charge, upcoming: true })), ...summary.posted.map((charge) => ({ charge, upcoming: false }))];
  const movements = all.filter(({ charge }) => !filter
    || (filter.kind === 'day' && charge.date === filter.date)
    || (filter.kind === 'category' && charge.category === filter.category)
    || (filter.kind === 'pending' && charge.currency === 'USD' && charge.penCents === null));
  const filterLabel = !filter ? null : filter.kind === 'day' ? dayMonth(filter.date, true) : filter.kind === 'category' ? categoryLabel(filter.category) : 'Sin soles';
  const purchaseFor = (charge: Charge) => data.purchases.find((purchase) => purchase.id === charge.purchaseId);

  const navButton = (symbol: SFSymbol, labelText: string, enabled: boolean, next: number) => <NativeButton onPress={() => onOffsetChange(next)} modifiers={[buttonStyle('plain'), disabled(!enabled), accessibilityLabel(labelText)]}>
    <ZStack alignment="center" modifiers={[frame({ width: 40, height: 40 }), contentShape(shapes.rectangle())]}>
      <NativeImage systemName={symbol} modifiers={[font({ textStyle: 'body', weight: 'semibold' }), foregroundStyle(enabled ? tokens.text : tokens.border)]} />
    </ZStack>
  </NativeButton>;

  const ringSize = Math.min(124, Math.round(width * 0.34));
  // Disponible and Cashback: a label above a figure, stretched to the same height.
  const tileModifiers: ViewModifier[] = [padding({ all: 16 }), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)];
  // The cycle in soles, dollars included: the bank's soles or, until then, the estimate.
  const total = isCurrent ? summary.spentCents : summary.spentCents + summary.scheduledCents;
  const approx = summary.estimatedCents > 0 ? '≈ ' : '';
  const amountBlock = <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <NativeText modifiers={textModifiers(tokens, { color: ink, style: 'subheadline', weight: 'bold' })}>{label}</NativeText>
    {/* The figure counts up from zero when the card opens, and rolls on every change. */}
    <NativeText modifiers={[foregroundStyle(tokens.text), font({ size: budget ? 38 : 46, weight: 'heavy', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.5), contentTransition('numericText'), animation(Animation.spring({ duration: 0.7, bounce: 0.1 }), shown ? total : -1)]}>{`${approx}${formatMoney(shown ? total : 0)}`}</NativeText>
    {shownUsd > 0 ? <HStack alignment="center" spacing={8}>
    <NativeButton onPress={() => setFilter(filter?.kind === 'pending' ? null : { kind: 'pending' })} modifiers={[buttonStyle('plain'), disabled(summary.pendingUsdCents === 0), accessibilityLabel(`${formatMoney(shownUsd, { currency: 'USD' })}${summary.pendingUsdCents ? ', sin monto en soles' : ''}`)]}>
      <HStack alignment="center" spacing={5} modifiers={[padding({ horizontal: 10, vertical: 5 }), background(withAlpha(summary.pendingUsdCents ? WARNING[tokens.mode] : accent, tokens.mode === 'dark' ? 0.24 : 0.14)), clipShape('capsule')]}>
        {summary.pendingUsdCents ? <NativeImage systemName="hourglass" modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(WARNING[tokens.mode])]} /> : null}
        <NativeText modifiers={[foregroundStyle(summary.pendingUsdCents ? WARNING[tokens.mode] : ink), font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.5 }), shown ? shownUsd : -1)]}>{formatMoney(shown ? shownUsd : 0, { currency: 'USD' })}</NativeText>
      </HStack>
    </NativeButton>
    {summary.pendingUsdCents > 0 ? <NativeButton onPress={onOpenRate} modifiers={[buttonStyle('plain'), accessibilityLabel(rate ? `Estimado a ${formatRate(rate)} soles por dólar` : 'Sin tipo de cambio'), accessibilityHint('Toca para cambiar el tipo de cambio')]}>
      <HStack alignment="center" spacing={4} modifiers={[contentShape(shapes.rectangle())]}>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote', weight: 'semibold' }), monospacedDigit()]}>{rate ? `a ${formatRate(rate)}` : 'Sin tipo de cambio'}</NativeText>
        <NativeImage systemName="chevron.right" modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(tokens.secondary)]} />
      </HStack>
    </NativeButton> : null}
    </HStack> : null}
    {statement && statement.status !== 'empty' ? <HStack alignment="center" spacing={5} modifiers={[padding({ top: 2 })]}>
      <NativeImage systemName={statement.status === 'paid' ? 'checkmark.seal.fill' : 'clock.fill'} modifiers={[font({ textStyle: 'footnote', weight: 'bold' }), foregroundStyle(statement.status === 'paid' ? PAID[tokens.mode] : dueColor(statement, today, tokens))]} />
      <NativeText modifiers={textModifiers(tokens, { color: statement.status === 'paid' ? PAID[tokens.mode] : dueColor(statement, today, tokens), style: 'subheadline', weight: 'semibold' })}>{statement.status === 'paid' ? 'Pagado' : `Falta ${formatAmounts(statement.balance)}`}</NativeText>
    </HStack> : null}
  </VStack>;

  return <VStack alignment="leading" spacing={28} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <RevealNative index={0} reduceMotion={reduceMotion}>
      <VStack alignment="leading" spacing={14} modifiers={[frame({ width, alignment: 'leading' })]}>
        <HStack alignment="center" spacing={0} modifiers={[frame({ width })]}>
          {navButton('chevron.left', 'Ciclo anterior', canBack, cycleOffset - 1)}
          <Spacer />
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' }), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.3 }), cycleOffset)]}>{cycleRange(summary.cycle)}</NativeText>
          <Spacer />
          {navButton('chevron.right', 'Ciclo siguiente', canForward, cycleOffset + 1)}
        </HStack>

        {budget ? <HStack alignment="center" spacing={18} modifiers={[frame({ width, alignment: 'leading' })]}>
          <ZStack alignment="center" modifiers={[frame({ width: ringSize, height: ringSize }), accessibilityElement('ignore'), accessibilityLabel('Presupuesto usado'), accessibilityValue(`${Math.round(used * 100)} % de ${formatMoney(budget, { decimals: false })}`)]}>
            <VStack modifiers={[frame({ width: ringSize, height: ringSize })]}>
              <RNHostView><BudgetRingRN size={ringSize} stroke={Math.round(ringSize * 0.11)} fraction={used} projected={summary.projectedCents !== null ? summary.projectedCents / budget : null} color={ringColor} track={tokens.mode === 'dark' ? '#FFFFFF1F' : '#0000000F'} reduceMotion={reduceMotion} /></RNHostView>
            </VStack>
            <VStack alignment="center" spacing={0}>
              <NativeText modifiers={[foregroundStyle(used >= 0.8 ? ringColor : tokens.text), font({ size: Math.round(ringSize * 0.22), weight: 'heavy', design: 'rounded' }), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.7 }), shown ? Math.round(used * 100) : -1)]}>{`${shown ? Math.round(used * 100) : 0}%`}</NativeText>
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'semibold' }), monospacedDigit()]}>{formatMoney(budget, { decimals: false })}</NativeText>
            </VStack>
          </ZStack>
          {amountBlock}
        </HStack> : amountBlock}

        {hasDays ? <VStack alignment="leading" spacing={6} modifiers={[frame({ width, alignment: 'leading' }), accessibilityElement('contain')]}>
          <VStack modifiers={[frame({ width, height: 84 }), accessibilityLabel('Gasto por día'), accessibilityHint('Desliza para ver cada día')]}>
            <RNHostView>
              <CycleChartRN days={summary.days} todayIndex={todayIndex} selected={selectedDay >= 0 ? selectedDay : null} color={accent} ink={String(tokens.mode === 'dark' ? '#FFFFFF' : '#000000')} faint={tokens.mode === 'dark' ? '#FFFFFF33' : '#0000001F'} width={width} height={84} reduceMotion={reduceMotion} onSelect={(index) => setFilter(index === null ? null : { kind: 'day', date: summary.days[index].date })} />
            </RNHostView>
          </VStack>
          <HStack alignment="center" modifiers={[frame({ width })]}>
            {selectedDay >= 0 ? <>
              <NativeText modifiers={textModifiers(tokens, { color: ink, style: 'subheadline', weight: 'bold' })}>{dayMonth(summary.days[selectedDay].date, true)}</NativeText>
              <Spacer />
              <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', weight: 'bold' }), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.25 }), selectedDay)]}>{formatMoney(summary.days[selectedDay].cents)}</NativeText>
            </> : <>
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'semibold' }), monospacedDigit()]}>{dayMonth(summary.cycle.start)}</NativeText>
              <Spacer />
              <HStack alignment="center" spacing={4}>
                <NativeImage systemName="lock.fill" modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(tokens.secondary)]} />
                <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'semibold' }), monospacedDigit()]}>{isCurrent ? `${dayMonth(summary.cycle.close)} · ${summary.daysLeft} d` : dayMonth(summary.cycle.close)}</NativeText>
              </HStack>
            </>}
          </HStack>
        </VStack> : null}
      </VStack>
    </RevealNative>

    {isCurrent && (unpaid.length || (last && last.status === 'paid')) ? <RevealNative index={1} reduceMotion={reduceMotion}>
      <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {unpaid.map((item) => <HStack key={item.close} alignment="center" spacing={14} modifiers={[...surfaceModifiers(tokens, UI.groupRadius), accessibilityElement('contain')]}>
          <DueLeafNative statement={item} today={today} tokens={tokens} />
          <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <AmountsNative amounts={item.balance} tokens={tokens} size="title2" />
            <NativeText modifiers={[...textModifiers(tokens, { color: dueColor(item, today, tokens), style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{statementLine(item, today)}</NativeText>
          </VStack>
          <NativeCircleButton tokens={tokens} accent label={`Registrar pago de ${formatAmounts(item.balance)}`} systemName="checkmark" onPress={() => onPay(item)} />
        </HStack>)}
        {!unpaid.length && last ? <NativeButton onPress={() => onUndoPayment(last)} modifiers={[buttonStyle('plain'), accessibilityLabel(`Ciclo al ${dayMonth(last.close)} pagado, ${formatAmounts(last.total)}`), accessibilityHint('Toca para deshacer el pago')]}>
          <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 }), contentShape(shapes.rectangle())]}>
            <NativeImage systemName="checkmark.seal.fill" modifiers={[font({ size: 22 }), foregroundStyle(PAID[tokens.mode])]} />
            <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{`${formatAmounts(last.total)} pagado`}</NativeText>
          </HStack>
        </NativeButton> : null}
      </VStack>
    </RevealNative> : null}

    {(isCurrent && card.limitCents > 0) || earnsCashback ? <RevealNative index={2} reduceMotion={reduceMotion}>
      <VStack alignment="leading" spacing={10} modifiers={[frame({ width, alignment: 'leading' })]}>
        <HStack alignment="top" spacing={10} modifiers={[frame({ width }), fixedSize({ horizontal: false, vertical: true })]}>
          {isCurrent && card.limitCents > 0 ? <VStack alignment="leading" spacing={8} modifiers={[...tileModifiers, accessibilityElement('combine')]}>
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'semibold' })}>Disponible</NativeText>
            <NativeText modifiers={[foregroundStyle(credit.availableCents < 0 ? tokens.danger : tokens.text), font({ textStyle: 'title3', weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6), contentTransition('numericText'), animation(Animation.spring({ duration: 0.5 }), credit.availableCents)]}>{`${credit.estimated ? '≈ ' : ''}${formatMoney(credit.availableCents)}`}</NativeText>
          </VStack> : null}
          {earnsCashback ? <NativeButton onPress={() => setCashbackOpen((value) => !value)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, maxHeight: Infinity }), disabled(!cashback.lines.length), accessibilityLabel(`Cashback ${formatMoney(cashback.cents)}`)]}>
            <VStack alignment="leading" spacing={8} modifiers={[...tileModifiers, contentShape(shapes.rectangle())]}>
              <HStack alignment="center" spacing={4} modifiers={[frame({ maxWidth: Infinity })]}>
                <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'semibold' })}>Cashback</NativeText>
                <Spacer />
                {cashback.lines.length ? <NativeImage systemName="chevron.down" modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(tokens.secondary), rotationEffect(cashbackOpen ? 180 : 0), animation(Animation.spring({ duration: 0.3 }), cashbackOpen)]} /> : null}
              </HStack>
              <NativeText modifiers={[foregroundStyle(PAID[tokens.mode]), font({ textStyle: 'title3', weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6), contentTransition('numericText'), animation(Animation.spring({ duration: 0.5 }), cashback.cents)]}>{`${cashback.estimated ? '≈ ' : ''}${formatMoney(cashback.cents)}`}</NativeText>
            </VStack>
          </NativeButton> : null}
        </HStack>
        {cashbackOpen && cashback.lines.length ? <RevealNative reduceMotion={reduceMotion}>
          <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4, top: 4 })]}>
            {cashback.lines.map((line) => <HStack key={line.category} alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity }), accessibilityElement('combine')]}>
              <CategoryIconNative category={line.category} size={26} />
              <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', weight: 'semibold' }), lineLimit(1)]}>{categoryLabel(line.category)}</NativeText>
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote', weight: 'semibold' }), monospacedDigit()]}>{line.capped ? `${percentLabel(line.rate)} · tope` : percentLabel(line.rate)}</NativeText>
              <Spacer />
              <NativeText modifiers={[...textModifiers(tokens, { color: PAID[tokens.mode], style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{`+${formatMoney(line.cents)}`}</NativeText>
            </HStack>)}
          </VStack>
        </RevealNative> : null}
      </VStack>
    </RevealNative> : null}

    {summary.categories.some((item) => item.cents > 0 || item.limitCents) ? <RevealNative index={3} reduceMotion={reduceMotion}>
      <CategoryBreakdownNative categories={summary.categories} total={summary.categories.reduce((total, item) => total + item.cents, 0)} width={width} filter={filter} tokens={tokens} onFilter={setFilter} />
    </RevealNative> : null}

    <RevealNative index={4} reduceMotion={reduceMotion}>
      <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 4 })]}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>Movimientos</NativeText>
          <Spacer />
          {filterLabel ? <NativeButton onPress={() => setFilter(null)} modifiers={[buttonStyle('plain'), accessibilityLabel(`Quitar filtro ${filterLabel}`)]}>
            <HStack alignment="center" spacing={5} modifiers={[padding({ horizontal: 10, vertical: 5 }), background(withAlpha(accent, tokens.mode === 'dark' ? 0.28 : 0.16)), clipShape('capsule')]}>
              <NativeText modifiers={[foregroundStyle(ink), font({ textStyle: 'subheadline', weight: 'semibold' }), lineLimit(1)]}>{filterLabel}</NativeText>
              <NativeImage systemName="xmark" modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(ink)]} />
            </HStack>
          </NativeButton> : null}
        </HStack>
        {movements.length ? <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
          {movements.map(({ charge, upcoming }) => <ChargeRowNative key={`${charge.purchaseId}:${charge.date}:${charge.cycle}`} charge={charge} upcoming={upcoming} tokens={tokens} onPress={() => { const purchase = purchaseFor(charge); if (purchase) onEditPurchase(purchase); }} />)}
        </VStack> : <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'body' }), padding({ horizontal: 4, vertical: 8 })]}>{filter ? 'Nada aquí' : 'Sin movimientos'}</NativeText>}
      </VStack>
    </RevealNative>
  </VStack>;
}

export function CardsNative({ tokens, link, onBack }: { tokens: ThemeTokens; link: { cardId: string; nonce: number } | null; onBack: () => void }) {
  const { ready, failed, data } = useCards();
  const now = useCurrentTime();
  const today = todayISO(now);
  const pageWidth = usePageWidth();
  const reduceMotion = useReduceMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cycleOffset, setCycleOffset] = useState(0);
  const [purchaseSheet, setPurchaseSheet] = useState<{ purchase: Purchase | null; cardId: string | null } | null>(null);
  const [cardSheet, setCardSheet] = useState<{ card: CreditCard | null } | null>(null);

  useEffect(() => {
    if (!link) return;
    setSelectedId(link.cardId);
    setCycleOffset(0);
  }, [link]);

  const [rateSheet, setRateSheet] = useState(false);
  useEffect(() => {
    void refreshMarketRateIfStale();
  }, [data.purchases.length]);

  const saveRate = async (rate: RateSettings) => {
    const saved = await updateCards((current) => ({ ...current, rate }));
    if (!saved) return 'No se pudo guardar el tipo de cambio.';
    setRateSheet(false);
    return null;
  };

  const selected = data.cards.find((card) => card.id === selectedId) ?? null;
  const select = (id: string | null) => {
    void Haptics.selectionAsync();
    setSelectedId(id);
    setCycleOffset(0);
  };

  const amounts = useMemo(() => Object.fromEntries(data.cards.map((card) => [card.id, cycleSummary(card, data.purchases, closingFor(card.closingDay, today), today, effectiveRate(data.rate)).spent])), [data, today]);

  const savePurchase = async (purchase: Purchase) => {
    const card = data.cards.find((item) => item.id === purchase.cardId);
    if (!card) return 'Elige una tarjeta.';
    const close = closingFor(card.closingDay, today);
    const before = cycleSummary(card, data.purchases, close, today, effectiveRate(data.rate)).spentCents;
    const purchases = [...data.purchases.filter((item) => item.id !== purchase.id), purchase];
    const saved = await updateCards((current) => ({ ...current, purchases: [...current.purchases.filter((item) => item.id !== purchase.id), purchase] }));
    if (!saved) return 'No se pudo guardar el gasto. Inténtalo de nuevo.';
    const after = cycleSummary(card, purchases, close, today, effectiveRate(data.rate)).spentCents;
    const budget = card.budgetCents;
    // Crossing 80 % or the whole budget is felt, not only seen.
    const crossed = budget !== null && [0.8, 1].some((threshold) => before < budget * threshold && after >= budget * threshold);
    void Haptics.notificationAsync(crossed ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
    setPurchaseSheet(null);
    return null;
  };

  const deletePurchase = async (id: string) => {
    const saved = await updateCards((current) => ({ ...current, purchases: current.purchases.filter((item) => item.id !== id) }));
    if (!saved) return 'No se pudo eliminar el gasto.';
    setPurchaseSheet(null);
    return null;
  };

  const saveCard = async (card: CreditCard, previousImage: string | null) => {
    const saved = await updateCards((current) => ({
      ...current,
      cards: current.cards.some((item) => item.id === card.id) ? current.cards.map((item) => (item.id === card.id ? card : item)) : [...current.cards, card],
    }));
    if (!saved) return 'No se pudo guardar la tarjeta. Inténtalo de nuevo.';
    if (previousImage && previousImage !== card.image) void deleteCardImage(previousImage);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCardSheet(null);
    return null;
  };

  const deleteCard = async (card: CreditCard) => {
    const saved = await updateCards((current) => ({
      ...current,
      cards: current.cards.filter((item) => item.id !== card.id),
      purchases: current.purchases.filter((item) => item.cardId !== card.id),
      payments: current.payments.filter((item) => item.cardId !== card.id),
    }));
    if (!saved) return 'No se pudo eliminar la tarjeta.';
    void deleteCardImage(card.image);
    setCardSheet(null);
    setSelectedId(null);
    return null;
  };

  const recordPayments = (card: CreditCard, statement: Statement, amounts: Partial<Amounts>) => {
    const entries: Payment[] = (['PEN', 'USD'] as Currency[])
      .filter((currency) => (amounts[currency] ?? 0) > 0)
      .map((currency) => ({ id: makeCardsId(), cardId: card.id, cycle: statement.close, currency, cents: amounts[currency] ?? 0, date: today }));
    if (!entries.length) return;
    void updateCards((current) => ({ ...current, payments: [...current.payments, ...entries] })).then((saved) => {
      if (saved) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Alert.alert('No se pudo registrar el pago', 'Inténtalo de nuevo.');
    });
  };

  const askAmount = (card: CreditCard, statement: Statement, currency: Currency) => {
    Alert.prompt(currency === 'USD' ? 'Monto pagado en dólares' : 'Monto pagado en soles', `Saldo ${formatMoney(statement.balance[currency], { currency })}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Registrar',
        onPress: (value?: string) => {
          const cents = parseMoney(value ?? '');
          if (!cents) return Alert.alert('Monto no válido', 'Escribe un monto como 250.50.');
          recordPayments(card, statement, { [currency]: Math.min(cents, statement.balance[currency]) });
        },
      },
    ], 'plain-text', '', 'decimal-pad');
  };

  // A two-currency statement is paid in each currency: both at once, one of
  // them in full, or part of either.
  const pay = (card: CreditCard, statement: Statement) => {
    const owed = (['PEN', 'USD'] as Currency[]).filter((currency) => statement.balance[currency] > 0);
    const both = owed.length > 1;
    Alert.alert('Registrar pago', `Saldo del ciclo al ${dayMonth(statement.close)}: ${formatAmounts(statement.balance)}`, [
      { text: 'Pago total', onPress: () => recordPayments(card, statement, statement.balance) },
      ...(both ? owed.map((currency) => ({ text: `Solo ${formatMoney(statement.balance[currency], { currency })}`, onPress: () => recordPayments(card, statement, { [currency]: statement.balance[currency] }) })) : []),
      {
        text: 'Otro monto',
        onPress: () => both
          ? Alert.alert('Moneda del pago', undefined, [
            { text: 'Soles', onPress: () => askAmount(card, statement, 'PEN') },
            { text: 'Dólares', onPress: () => askAmount(card, statement, 'USD') },
            { text: 'Cancelar', style: 'cancel' },
          ])
          : askAmount(card, statement, owed[0] ?? 'PEN'),
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const undoPayment = (card: CreditCard, statement: Statement) => {
    Alert.alert('Deshacer pago', `El ciclo al ${dayMonth(statement.close)} volverá a figurar por pagar.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Deshacer',
        style: 'destructive',
        onPress: () => void updateCards((current) => ({ ...current, payments: current.payments.filter((item) => !(item.cardId === card.id && item.cycle === statement.close)) })),
      },
    ]);
  };

  const action = selected
    ? <GlassControlGroup>
      <NativeCircleButton tokens={tokens} label="Editar tarjeta" systemName="pencil" onPress={() => setCardSheet({ card: selected })} />
      <NativeCircleButton tokens={tokens} accent label="Nuevo gasto" systemName="plus" onPress={() => setPurchaseSheet({ purchase: null, cardId: selected.id })} />
    </GlassControlGroup>
    : ready && !failed ? <GlassControlGroup>
      <NativeCircleButton tokens={tokens} accent={!data.cards.length} label="Añadir tarjeta" systemName={data.cards.length ? 'rectangle.stack.badge.plus' : 'plus'} onPress={() => setCardSheet({ card: null })} />
      {data.cards.length ? <NativeCircleButton tokens={tokens} accent label="Nuevo gasto" systemName="plus" onPress={() => setPurchaseSheet({ purchase: null, cardId: null })} /> : null}
    </GlassControlGroup> : undefined;

  return <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
    <PageNative
      title={selected ? selected.name : 'Tarjetas'}
      tokens={tokens}
      onBack={selected ? () => select(null) : onBack}
      backLabel={selected ? 'Volver a Tarjetas' : undefined}
      action={action}
      ambient={selected ? cardDesign(selected.design).accent : null}>
      <ReadingCanvasNative tokens={tokens}>
        {!ready ? <ProgressView modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 48 })]} />
          : failed ? <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4, vertical: 8 })]}>
            <SymbolImage name="exclamationmark.triangle" color={tokens.danger} />
            <NativeText modifiers={textModifiers(tokens)}>No se pudieron leer tus tarjetas.</NativeText>
            <NativeButton label="Reintentar" onPress={() => void loadCards(true)} modifiers={[buttonStyle('bordered'), controlSize('large')]} />
          </VStack>
          : !data.cards.length ? <ContentUnavailableView title="Sin tarjetas" systemImage="creditcard" modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 48 })]} />
          : <>
            <CardStackNative cards={data.cards} selectedId={selected?.id ?? null} amounts={amounts} width={pageWidth} reduceMotion={reduceMotion} onSelect={select} />
            {selected
              ? <CardDetailNative key={selected.id} card={selected} data={data} today={today} offset={cycleOffset} width={pageWidth} tokens={tokens} reduceMotion={reduceMotion} onOffsetChange={setCycleOffset} onEditPurchase={(purchase) => setPurchaseSheet({ purchase, cardId: purchase.cardId })} onPay={(statement) => pay(selected, statement)} onUndoPayment={(statement) => undoPayment(selected, statement)} onOpenRate={() => setRateSheet(true)} />
              : <CardsOverviewNative key="overview" data={data} today={today} tokens={tokens} reduceMotion={reduceMotion} onOpenCard={select} onEditPurchase={(purchase) => setPurchaseSheet({ purchase, cardId: purchase.cardId })} onOpenRate={() => setRateSheet(true)} />}
          </>}
      </ReadingCanvasNative>
    </PageNative>
    <BottomSheet isPresented={purchaseSheet !== null} onIsPresentedChange={(value) => { if (!value) setPurchaseSheet(null); }} onDismiss={() => setPurchaseSheet(null)}>
      {purchaseSheet ? <PurchaseEditorNative key={purchaseSheet.purchase?.id ?? 'new'} purchase={purchaseSheet.purchase} defaultCardId={purchaseSheet.cardId} data={data} today={today} tokens={tokens} onSave={savePurchase} onDelete={deletePurchase} onClose={() => setPurchaseSheet(null)} /> : null}
    </BottomSheet>
    <BottomSheet isPresented={rateSheet} onIsPresentedChange={setRateSheet} onDismiss={() => setRateSheet(false)}>
      {rateSheet ? <RateSheetNative settings={data.rate} tokens={tokens} onSave={saveRate} onClose={() => setRateSheet(false)} /> : null}
    </BottomSheet>
    <BottomSheet isPresented={cardSheet !== null} onIsPresentedChange={(value) => { if (!value) setCardSheet(null); }} onDismiss={() => setCardSheet(null)}>
      {cardSheet ? <CardEditorNative key={cardSheet.card?.id ?? 'new'} card={cardSheet.card} tokens={tokens} onSave={saveCard} onDelete={deleteCard} onClose={() => setCardSheet(null)} /> : null}
    </BottomSheet>
  </ZStack>;
}

// A text field that owns its native text state, for rows created on the fly.
function SheetFieldNative({ initial, placeholder, label, keyboard, width, align, style, onChange }: { initial: string; placeholder: string; label: string; keyboard?: 'decimal-pad' | 'numeric'; width?: number; align?: 'leading' | 'trailing'; style?: ViewModifier[]; onChange: (value: string) => void }) {
  const state = useNativeState(initial);
  return <TextField text={state} onTextChange={(value) => { state.set(value); onChange(value); }} placeholder={placeholder} modifiers={[
    textFieldStyle('plain'),
    ...(style ?? [font({ textStyle: 'body' })]),
    ...(keyboard ? [keyboardType(keyboard)] : []),
    ...(width ? [frame({ width })] : []),
    ...(align === 'trailing' ? [multilineTextAlignment('trailing')] : []),
    accessibilityLabel(label),
  ]} />;
}

function SheetHeaderNative({ title, tokens, saving, onClose, onSave }: { title: string; tokens: ThemeTokens; saving: boolean; onClose: () => void; onSave: () => void }) {
  return <HStack spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
    <NativeCircleButton tokens={tokens} label="Cancelar" systemName="xmark" onPress={onClose} disabled={saving} />
    <Spacer />
    <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
    <Spacer />
    <NativeCircleButton tokens={tokens} accent label={saving ? 'Guardando' : 'Guardar'} systemName="checkmark" onPress={onSave} busy={saving} />
  </HStack>;
}

function confirmDiscard(dirty: boolean, onClose: () => void, what: string) {
  if (!dirty) return onClose();
  Alert.alert('¿Descartar cambios?', `Los cambios de ${what} no se han guardado.`, [
    { text: 'Seguir editando', style: 'cancel' },
    { text: 'Descartar cambios', style: 'destructive', onPress: onClose },
  ]);
}

function centsText(cents: number | null) {
  return cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : '';
}

function PurchaseEditorNative({ purchase, defaultCardId, data, today, tokens, onSave, onDelete, onClose }: { purchase: Purchase | null; defaultCardId: string | null; data: CardsData; today: ISODate; tokens: ThemeTokens; onSave: (purchase: Purchase) => Promise<string | null>; onDelete: (id: string) => Promise<string | null>; onClose: () => void }) {
  const { width: screenWidth } = useWindowDimensions();
  const available = (card: CreditCard) => creditUse(card, data.purchases, data.payments, today, effectiveRate(data.rate)).availableCents;
  const [initial] = useState<Purchase>(() => purchase ?? {
    id: makeCardsId(),
    cardId: defaultCardId ?? data.cards[0]?.id ?? '',
    title: '',
    category: 'other',
    currency: 'PEN',
    cents: 0,
    penCents: null,
    date: today,
    installments: 1,
    recurring: false,
    endedOn: null,
  });
  const [amountText, setAmountText] = useState(centsText(initial.cents));
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState<SpendCategory>(initial.category);
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [chargedText, setChargedText] = useState(centsText(initial.penCents));
  const [cardId, setCardId] = useState(initial.cardId);
  const [date, setDate] = useState(initial.date);
  const [installments, setInstallments] = useState(initial.installments);
  const [recurring, setRecurring] = useState(initial.recurring);
  const [endedOn, setEndedOn] = useState(initial.endedOn);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const amountState = useNativeState(amountText);
  const titleState = useNativeState(initial.title);
  const amountInput = useRef<TextFieldRef>(null);
  const titleInput = useRef<TextFieldRef>(null);

  const cents = parseMoney(amountText);
  const card = data.cards.find((item) => item.id === cardId) ?? null;
  const dirty = amountText !== centsText(initial.cents) || currency !== initial.currency || chargedText !== centsText(initial.penCents) || title !== initial.title || category !== initial.category || cardId !== initial.cardId || date !== initial.date || installments !== initial.installments || recurring !== initial.recurring || endedOn !== initial.endedOn;
  const ranked = bestCardsFor(data.cards, category, available);
  const best = data.cards.length > 1 && cashbackRate(ranked[0], category) > cashbackRate(ranked[ranked.length - 1], category) ? ranked[0].id : null;
  const cycle = card ? cycleFor(card, date) : null;
  // A dollar purchase takes the soles the bank converted it to, typed now or
  // later when the statement shows them.
  const dollars = currency === 'USD';
  const charged = dollars && chargedText.trim() ? parseMoney(chargedText) : null;
  const solesCents = cents ? (dollars ? charged ?? (effectiveRate(data.rate) ? Math.round(cents * (effectiveRate(data.rate) ?? 0)) : null) : cents) : null;
  const earn = card && solesCents ? Math.round((solesCents * cashbackRate(card, category)) / 100) : 0;
  const share = cents && installments > 1 ? installmentCents(cents, installments)[0] : null;

  const blurAll = () => {
    void amountInput.current?.blur();
    void titleInput.current?.blur();
  };

  const save = async () => {
    if (saving) return;
    blurAll();
    if (!cents) return setError('Escribe el monto.');
    if (!card) return setError('Elige una tarjeta.');
    if (dollars && chargedText.trim() && !charged) return setError('El monto en soles no es válido.');
    setSaving(true);
    const message = await onSave({ ...initial, cardId, title: title.trim(), category, currency, cents, penCents: dollars ? charged : null, date, installments: recurring ? 1 : installments, recurring, endedOn: recurring ? endedOn : null });
    setSaving(false);
    if (message) setError(message);
  };

  const chips: FilterChip[] = CATEGORIES.map((item) => ({ key: item.key, label: item.label, symbol: CATEGORY_STYLES[item.key].symbol, selected: item.key === category, onPress: () => setCategory(item.key) }));

  return <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible'), interactiveDismissDisabled(dirty || saving)]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(tokens.background)]}>
      <SheetHeaderNative title={purchase ? 'Editar gasto' : 'Nuevo gasto'} tokens={tokens} saving={saving} onClose={() => confirmDiscard(dirty, onClose, 'este gasto')} onSave={() => void save()} />
      {error ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.danger, style: 'callout', weight: 'semibold' }), frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: SHEET_ACTION_INSET, bottom: 12 })]}>{error}</NativeText> : null}
      <Form modifiers={[scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), listStyle('insetGrouped'), scrollDismissesKeyboard('immediately'), disabled(saving)]}>
        <Section>
          <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 6 })]}>
            <NativeText modifiers={[foregroundStyle(tokens.secondary), font({ size: 28, weight: 'bold', design: 'rounded' }), contentTransition('interpolate'), animation(Animation.spring({ duration: 0.3 }), currency === 'USD')]}>{CURRENCY_SYMBOLS[currency]}</NativeText>
            <TextField ref={amountInput} text={amountState} autoFocus={!purchase} onTextChange={(value) => { amountState.set(value); setAmountText(value); setError(null); }} placeholder="0.00" modifiers={[font({ size: 44, weight: 'heavy', design: 'rounded' }), monospacedDigit(), textFieldStyle('plain'), keyboardType('decimal-pad'), accessibilityLabel('Monto')]} />
          </HStack>
          <Picker selection={currency} onSelectionChange={(value) => setCurrency(value as Currency)} modifiers={[pickerStyle('segmented'), accessibilityLabel('Moneda')]}>
            <NativeText modifiers={[tag('PEN')]}>Soles</NativeText>
            <NativeText modifiers={[tag('USD')]}>Dólares</NativeText>
          </Picker>
          {dollars ? <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>En soles</NativeText>
            <Spacer />
            <SheetFieldNative initial={chargedText} placeholder={cents && effectiveRate(data.rate) ? `≈ ${formatMoney(Math.round(cents * (effectiveRate(data.rate) ?? 0)))}` : 'Pendiente'} label="Monto en soles que cobró el banco, opcional" keyboard="decimal-pad" width={130} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={setChargedText} />
          </HStack> : null}
          <TextField ref={titleInput} text={titleState} onTextChange={(value) => { titleState.set(value); setTitle(value); }} placeholder={categoryLabel(category)} modifiers={[font({ textStyle: 'body', weight: 'semibold' }), textFieldStyle('plain'), padding({ vertical: 4 }), accessibilityLabel('Descripción, opcional'), submitLabel('done'), onSubmit(() => void titleInput.current?.blur())]} />
        </Section>
        <Section title="Categoría">
          <FilterChipsNative chips={chips} width={Math.min(screenWidth, UI.contentWidth) - 72} tokens={tokens} />
        </Section>
        <Section title="Tarjeta">
          {data.cards.map((item) => {
            const rate = cashbackRate(item, category);
            const chosen = item.id === cardId;
            return <NativeButton key={item.id} onPress={() => setCardId(item.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${item.name}${rate ? `, ${percentLabel(rate)} de cashback` : ''}${item.id === best ? ', la que más devuelve' : ''}`), ...(chosen ? [accessibilityAddTraits(['isSelected'])] : [])]}>
              <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 2 }), contentShape(shapes.rectangle())]}>
                <CardThumbNative card={item} />
                <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <NativeText modifiers={[...textModifiers(tokens, { style: 'body', weight: chosen ? 'semibold' : 'regular' }), lineLimit(1)]}>{item.name}</NativeText>
                  <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit(), lineLimit(1)]}>{`${formatMoney(available(item), { decimals: false })} disponible`}</NativeText>
                </VStack>
                {rate ? <HStack alignment="center" spacing={4} modifiers={[padding({ horizontal: 8, vertical: 4 }), background(item.id === best ? withAlpha(PAID[tokens.mode], 0.16) : tokens.mode === 'dark' ? '#FFFFFF14' : '#0000000A'), clipShape('capsule')]}>
                  {item.id === best ? <NativeImage systemName="star.fill" modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(PAID[tokens.mode])]} /> : null}
                  <NativeText modifiers={[foregroundStyle(item.id === best ? PAID[tokens.mode] : tokens.secondary), font({ textStyle: 'caption', weight: 'semibold' }), monospacedDigit()]}>{percentLabel(rate)}</NativeText>
                </HStack> : null}
                <VStack modifiers={[frame({ width: 20 })]}>{chosen ? <SymbolImage name="checkmark" color={tokens.blue} size={17} /> : null}</VStack>
              </HStack>
            </NativeButton>;
          })}
        </Section>
        <Section title="Pago">
          <DatePicker title="Fecha" selection={isoToDate(date)} displayedComponents={['date']} onDateChange={(value) => setDate(todayISO(value))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
          <Toggle label="Mensual" isOn={recurring} onIsOnChange={(value) => { setRecurring(value); if (value) setInstallments(1); }} />
          {!recurring ? <Stepper label={installments === 1 ? 'Sin cuotas' : share ? `${installments} cuotas de ${formatMoney(share, { currency })}` : `${installments} cuotas`} value={installments} min={1} max={36} onValueChange={(value) => setInstallments(Math.round(value))} /> : null}
          {cycle ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit()]}>{[
            recurring ? `Cada mes el ${isoToDate(date).getDate()}` : null,
            `${installments > 1 && !recurring ? 'Primera cuota' : 'Se paga'} el ${dayMonth(cycle.due, true)}`,
            earn ? `cashback ${formatMoney(earn)}` : null,
          ].filter(Boolean).join(' · ')}</NativeText> : null}
          {purchase?.recurring && recurring ? (endedOn
            ? <NativeButton label="Reanudar cargo mensual" systemImage="arrow.clockwise" onPress={() => setEndedOn(null)} modifiers={[buttonStyle('borderless')]} />
            : <NativeButton label="Dejar de cobrar desde hoy" systemImage="stop.circle" onPress={() => setEndedOn(today)} modifiers={[buttonStyle('borderless')]} />) : null}
          {endedOn && recurring ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{`Último cargo antes del ${dayMonth(endedOn)}`}</NativeText> : null}
        </Section>
        {purchase ? <Section>
          <ConfirmationDialog title="Eliminar gasto" isPresented={confirmDelete} onIsPresentedChange={setConfirmDelete}>
            <ConfirmationDialog.Trigger>
              <NativeButton label="Eliminar gasto" systemImage="trash" role="destructive" onPress={() => setConfirmDelete(true)} modifiers={[buttonStyle('borderless'), tint(tokens.danger)]} />
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Message><NativeText>{purchase.recurring ? 'Se eliminarán todos sus cargos mensuales.' : purchase.installments > 1 ? 'Se eliminarán todas sus cuotas.' : 'El gasto se quitará de la tarjeta.'}</NativeText></ConfirmationDialog.Message>
            <ConfirmationDialog.Actions>
              <NativeButton label="Eliminar" role="destructive" onPress={() => { setConfirmDelete(false); void onDelete(purchase.id).then((message) => message && setError(message)); }} />
              <NativeButton label="Cancelar" role="cancel" onPress={() => setConfirmDelete(false)} />
            </ConfirmationDialog.Actions>
          </ConfirmationDialog>
        </Section> : null}
      </Form>
    </VStack>
  </Group>;
}

type RuleDraft = { uid: string; category: SpendCategory; percent: string; cap: string };
type LimitDraft = { uid: string; category: SpendCategory; amount: string };

const DAY_NUMBERS = Array.from({ length: 31 }, (_, index) => index + 1);

function CategoryMenuNative({ value, onChange }: { value: SpendCategory; onChange: (value: SpendCategory) => void }) {
  return <Picker selection={value} onSelectionChange={(next) => onChange(next as SpendCategory)} modifiers={[pickerStyle('menu'), accessibilityLabel('Categoría')]}>
    {CATEGORIES.map((item) => <NativeText key={item.key} modifiers={[tag(item.key)]}>{item.label}</NativeText>)}
  </Picker>;
}

function RemoveRowButton({ label, tokens, onPress }: { label: string; tokens: ThemeTokens; onPress: () => void }) {
  return <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}>
    <ZStack alignment="center" modifiers={[frame({ width: 32, height: 32 }), contentShape(shapes.circle())]}>
      <NativeImage systemName="minus.circle.fill" modifiers={[font({ size: 20 }), foregroundStyle(tokens.danger)]} />
    </ZStack>
  </NativeButton>;
}

function CardEditorNative({ card, tokens, onSave, onDelete, onClose }: { card: CreditCard | null; tokens: ThemeTokens; onSave: (card: CreditCard, previousImage: string | null) => Promise<string | null>; onDelete: (card: CreditCard) => Promise<string | null>; onClose: () => void }) {
  const { width: screenWidth } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [initial] = useState<CreditCard>(() => card ?? {
    id: makeCardsId(),
    name: '',
    network: 'visa',
    last4: '',
    design: 'graphite',
    image: null,
    dualCurrency: false,
    limitCents: 0,
    budgetCents: null,
    closingDay: 25,
    dueDay: 12,
    baseCashback: 0,
    cashback: [],
    categoryLimits: [],
  });
  const [name, setName] = useState(initial.name);
  const [last4, setLast4] = useState(initial.last4);
  const [network, setNetwork] = useState<CardNetwork>(initial.network);
  const [design, setDesign] = useState(initial.design);
  const [image, setImage] = useState(initial.image);
  const [dualCurrency, setDualCurrency] = useState(initial.dualCurrency);
  const [limitText, setLimitText] = useState(centsText(initial.limitCents));
  const [budgetText, setBudgetText] = useState(centsText(initial.budgetCents));
  const [closingDay, setClosingDay] = useState(initial.closingDay);
  const [dueDay, setDueDay] = useState(initial.dueDay);
  const [baseText, setBaseText] = useState(initial.baseCashback ? String(initial.baseCashback) : '');
  const [rules, setRules] = useState<RuleDraft[]>(() => initial.cashback.map((rule) => ({ uid: makeCardsId(), category: rule.category, percent: String(rule.percent), cap: centsText(rule.capCents) })));
  const [limits, setLimits] = useState<LimitDraft[]>(() => initial.categoryLimits.map((limit) => ({ uid: makeCardsId(), category: limit.category, amount: centsText(limit.cents) })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The preview card turns over a little each time its look changes.
  const [turns, setTurns] = useState(0);
  const pickedImages = useRef<string[]>([]);
  const nameState = useNativeState(initial.name);
  const last4State = useNativeState(initial.last4);

  const restyle = (change: () => void) => {
    change();
    setTurns((value) => value + 1);
  };

  const dirty = name !== initial.name || last4 !== initial.last4 || network !== initial.network || design !== initial.design || image !== initial.image || dualCurrency !== initial.dualCurrency
    || limitText !== centsText(initial.limitCents) || budgetText !== centsText(initial.budgetCents) || closingDay !== initial.closingDay || dueDay !== initial.dueDay
    || baseText !== (initial.baseCashback ? String(initial.baseCashback) : '') || rules.length !== initial.cashback.length || limits.length !== initial.categoryLimits.length
    || rules.some((rule, index) => rule.category !== initial.cashback[index]?.category || rule.percent !== String(initial.cashback[index]?.percent) || rule.cap !== centsText(initial.cashback[index]?.capCents ?? null))
    || limits.some((limit, index) => limit.category !== initial.categoryLimits[index]?.category || limit.amount !== centsText(initial.categoryLimits[index]?.cents ?? null));

  // Photos picked in this session but not kept are removed on leaving.
  const close = () => {
    for (const uri of pickedImages.current) if (uri !== initial.image) void deleteCardImage(uri);
    onClose();
  };

  const pickImage = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (uri) {
        const kept = await keepCardImage(uri, initial.id);
        pickedImages.current.push(kept);
        restyle(() => setImage(kept));
      }
    } catch {
      setError('No se pudo usar esa imagen.');
    } finally {
      setPicking(false);
    }
  };

  const percent = (text: string) => {
    const value = Number(text.replace(',', '.').replace('%', '').trim());
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  };

  const save = async () => {
    if (saving) return;
    const cleanName = name.trim();
    if (!cleanName) return setError('Escribe el nombre de la tarjeta.');
    const limitCents = limitText.trim() ? parseMoney(limitText) : 0;
    if (limitCents === null) return setError('La línea de crédito no es un monto válido.');
    const budgetCents = budgetText.trim() ? parseMoney(budgetText) : null;
    if (budgetText.trim() && !budgetCents) return setError('El presupuesto no es un monto válido.');
    const base = baseText.trim() ? percent(baseText) : 0;
    if (base === null) return setError('El cashback base debe ser un porcentaje.');
    const cashback: CashbackRule[] = [];
    for (const rule of rules) {
      const value = percent(rule.percent);
      if (value === null || !rule.percent.trim()) return setError(`Escribe el porcentaje de ${categoryLabel(rule.category)}.`);
      const cap = rule.cap.trim() ? parseMoney(rule.cap) : null;
      if (rule.cap.trim() && cap === null) return setError(`El tope de ${categoryLabel(rule.category)} no es un monto válido.`);
      if (!cashback.some((item) => item.category === rule.category)) cashback.push({ category: rule.category, percent: value, capCents: cap });
    }
    const categoryLimits: CreditCard['categoryLimits'] = [];
    for (const limit of limits) {
      const cents = parseMoney(limit.amount);
      if (!cents) return setError(`Escribe el límite de ${categoryLabel(limit.category)}.`);
      if (!categoryLimits.some((item) => item.category === limit.category)) categoryLimits.push({ category: limit.category, cents });
    }
    setSaving(true);
    const message = await onSave({ id: initial.id, name: cleanName, network, last4: last4.replace(/\D/g, '').slice(0, 4), design, image, dualCurrency, limitCents, budgetCents, closingDay, dueDay, baseCashback: base, cashback, categoryLimits }, initial.image);
    setSaving(false);
    if (message) return setError(message);
    for (const uri of pickedImages.current) if (uri !== image) void deleteCardImage(uri);
  };

  const previewWidth = Math.min(screenWidth, UI.contentWidth) - SHEET_ACTION_INSET * 2 - 40;
  const preview = { name, network, last4, design, image };
  const cycle = cycleFor({ closingDay, dueDay }, todayISO());
  const swatchRows = [CARD_DESIGNS.slice(0, 6), CARD_DESIGNS.slice(6)];

  return <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible'), interactiveDismissDisabled(dirty || saving)]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(tokens.background)]}>
      <SheetHeaderNative title={card ? 'Editar tarjeta' : 'Nueva tarjeta'} tokens={tokens} saving={saving} onClose={() => confirmDiscard(dirty, close, 'esta tarjeta')} onSave={() => void save()} />
      {error ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.danger, style: 'callout', weight: 'semibold' }), frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: SHEET_ACTION_INSET, bottom: 12 })]}>{error}</NativeText> : null}
      <Form modifiers={[scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), listStyle('insetGrouped'), scrollDismissesKeyboard('immediately'), disabled(saving)]}>
        <Section>
          <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 8 }), listRowBackground('#00000000'), listRowInsets({ leading: 0, trailing: 0 })]}>
            <ZStack modifiers={[
              shadow({ radius: 16, y: 8, color: '#00000040' }),
              ...(reduceMotion ? [] : [rotation3DEffect({ angle: turns % 2 ? 360 : 0, axis: { y: 1 }, perspective: 0.4 })]),
              animation(reduceMotion ? Animation.easeOut({ duration: 0.15 }) : Animation.spring({ response: 0.7, dampingFraction: 0.78 }), turns),
              accessibilityElement('ignore'),
              accessibilityLabel(`Vista previa: ${name || 'Tarjeta'}, diseño ${cardDesign(design).label}`),
            ]}>
              <CardFaceNative card={preview} width={previewWidth} />
            </ZStack>
          </ZStack>
        </Section>
        <Section title="Tarjeta">
          <TextField text={nameState} onTextChange={(value) => { nameState.set(value); setName(value); }} placeholder="Interbank Visa" modifiers={[font({ textStyle: 'title3', weight: 'semibold' }), textFieldStyle('plain'), padding({ vertical: 4 }), accessibilityLabel('Nombre de la tarjeta')]} />
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>Últimos 4</NativeText>
            <Spacer />
            <TextField text={last4State} maxLength={4} onTextChange={(value) => { const digits = value.replace(/\D/g, '').slice(0, 4); last4State.set(digits); setLast4(digits); }} placeholder="4114" modifiers={[font({ textStyle: 'body', design: 'monospaced' }), textFieldStyle('plain'), keyboardType('numeric'), multilineTextAlignment('trailing'), frame({ width: 90 }), accessibilityLabel('Últimos cuatro dígitos, opcional')]} />
          </HStack>
          <Picker selection={network} onSelectionChange={(value) => setNetwork(value as CardNetwork)} modifiers={[pickerStyle('segmented'), accessibilityLabel('Red')]}>
            {CARD_NETWORKS.map((item) => <NativeText key={item.key} modifiers={[tag(item.key)]}>{item.label}</NativeText>)}
          </Picker>
        </Section>
        <Section title="Diseño">
          <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 4 })]}>
            {swatchRows.map((row, rowIndex) => <HStack key={rowIndex} alignment="center" spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
              {row.map((item) => {
                const chosen = item.key === design;
                return <NativeButton key={item.key} onPress={() => restyle(() => setDesign(item.key))} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, minHeight: 44 }), accessibilityLabel(item.label), ...(chosen ? [accessibilityAddTraits(['isSelected'])] : [])]}>
                  <ZStack alignment="center" modifiers={[frame({ width: 40, height: 40 }), contentShape(shapes.circle())]}>
                    <VStack modifiers={[frame({ width: 34, height: 34 }), background(item.colors[1]), clipShape('circle'), ...(item.ink === '#FFFFFF' ? [] : [strokeBorder({ content: tokens.border, shape: 'circle' })])]}>{null}</VStack>
                    {chosen ? <NativeImage systemName="checkmark" modifiers={[font({ size: 14, weight: 'bold' }), foregroundStyle(item.ink)]} /> : null}
                  </ZStack>
                </NativeButton>;
              })}
            </HStack>)}
          </VStack>
          <NativeButton label={image ? 'Cambiar imagen' : 'Usar imagen'} systemImage="photo" onPress={() => void pickImage()} modifiers={[buttonStyle('borderless'), disabled(picking)]} />
          {image ? <NativeButton label="Quitar imagen" systemImage="xmark.circle" role="destructive" onPress={() => restyle(() => setImage(null))} modifiers={[buttonStyle('borderless'), tint(tokens.danger)]} /> : null}
        </Section>
        <Section title="Moneda">
          <Toggle label="Estado de cuenta bimoneda" isOn={dualCurrency} onIsOnChange={setDualCurrency} />
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{dualCurrency ? 'Los consumos en dólares se deben y se pagan en dólares.' : 'Los consumos en dólares se cobran convertidos a soles.'}</NativeText>
        </Section>
        <Section title="Ciclo">
          <Picker label="Cierre" selection={closingDay} onSelectionChange={(value) => setClosingDay(Number(value))} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
            {DAY_NUMBERS.map((value) => <NativeText key={value} modifiers={[tag(value)]}>{`Día ${value}`}</NativeText>)}
          </Picker>
          <Picker label="Último día de pago" selection={dueDay} onSelectionChange={(value) => setDueDay(Number(value))} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
            {DAY_NUMBERS.map((value) => <NativeText key={value} modifiers={[tag(value)]}>{`Día ${value}`}</NativeText>)}
          </Picker>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit()]}>{`Ciclo actual: ${cycleRange(cycle)} · se paga el ${dayMonth(cycle.due)}`}</NativeText>
        </Section>
        <Section title="Montos">
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>Línea de crédito</NativeText>
            <Spacer />
            <SheetFieldNative initial={limitText} placeholder="S/ 0" label="Línea de crédito" keyboard="decimal-pad" width={130} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={setLimitText} />
          </HStack>
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>Presupuesto por ciclo</NativeText>
            <Spacer />
            <SheetFieldNative initial={budgetText} placeholder="Sin límite" label="Presupuesto por ciclo, opcional" keyboard="decimal-pad" width={130} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={setBudgetText} />
          </HStack>
        </Section>
        <Section title="Cashback">
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <NativeText modifiers={textModifiers(tokens, { style: 'body' })}>Todas las compras</NativeText>
            <Spacer />
            <SheetFieldNative initial={baseText} placeholder="0" label="Cashback en todas las compras, porcentaje" keyboard="decimal-pad" width={60} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={setBaseText} />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>%</NativeText>
          </HStack>
          {rules.map((rule) => <HStack key={rule.uid} alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
            <RemoveRowButton label={`Quitar ${categoryLabel(rule.category)}`} tokens={tokens} onPress={() => setRules((current) => current.filter((item) => item.uid !== rule.uid))} />
            <CategoryMenuNative value={rule.category} onChange={(category) => setRules((current) => current.map((item) => (item.uid === rule.uid ? { ...item, category } : item)))} />
            <Spacer />
            <SheetFieldNative initial={rule.percent} placeholder="0" label={`Porcentaje en ${categoryLabel(rule.category)}`} keyboard="decimal-pad" width={44} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={(value) => setRules((current) => current.map((item) => (item.uid === rule.uid ? { ...item, percent: value } : item)))} />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>%</NativeText>
            <SheetFieldNative initial={rule.cap} placeholder="Tope" label={`Tope por ciclo en ${categoryLabel(rule.category)}, opcional`} keyboard="decimal-pad" width={64} align="trailing" style={[font({ textStyle: 'footnote' }), monospacedDigit()]} onChange={(value) => setRules((current) => current.map((item) => (item.uid === rule.uid ? { ...item, cap: value } : item)))} />
          </HStack>)}
          <NativeButton label="Añadir categoría" systemImage="plus.circle" onPress={() => setRules((current) => [...current, { uid: makeCardsId(), category: CATEGORIES.find((item) => !current.some((rule) => rule.category === item.key))?.key ?? 'other', percent: '', cap: '' }])} modifiers={[buttonStyle('borderless')]} />
        </Section>
        <Section title="Límites por categoría">
          {limits.map((limit) => <HStack key={limit.uid} alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
            <RemoveRowButton label={`Quitar límite de ${categoryLabel(limit.category)}`} tokens={tokens} onPress={() => setLimits((current) => current.filter((item) => item.uid !== limit.uid))} />
            <CategoryMenuNative value={limit.category} onChange={(category) => setLimits((current) => current.map((item) => (item.uid === limit.uid ? { ...item, category } : item)))} />
            <Spacer />
            <SheetFieldNative initial={limit.amount} placeholder="S/ 0" label={`Límite por ciclo en ${categoryLabel(limit.category)}`} keyboard="decimal-pad" width={100} align="trailing" style={[font({ textStyle: 'body', weight: 'semibold' }), monospacedDigit()]} onChange={(value) => setLimits((current) => current.map((item) => (item.uid === limit.uid ? { ...item, amount: value } : item)))} />
          </HStack>)}
          <NativeButton label="Añadir límite" systemImage="plus.circle" onPress={() => setLimits((current) => [...current, { uid: makeCardsId(), category: CATEGORIES.find((item) => !current.some((limit) => limit.category === item.key))?.key ?? 'other', amount: '' }])} modifiers={[buttonStyle('borderless')]} />
        </Section>
        {card ? <Section>
          <ConfirmationDialog title="Eliminar tarjeta" isPresented={confirmDelete} onIsPresentedChange={setConfirmDelete}>
            <ConfirmationDialog.Trigger>
              <NativeButton label="Eliminar tarjeta" systemImage="trash" role="destructive" onPress={() => setConfirmDelete(true)} modifiers={[buttonStyle('borderless'), tint(tokens.danger)]} />
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Message><NativeText>{`Se eliminarán “${card.name}”, sus gastos y sus pagos.`}</NativeText></ConfirmationDialog.Message>
            <ConfirmationDialog.Actions>
              <NativeButton label="Eliminar" role="destructive" onPress={() => { setConfirmDelete(false); void onDelete(card).then((message) => message && setError(message)); }} />
              <NativeButton label="Cancelar" role="cancel" onPress={() => setConfirmDelete(false)} />
            </ConfirmationDialog.Actions>
          </ConfirmationDialog>
        </Section> : null}
      </Form>
    </VStack>
  </Group>;
}

// Hoy names what needs attention: statements due within a week (or late),
// and cards past 80 % of their budget.
export function CardsTodayNative({ tokens, now, onOpen }: { tokens: ThemeTokens; now: Date; onOpen: (cardId: string) => void }) {
  const { ready, failed, data } = useCards();
  if (!ready || failed || !data.cards.length) return null;
  const today = todayISO(now);
  const rows: Array<{ key: string; card: CreditCard; title: string; detail: string; color: ColorValue }> = [];
  for (const card of data.cards) {
    for (const statement of unpaidStatements(card, data.purchases, data.payments, today)) {
      const days = daysBetween(today, statement.due);
      if (days > 7) continue;
      rows.push({ key: `${card.id}:${statement.close}`, card, title: `Pagar ${formatAmounts(statement.balance)}`, detail: `${card.name} · ${statementLine(statement, today)}`, color: statement.status === 'overdue' ? tokens.danger : days <= 3 ? WARNING[tokens.mode] : tokens.secondary });
    }
    if (card.budgetCents) {
      const summary = cycleSummary(card, data.purchases, closingFor(card.closingDay, today), today, effectiveRate(data.rate));
      const used = summary.spentCents / card.budgetCents;
      if (used >= 0.8) rows.push({ key: `${card.id}:budget`, card, title: `${Math.round(used * 100)} % del presupuesto`, detail: `${card.name} · ${formatMoney(summary.spentCents, { decimals: false })} de ${formatMoney(card.budgetCents, { decimals: false })}, cierra ${dayLabel(summary.daysLeft)}`, color: used >= 1 ? tokens.danger : WARNING[tokens.mode] });
    }
  }
  if (!rows.length) return null;
  return <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title="Tarjetas" tokens={tokens} />
    <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
      {rows.slice(0, 4).map((row) => <NativeButton key={row.key} onPress={() => onOpen(row.card.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${row.title}, ${row.detail}`)]}>
        <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
          <CardThumbNative card={row.card} />
          <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{row.title}</NativeText>
            <NativeText modifiers={[...textModifiers(tokens, { color: row.color, style: 'subheadline' }), monospacedDigit(), lineLimit(2)]}>{row.detail}</NativeText>
          </VStack>
          <SymbolImage name="chevron.right" color={tokens.secondary} size={17} />
        </HStack>
      </NativeButton>)}
    </VStack>
  </VStack>;
}

// Biblioteca's line for Tarjetas: the open cycles' spending and the nearest payment.
export function useCardsLibraryDetail() {
  const { ready, failed, data } = useCards();
  const now = useCurrentTime();
  if (!ready) return 'Cargando…';
  if (failed) return 'No disponible';
  if (!data.cards.length) return 'Gastos y pagos';
  const today = todayISO(now);
  const spent = data.cards.reduce((total, card) => total + cycleSummary(card, data.purchases, closingFor(card.closingDay, today), today, effectiveRate(data.rate)).spentCents, 0);
  const next = data.cards.flatMap((card) => unpaidStatements(card, data.purchases, data.payments, today)).sort((a, b) => a.due.localeCompare(b.due))[0];
  const due = next ? (next.status === 'overdue' ? 'pago vencido' : `pagar ${dayLabel(daysBetween(today, next.due))}`) : null;
  return [`${formatMoney(spent, { decimals: false })} este ciclo`, due].filter(Boolean).join(' · ');
}
