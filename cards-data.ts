// Credit cards, their billing cycles and what has been spent on them. Pure
// logic with no storage, so it can be tested in Node. Money is kept in
// cents of its currency (integers) and dates as local calendar days, "2026-10-25".

export type ISODate = string;

export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'diners';

// Purchases are in soles or dollars. A dollar purchase keeps the soles the
// bank converted it to, once the owner knows them. Until then an exchange rate,
// when there is one, estimates them. A two-currency card (bimoneda) bills
// dollars in a dollar balance; another card bills the converted soles once
// known. Credit line, budgets, limits and cashback are in soles.
export type Currency = 'PEN' | 'USD';
export type Amounts = Record<Currency, number>;

export const NO_AMOUNTS: Amounts = { PEN: 0, USD: 0 };

export type SpendCategory =
  | 'supermarket'
  | 'restaurants'
  | 'delivery'
  | 'transport'
  | 'fuel'
  | 'shopping'
  | 'entertainment'
  | 'subscriptions'
  | 'travel'
  | 'health'
  | 'education'
  | 'services'
  | 'other';

export const CATEGORIES: Array<{ key: SpendCategory; label: string }> = [
  { key: 'supermarket', label: 'Supermercado' },
  { key: 'restaurants', label: 'Restaurantes' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'transport', label: 'Transporte' },
  { key: 'fuel', label: 'Combustible' },
  { key: 'shopping', label: 'Compras' },
  { key: 'entertainment', label: 'Entretenimiento' },
  { key: 'subscriptions', label: 'Suscripciones' },
  { key: 'travel', label: 'Viajes' },
  { key: 'health', label: 'Salud' },
  { key: 'education', label: 'Educación' },
  { key: 'services', label: 'Servicios' },
  { key: 'other', label: 'Otros' },
];

export function categoryLabel(key: SpendCategory) {
  return CATEGORIES.find((item) => item.key === key)?.label ?? 'Otros';
}

export type CashbackRule = { category: SpendCategory; percent: number; capCents: number | null };

export type CreditCard = {
  id: string;
  name: string;
  network: CardNetwork;
  last4: string;
  design: string;
  // A photo of the card's own art (a Wallet screenshot), copied into the app.
  image: string | null;
  // Bills dollar purchases in a separate dollar balance.
  dualCurrency: boolean;
  limitCents: number;
  // The owner's own spending cap per cycle; null when not set.
  budgetCents: number | null;
  closingDay: number;
  dueDay: number;
  baseCashback: number;
  cashback: CashbackRule[];
  categoryLimits: Array<{ category: SpendCategory; cents: number }>;
};

export type Purchase = {
  id: string;
  cardId: string;
  title: string;
  category: SpendCategory;
  currency: Currency;
  cents: number;
  // For a dollar purchase: the soles the bank converted it to, once known.
  penCents: number | null;
  date: ISODate;
  installments: number;
  // Charged again every month on the same day until `endedOn`.
  recurring: boolean;
  endedOn: ISODate | null;
};

export type Payment = { id: string; cardId: string; cycle: ISODate; currency: Currency; cents: number; date: ISODate };

// ─── Calendar days ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function parts(iso: ISODate) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

function isoFrom(y: number, m: number, d: number): ISODate {
  const date = new Date(Date.UTC(y, m, d));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dayNumber(iso: ISODate) {
  const { y, m, d } = parts(iso);
  return Math.round(Date.UTC(y, m, d) / DAY_MS);
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

// The given day of a month, or its last day when the month is shorter (31 → 30 Nov).
function clampedDay(y: number, m: number, day: number): ISODate {
  const first = new Date(Date.UTC(y, m, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  return isoFrom(year, month, Math.min(day, daysInMonth(year, month)));
}

export function todayISO(now = new Date()): ISODate {
  return isoFrom(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isoToDate(iso: ISODate) {
  const { y, m, d } = parts(iso);
  return new Date(y, m, d);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const { y, m, d } = parts(iso);
  return isoFrom(y, m, d + days);
}

export function daysBetween(from: ISODate, to: ISODate) {
  return dayNumber(to) - dayNumber(from);
}

// ─── Billing cycles ──────────────────────────────────────────────────────────

export type Cycle = { start: ISODate; close: ISODate; due: ISODate };

// The closing date of the cycle a purchase on `iso` belongs to: purchases up
// to and including the closing day go in that month's statement.
export function closingFor(closingDay: number, iso: ISODate): ISODate {
  const { y, m, d } = parts(iso);
  const thisMonth = clampedDay(y, m, closingDay);
  return d <= parts(thisMonth).d ? thisMonth : clampedDay(y, m + 1, closingDay);
}

export function shiftClose(close: ISODate, months: number, closingDay: number): ISODate {
  const { y, m } = parts(close);
  return clampedDay(y, m + months, closingDay);
}

// The last day to pay a statement without interest: the first payment day
// after it closes (closing 25, paying 12 → the 12th of the next month).
export function dueFor(close: ISODate, dueDay: number): ISODate {
  const { y, m, d } = parts(close);
  const sameMonth = clampedDay(y, m, dueDay);
  return parts(sameMonth).d > d ? sameMonth : clampedDay(y, m + 1, dueDay);
}

export function cycleEndingOn(card: Pick<CreditCard, 'closingDay' | 'dueDay'>, close: ISODate): Cycle {
  return { start: addDays(shiftClose(close, -1, card.closingDay), 1), close, due: dueFor(close, card.dueDay) };
}

export function cycleFor(card: Pick<CreditCard, 'closingDay' | 'dueDay'>, iso: ISODate): Cycle {
  return cycleEndingOn(card, closingFor(card.closingDay, iso));
}

// ─── Charges ─────────────────────────────────────────────────────────────────

export type Charge = {
  purchaseId: string;
  cardId: string;
  title: string;
  category: SpendCategory;
  // What the purchase cost, in the currency it was made in.
  currency: Currency;
  cents: number;
  // The balance it is billed in and the amount there: dollars on a
  // two-currency card, soles otherwise (dollars until the soles are known).
  billedCurrency: Currency;
  billedCents: number;
  // Its cost in soles: the bank's, an estimate at the exchange rate
  // (`estimated`), or null for dollars with neither.
  penCents: number | null;
  estimated: boolean;
  // The day it was bought (or, for a monthly charge, the day it recurs).
  date: ISODate;
  cycle: ISODate;
  installment: { index: number; count: number } | null;
  recurring: boolean;
};

export function installmentCents(total: number, count: number) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? total - base * (count - 1) : base));
}

function recurringDates(purchase: Purchase, through: ISODate): ISODate[] {
  const { y, m, d } = parts(purchase.date);
  const last = purchase.endedOn && purchase.endedOn < through ? purchase.endedOn : through;
  const dates: ISODate[] = [];
  for (let offset = 0; offset < 600; offset++) {
    const date = clampedDay(y, m + offset, d);
    if (date > last) break;
    dates.push(date);
  }
  return dates;
}

// A purchase's cost in soles: its price, or the bank's conversion of dollars (null until known).
export function purchaseSoles(purchase: Pick<Purchase, 'currency' | 'cents' | 'penCents'>) {
  return purchase.currency === 'PEN' ? purchase.cents : purchase.penCents;
}

export function needsSoles(purchase: Pick<Purchase, 'currency' | 'penCents'>) {
  return purchase.currency === 'USD' && purchase.penCents === null;
}

// Every charge a card's purchases put on its statements. Installments spread
// over consecutive cycles (all of them, past and future); monthly charges
// appear on each recurrence up to `through`.
export function chargesFor(card: CreditCard, purchases: Purchase[], through: ISODate, rate: number | null = null): Charge[] {
  const charges: Charge[] = [];
  for (const purchase of purchases) {
    if (purchase.cardId !== card.id) continue;
    const soles = purchaseSoles(purchase);
    const billedCurrency: Currency = purchase.currency === 'USD' && (card.dualCurrency || soles === null) ? 'USD' : 'PEN';
    const base = { purchaseId: purchase.id, cardId: card.id, title: purchase.title, category: purchase.category, currency: purchase.currency, billedCurrency };
    const dates = purchase.recurring ? recurringDates(purchase, through) : purchase.date <= through ? [purchase.date] : [];
    for (const date of dates) {
      const first = closingFor(card.closingDay, date);
      const count = purchase.recurring ? 1 : Math.max(1, Math.round(purchase.installments));
      const prices = installmentCents(purchase.cents, count);
      const solesShares = soles === null ? null : installmentCents(soles, count);
      const estimates = soles === null && rate ? installmentCents(Math.round(purchase.cents * rate), count) : null;
      prices.forEach((cents, index) => {
        const real = solesShares ? solesShares[index] : null;
        charges.push({
          ...base,
          cents,
          billedCents: billedCurrency === purchase.currency ? cents : real ?? cents,
          penCents: real ?? (estimates ? estimates[index] : null),
          estimated: real === null && estimates !== null,
          date,
          cycle: shiftClose(first, index, card.closingDay),
          installment: count > 1 ? { index: index + 1, count } : null,
          recurring: purchase.recurring,
        });
      });
    }
  }
  return charges.sort((a, b) => (a.date === b.date ? (b.penCents ?? 0) - (a.penCents ?? 0) : b.date.localeCompare(a.date)));
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function billed(charges: Charge[]): Amounts {
  const amounts = { ...NO_AMOUNTS };
  for (const charge of charges) amounts[charge.billedCurrency] += charge.billedCents;
  return amounts;
}

// Soles (the bank's or estimated), how many of them are estimated, and
// dollars without the bank's soles yet.
function solesOf(charges: Charge[]) {
  return {
    cents: sum(charges.map((charge) => charge.penCents ?? 0)),
    estimated: sum(charges.filter((charge) => charge.estimated).map((charge) => charge.penCents ?? 0)),
    pendingUsd: sum(charges.filter((charge) => charge.currency === 'USD' && (charge.penCents === null || charge.estimated)).map((charge) => charge.cents)),
  };
}

export function hasAmount(amounts: Amounts) {
  return amounts.PEN > 0 || amounts.USD > 0;
}

// ─── Statements ──────────────────────────────────────────────────────────────

export type StatementStatus = 'paid' | 'due' | 'overdue' | 'empty';

// A statement owes soles and dollars separately; each is paid in its own currency.
export type Statement = Cycle & { total: Amounts; paid: Amounts; balance: Amounts; status: StatementStatus };

export function statementFor(card: CreditCard, purchases: Purchase[], payments: Payment[], close: ISODate, today: ISODate): Statement {
  const cycle = cycleEndingOn(card, close);
  const total = billed(chargesFor(card, purchases, close).filter((charge) => charge.cycle === close));
  const paid = { ...NO_AMOUNTS };
  for (const payment of payments) if (payment.cardId === card.id && payment.cycle === close) paid[payment.currency] += payment.cents;
  const balance: Amounts = { PEN: Math.max(0, total.PEN - paid.PEN), USD: Math.max(0, total.USD - paid.USD) };
  const status: StatementStatus = !hasAmount(total) ? 'empty' : !hasAmount(balance) ? 'paid' : today > cycle.due ? 'overdue' : 'due';
  return { ...cycle, total, paid, balance, status };
}

// Closed statements that still owe something, oldest first.
export function unpaidStatements(card: CreditCard, purchases: Purchase[], payments: Payment[], today: ISODate): Statement[] {
  const own = purchases.filter((purchase) => purchase.cardId === card.id);
  if (!own.length) return [];
  const earliest = own.reduce((first, purchase) => (purchase.date < first ? purchase.date : first), own[0].date);
  const current = closingFor(card.closingDay, today);
  const statements: Statement[] = [];
  for (let close = shiftClose(current, -1, card.closingDay), guard = 0; close >= closingFor(card.closingDay, earliest) && guard < 120; close = shiftClose(close, -1, card.closingDay), guard++) {
    const statement = statementFor(card, purchases, payments, close, today);
    if (hasAmount(statement.balance)) statements.unshift(statement);
  }
  return statements;
}

// The last closed statement, whatever its state.
export function lastStatement(card: CreditCard, purchases: Purchase[], payments: Payment[], today: ISODate): Statement {
  return statementFor(card, purchases, payments, shiftClose(closingFor(card.closingDay, today), -1, card.closingDay), today);
}

// ─── Credit line ─────────────────────────────────────────────────────────────

export type CreditUse = {
  // In soles. What occupies the line: closed statements not yet paid, the
  // open cycle, and installments billed in later cycles.
  usedCents: number;
  availableCents: number;
  billedCents: number;
  currentCents: number;
  futureCents: number;
  // Dollars owed with no soles at all (no bank amount and no exchange rate).
  pendingUsdCents: number;
  // Whether some of it is estimated at the exchange rate.
  estimated: boolean;
};

// Payments settle the oldest charges first, in their own currency; what is
// left of each charge uses the line by its share of the soles it cost.
export function creditUse(card: CreditCard, purchases: Purchase[], payments: Payment[], today: ISODate, rate: number | null = null): CreditUse {
  const current = closingFor(card.closingDay, today);
  const charges = chargesFor(card, purchases, today, rate).sort((a, b) => a.cycle.localeCompare(b.cycle));
  const credit = { ...NO_AMOUNTS };
  for (const payment of payments) if (payment.cardId === card.id) credit[payment.currency] += payment.cents;
  const buckets = { billed: 0, current: 0, future: 0 };
  let pendingUsdCents = 0;
  let estimated = false;
  for (const charge of charges) {
    const applied = Math.min(charge.billedCents, credit[charge.billedCurrency]);
    credit[charge.billedCurrency] -= applied;
    const left = charge.billedCents - applied;
    if (!left) continue;
    if (charge.penCents === null) {
      pendingUsdCents += left;
      continue;
    }
    if (charge.estimated) estimated = true;
    const soles = Math.round((charge.penCents * left) / charge.billedCents);
    buckets[charge.cycle < current ? 'billed' : charge.cycle === current ? 'current' : 'future'] += soles;
  }
  const usedCents = buckets.billed + buckets.current + buckets.future;
  return { usedCents, availableCents: card.limitCents - usedCents, billedCents: buckets.billed, currentCents: buckets.current, futureCents: buckets.future, pendingUsdCents, estimated };
}

// ─── Cashback ────────────────────────────────────────────────────────────────

export function cashbackRate(card: CreditCard, category: SpendCategory) {
  return card.cashback.find((rule) => rule.category === category)?.percent ?? card.baseCashback;
}

export type CashbackLine = { category: SpendCategory; spentCents: number; rate: number; cents: number; capped: boolean };

// Cashback is earned in soles on what was bought in a cycle (the full price of
// a purchase in installments, each monthly charge), capped per category.
// Dollars count by the bank's soles, or estimated at the exchange rate.
export function cashbackFor(card: CreditCard, purchases: Purchase[], close: ISODate, rate: number | null = null): { cents: number; estimated: boolean; lines: CashbackLine[] } {
  const bought = chargesFor(card, purchases, close, rate).filter((charge) => closingFor(card.closingDay, charge.date) === close && (!charge.installment || charge.installment.index === 1));
  const spent = new Map<SpendCategory, number>();
  let estimated = false;
  for (const charge of bought) {
    const purchase = charge.installment ? purchases.find((item) => item.id === charge.purchaseId) : null;
    const full = purchase ? purchaseSoles(purchase) ?? (rate ? Math.round(purchase.cents * rate) : null) : charge.penCents;
    if (full === null) continue;
    if (charge.estimated) estimated = true;
    spent.set(charge.category, (spent.get(charge.category) ?? 0) + full);
  }
  const lines: CashbackLine[] = [];
  for (const [category, spentCents] of spent) {
    const rule = card.cashback.find((item) => item.category === category);
    const percent = rule?.percent ?? card.baseCashback;
    if (!percent) continue;
    const raw = Math.round((spentCents * percent) / 100);
    const cap = rule?.capCents ?? null;
    const cents = cap !== null ? Math.min(cap, raw) : raw;
    lines.push({ category, spentCents, rate: percent, cents, capped: cap !== null && raw > cap });
  }
  lines.sort((a, b) => b.cents - a.cents);
  return { cents: sum(lines.map((line) => line.cents)), estimated, lines };
}

// Cards ordered by what they return on a category, then by credit left.
export function bestCardsFor(cards: CreditCard[], category: SpendCategory, available: (card: CreditCard) => number) {
  return [...cards].sort((a, b) => cashbackRate(b, category) - cashbackRate(a, category) || available(b) - available(a));
}

// ─── A cycle ─────────────────────────────────────────────────────────────────

export type CategorySpend = { category: SpendCategory; cents: number; limitCents: number | null };

export type CycleSummary = {
  cycle: Cycle;
  // Charges already on the statement, and monthly charges still to come before it closes.
  posted: Charge[];
  upcoming: Charge[];
  // What each balance is billed.
  spent: Amounts;
  // In soles, what budgets compare against, with the part estimated at the
  // exchange rate; and the dollars still without the bank's soles.
  spentCents: number;
  estimatedCents: number;
  scheduledCents: number;
  pendingUsdCents: number;
  daysLeft: number;
  daysTotal: number;
  // Soles bought on each day of the cycle, for its chart.
  days: Array<{ date: ISODate; cents: number }>;
  // Where the cycle will close at the current pace, once there is a pace to read.
  projectedCents: number | null;
  categories: CategorySpend[];
};

export function cycleSummary(card: CreditCard, purchases: Purchase[], close: ISODate, today: ISODate, rate: number | null = null): CycleSummary {
  const cycle = cycleEndingOn(card, close);
  const charges = chargesFor(card, purchases, close, rate).filter((charge) => charge.cycle === close);
  const upcoming = charges.filter((charge) => charge.recurring && charge.date > today);
  const posted = charges.filter((charge) => !upcoming.includes(charge));
  const postedSoles = solesOf(posted);
  const scheduledCents = solesOf(upcoming).cents;
  const daysTotal = daysBetween(cycle.start, cycle.close) + 1;
  const open = today >= cycle.start && today <= cycle.close;
  const daysLeft = open ? daysBetween(today, cycle.close) : 0;
  const elapsed = open ? daysBetween(cycle.start, today) + 1 : daysTotal;

  // Installments carried from earlier cycles and monthly charges are fixed;
  // only what is bought day to day is extrapolated.
  const fixed = (charge: Charge) => charge.recurring || (charge.installment !== null && charge.installment.index > 1);
  const fixedCents = solesOf(charges.filter(fixed)).cents;
  const variableCents = solesOf(posted.filter((charge) => !fixed(charge))).cents;
  const projectedCents = open && elapsed >= 5 && variableCents > 0 ? fixedCents + Math.round((variableCents * daysTotal) / elapsed) : null;

  // The chart shows what was bought in the cycle; installments carried from earlier ones are not on a day of it.
  const days = Array.from({ length: daysTotal }, (_, index) => ({ date: addDays(cycle.start, index), cents: 0 }));
  for (const charge of posted) {
    const index = daysBetween(cycle.start, charge.date);
    if (index >= 0 && index < daysTotal) days[index].cents += charge.penCents ?? 0;
  }

  const byCategory = new Map<SpendCategory, number>();
  for (const charge of charges) byCategory.set(charge.category, (byCategory.get(charge.category) ?? 0) + (charge.penCents ?? 0));
  for (const limit of card.categoryLimits) if (!byCategory.has(limit.category)) byCategory.set(limit.category, 0);
  const categories = [...byCategory].map(([category, cents]) => ({ category, cents, limitCents: card.categoryLimits.find((limit) => limit.category === category)?.cents ?? null }))
    .sort((a, b) => b.cents - a.cents);

  return { cycle, posted, upcoming, spent: billed(posted), spentCents: postedSoles.cents, estimatedCents: postedSoles.estimated, scheduledCents, pendingUsdCents: postedSoles.pendingUsd, daysLeft, daysTotal, days, projectedCents, categories };
}

// ─── Exchange rate ───────────────────────────────────────────────────────────

// Automatic takes the market rate, fetched once a day, plus the bank's usual
// margin; manual is a rate the owner typed. It only estimates the soles of
// dollar purchases the bank has not converted yet.
export type RateSettings = { mode: 'auto' | 'manual'; market: number | null; marketOn: ISODate | null; marginPercent: number; manual: number | null };

export const DEFAULT_RATE_SETTINGS: RateSettings = { mode: 'auto', market: null, marketOn: null, marginPercent: 0, manual: null };

export function effectiveRate(settings: RateSettings): number | null {
  if (settings.mode === 'manual') return settings.manual;
  if (settings.market === null) return null;
  // toPrecision drops float noise, so 3.7 + 1.5 % rounds to 3.756, not 3.755.
  return Math.round(Number((settings.market * (1 + settings.marginPercent / 100) * 1000).toPrecision(12))) / 1000;
}

// "3.75", "3,712" → soles per dollar. Null outside a sensible range.
export function parseRate(text: string): number | null {
  const value = Number(text.replace(',', '.').replace(/S\/|\s/gi, ''));
  return text.trim() && Number.isFinite(value) && value > 0.5 && value < 50 ? Math.round(value * 1000) / 1000 : null;
}

export function formatRate(rate: number) {
  return rate.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const CURRENCY_SYMBOLS: Record<Currency, string> = { PEN: 'S/', USD: 'US$' };

export function formatMoney(cents: number, options: { decimals?: boolean; currency?: Currency } = {}) {
  const decimals = options.decimals ?? true;
  const value = Math.abs(cents) / 100;
  const text = value.toLocaleString('es-PE', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 });
  return `${cents < 0 ? '−' : ''}${CURRENCY_SYMBOLS[options.currency ?? 'PEN']} ${text}`;
}

// "S/ 1,240.50 + US$ 85.00", leaving out a currency with nothing in it.
export function formatAmounts(amounts: Amounts, options: { decimals?: boolean } = {}) {
  const parts = (['PEN', 'USD'] as Currency[]).filter((currency) => amounts[currency] !== 0).map((currency) => formatMoney(amounts[currency], { ...options, currency }));
  return parts.length ? parts.join(' + ') : formatMoney(0, options);
}

// "1250.5", "1 250,50", "S/ 1,250.50", "US$ 30" → cents. Null when it is not an amount.
export function parseMoney(text: string): number | null {
  let clean = text.replace(/US\$|S\/|\$|\s/gi, '');
  if (!clean) return null;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  if (lastComma > lastDot) {
    // A comma followed by one or two digits is the decimal mark.
    clean = /,\d{1,2}$/.test(clean) ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  } else {
    clean = clean.replace(/,/g, '');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export function dayLabel(days: number) {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}
