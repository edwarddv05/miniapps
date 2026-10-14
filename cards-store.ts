import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useSyncExternalStore } from 'react';
import { CATEGORIES, DEFAULT_RATE_SETTINGS, todayISO, type CardNetwork, type CashbackRule, type CreditCard, type Currency, type Payment, type Purchase, type RateSettings, type SpendCategory } from './cards-data';

// The owner's cards, purchases and payments, kept on the phone in one store
// shared by the Tarjetas miniapp, Biblioteca and Hoy.

export type CardsData = { cards: CreditCard[]; purchases: Purchase[]; payments: Payment[]; rate: RateSettings };
type CardsState = { ready: boolean; failed: boolean; data: CardsData };

export const CARDS_KEY = '@miniapps/cards';
const EMPTY: CardsData = { cards: [], purchases: [], payments: [], rate: DEFAULT_RATE_SETTINGS };
const NETWORKS: CardNetwork[] = ['visa', 'mastercard', 'amex', 'diners'];
const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((item) => item.key));

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const currency = (value: unknown): Currency => (value === 'USD' ? 'USD' : 'PEN');
const isCategory = (value: unknown): value is SpendCategory => typeof value === 'string' && CATEGORY_KEYS.has(value);
const day = (value: unknown, fallback: number) => (typeof value === 'number' && value >= 1 && value <= 31 ? Math.round(value) : fallback);

function validCard(value: any): CreditCard | null {
  if (typeof value?.id !== 'string' || typeof value?.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    network: NETWORKS.includes(value.network) ? value.network : 'visa',
    last4: typeof value.last4 === 'string' ? value.last4.replace(/\D/g, '').slice(0, 4) : '',
    design: typeof value.design === 'string' ? value.design : 'graphite',
    image: typeof value.image === 'string' ? value.image : null,
    dualCurrency: value.dualCurrency === true,
    limitCents: isCents(value.limitCents) ? value.limitCents : 0,
    budgetCents: isCents(value.budgetCents) ? value.budgetCents : null,
    closingDay: day(value.closingDay, 25),
    dueDay: day(value.dueDay, 12),
    baseCashback: typeof value.baseCashback === 'number' && value.baseCashback >= 0 ? value.baseCashback : 0,
    cashback: Array.isArray(value.cashback)
      ? value.cashback.filter((rule: any) => isCategory(rule?.category) && typeof rule?.percent === 'number').map((rule: any): CashbackRule => ({ category: rule.category, percent: rule.percent, capCents: isCents(rule.capCents) ? rule.capCents : null }))
      : [],
    categoryLimits: Array.isArray(value.categoryLimits)
      ? value.categoryLimits.filter((limit: any) => isCategory(limit?.category) && isCents(limit?.cents)).map((limit: any) => ({ category: limit.category, cents: limit.cents }))
      : [],
  };
}

function validPurchase(value: any): Purchase | null {
  if (typeof value?.id !== 'string' || typeof value?.cardId !== 'string' || !isCents(value?.cents) || !isDate(value?.date)) return null;
  return {
    id: value.id,
    cardId: value.cardId,
    title: typeof value.title === 'string' ? value.title : '',
    category: isCategory(value.category) ? value.category : 'other',
    currency: currency(value.currency),
    cents: value.cents,
    // Earlier versions called the converted soles chargedPenCents.
    penCents: value.currency === 'USD' && isCents(value.penCents ?? value.chargedPenCents) ? (value.penCents ?? value.chargedPenCents) : null,
    date: value.date,
    installments: typeof value.installments === 'number' && value.installments >= 1 ? Math.min(48, Math.round(value.installments)) : 1,
    recurring: value.recurring === true,
    endedOn: isDate(value.endedOn) ? value.endedOn : null,
  };
}

function validPayment(value: any): Payment | null {
  if (typeof value?.id !== 'string' || typeof value?.cardId !== 'string' || !isCents(value?.cents) || !isDate(value?.cycle) || !isDate(value?.date)) return null;
  return { id: value.id, cardId: value.cardId, cycle: value.cycle, currency: currency(value.currency), cents: value.cents, date: value.date };
}

const isRate = (value: unknown): value is number => typeof value === 'number' && value > 0.5 && value < 50;

function validRate(value: any): RateSettings {
  return {
    mode: value?.mode === 'manual' ? 'manual' : 'auto',
    market: isRate(value?.market) ? value.market : null,
    marketOn: typeof value?.marketOn === 'string' ? value.marketOn : null,
    marginPercent: typeof value?.marginPercent === 'number' && value.marginPercent >= 0 && value.marginPercent < 20 ? value.marginPercent : 0,
    manual: isRate(value?.manual) ? value.manual : null,
  };
}

export function parseCards(raw: string | null): CardsData {
  if (!raw) return EMPTY;
  const stored = JSON.parse(raw);
  const pick = <T,>(list: unknown, valid: (item: unknown) => T | null) => (Array.isArray(list) ? list.map(valid).filter((item): item is T => item !== null) : []);
  return { cards: pick(stored?.cards, validCard), purchases: pick(stored?.purchases, validPurchase), payments: pick(stored?.payments, validPayment), rate: validRate(stored?.rate) };
}

let state: CardsState = { ready: false, failed: false, data: EMPTY };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function emit(next: CardsState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadCards(retry = false) {
  if (!loading || retry) {
    loading = AsyncStorage.getItem(CARDS_KEY)
      .then((raw) => emit({ ready: true, failed: false, data: parseCards(raw) }))
      .catch(() => {
        // Stored data that cannot be read must not look like an empty wallet,
        // and nothing may be written over it.
        emit({ ready: true, failed: true, data: EMPTY });
      });
  }
  return loading;
}

export function useCards() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void loadCards();
  }, []);
  return current;
}

// Applies a change and stores it. Resolves false when it could not be saved;
// the change is then rolled back so the screen never shows unsaved data.
export async function updateCards(change: (data: CardsData) => CardsData): Promise<boolean> {
  await loadCards();
  if (state.failed) return false;
  const previous = state.data;
  const data = change(previous);
  emit({ ...state, data });
  try {
    await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(data));
    return true;
  } catch {
    emit({ ...state, data: previous });
    return false;
  }
}

export function makeCardsId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Card art picked from Photos is copied into the app's documents, so it
// survives the picker's temporary file being cleared.
export async function keepCardImage(uri: string, cardId: string) {
  if (!FileSystem.documentDirectory) throw new Error('storage');
  const directory = `${FileSystem.documentDirectory}cards/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
  const extension = /\.(png|jpe?g|heic|webp)$/i.exec(uri)?.[0] ?? '.jpg';
  const target = `${directory}${cardId}-${Date.now().toString(36)}${extension}`;
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

export async function deleteCardImage(uri: string | null) {
  if (!uri || !FileSystem.documentDirectory || !uri.startsWith(FileSystem.documentDirectory)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}


// The market rate (soles per dollar), from a free source with no key.
export async function fetchMarketRate(): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
    const body = await response.json();
    const rate = body?.rates?.PEN;
    if (!response.ok || !isRate(rate)) throw new Error('rate');
    return Math.round(rate * 1000) / 1000;
  } finally {
    clearTimeout(timer);
  }
}

// In automatic mode the market rate is asked at most once a day, and only
// while there are dollar purchases to estimate. A failed attempt is not
// repeated until the app restarts.
let triedOn: string | null = null;

export async function refreshMarketRateIfStale() {
  await loadCards();
  const { data, failed } = state;
  const today = todayISO();
  if (failed || data.rate.mode !== 'auto' || data.rate.marketOn === today || triedOn === today) return;
  if (!data.purchases.some((purchase) => purchase.currency === 'USD' && purchase.penCents === null)) return;
  triedOn = today;
  try {
    const market = await fetchMarketRate();
    await updateCards((current) => ({ ...current, rate: { ...current.rate, market, marketOn: today } }));
  } catch {
    // The last known rate stays in use.
  }
}
