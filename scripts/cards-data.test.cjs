const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../cards-data.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cards = {};
new Function('exports', 'require', compiled)(cards, require);

const {
  closingFor, dueFor, cycleFor, chargesFor, statementFor, unpaidStatements, creditUse, cashbackFor,
  cycleSummary, installmentCents, parseMoney, formatMoney, formatAmounts, bestCardsFor, daysBetween,
} = cards;

const card = {
  id: 'ibk', name: 'Interbank', network: 'visa', last4: '4114', design: 'emerald', image: null, dualCurrency: false,
  limitCents: 800000, budgetCents: 200000, closingDay: 25, dueDay: 12,
  baseCashback: 1, cashback: [{ category: 'supermarket', percent: 5, capCents: 3000 }], categoryLimits: [{ category: 'delivery', cents: 20000 }],
};
const dual = { ...card, id: 'bbva', dualCurrency: true };

let seq = 0;
const purchase = (date, cents, extra = {}) => ({ id: `p${++seq}`, cardId: 'ibk', title: 'Compra', category: 'other', currency: 'PEN', cents, penCents: null, date, installments: 1, recurring: false, endedOn: null, ...extra });
const payment = (cycle, cents, extra = {}) => ({ id: `y${++seq}`, cardId: 'ibk', cycle, currency: 'PEN', cents, date: '2026-10-05', ...extra });

test('a purchase on the closing day goes in that statement, the next day in the following one', () => {
  assert.equal(closingFor(25, '2026-10-25'), '2026-10-25');
  assert.equal(closingFor(25, '2026-10-26'), '2026-11-25');
  assert.equal(closingFor(25, '2026-12-30'), '2027-01-25');
});

test('statements closing on the 25th are paid by the 12th of the next month', () => {
  assert.deepEqual(cycleFor(card, '2026-10-01'), { start: '2026-09-26', close: '2026-10-25', due: '2026-11-12' });
  assert.equal(dueFor('2026-12-25', 12), '2027-01-12');
  // A payment day after the closing day falls in the same month.
  assert.equal(dueFor('2026-10-05', 25), '2026-10-25');
});

test('closing on the 31st uses the last day of shorter months', () => {
  assert.equal(closingFor(31, '2027-02-10'), '2027-02-28');
  assert.equal(closingFor(31, '2026-11-30'), '2026-11-30');
  assert.deepEqual(cycleFor({ closingDay: 31, dueDay: 20 }, '2027-03-01'), { start: '2027-03-01', close: '2027-03-31', due: '2027-04-20' });
});

test('installments split into whole cents, the last one taking the remainder', () => {
  assert.deepEqual(installmentCents(100000, 3), [33333, 33333, 33334]);
  const charges = chargesFor(card, [purchase('2026-10-01', 120000, { installments: 6 })], '2026-10-01');
  assert.equal(charges.length, 6);
  assert.deepEqual(charges.map((charge) => charge.cycle), ['2026-10-25', '2026-11-25', '2026-12-25', '2027-01-25', '2027-02-25', '2027-03-25']);
  assert.deepEqual(charges[2].installment, { index: 3, count: 6 });
});

test('monthly charges recur on the same day until they end', () => {
  const netflix = purchase('2026-08-15', 4490, { recurring: true });
  assert.deepEqual(chargesFor(card, [netflix], '2026-10-20').map((charge) => charge.date), ['2026-10-15', '2026-09-15', '2026-08-15']);
  const ended = { ...netflix, endedOn: '2026-09-30' };
  assert.equal(chargesFor(card, [ended], '2026-12-31').length, 2);
});

test('a statement is due, then overdue, until payments cover it', () => {
  const purchases = [purchase('2026-09-10', 50000), purchase('2026-09-20', 25000)];
  assert.equal(statementFor(card, purchases, [], '2026-09-25', '2026-10-01').status, 'due');
  assert.equal(statementFor(card, purchases, [], '2026-09-25', '2026-10-13').status, 'overdue');
  const partial = [payment('2026-09-25', 30000)];
  assert.equal(statementFor(card, purchases, partial, '2026-09-25', '2026-10-06').balance.PEN, 45000);
  const full = [...partial, payment('2026-09-25', 45000)];
  assert.equal(statementFor(card, purchases, full, '2026-09-25', '2026-10-09').status, 'paid');
  assert.deepEqual(unpaidStatements(card, purchases, partial, '2026-10-06').map((statement) => statement.close), ['2026-09-25']);
  assert.deepEqual(unpaidStatements(card, purchases, full, '2026-10-06'), []);
});

test('the credit line counts unpaid statements, the open cycle and future installments', () => {
  const purchases = [purchase('2026-09-10', 50000), purchase('2026-10-01', 120000, { installments: 6 }), purchase('2026-10-02', 10000)];
  const use = creditUse(card, purchases, [], '2026-10-03');
  assert.equal(use.billedCents, 50000);
  assert.equal(use.currentCents, 30000);
  assert.equal(use.futureCents, 100000);
  assert.equal(use.usedCents, 180000);
  assert.equal(use.availableCents, 620000);
  const paid = creditUse(card, purchases, [payment('2026-09-25', 50000)], '2026-10-03');
  assert.equal(paid.usedCents, 130000);
});

test('a card without a dollar balance bills the soles the bank converted, and dollars until it does', () => {
  const purchases = [
    purchase('2026-10-02', 2000, { currency: 'USD', penCents: 7600 }),
    purchase('2026-10-03', 1000, { currency: 'USD' }),
  ];
  const charges = chargesFor(card, purchases, '2026-10-05');
  const converted = charges.find((charge) => charge.penCents === 7600);
  assert.deepEqual([converted.currency, converted.cents, converted.billedCurrency, converted.billedCents], ['USD', 2000, 'PEN', 7600]);
  assert.deepEqual(statementFor(card, purchases, [], '2026-10-25', '2026-10-26').total, { PEN: 7600, USD: 1000 });
  const summary = cycleSummary(card, purchases, '2026-10-25', '2026-10-05');
  assert.equal(summary.spentCents, 7600);
  assert.equal(summary.pendingUsdCents, 1000);
  const use = creditUse(card, purchases, [], '2026-10-05');
  assert.equal(use.usedCents, 7600);
  assert.equal(use.pendingUsdCents, 1000);
});

test('a two-currency card owes dollars apart; the soles they cost use the credit line', () => {
  const purchases = [
    purchase('2026-09-10', 50000, { cardId: 'bbva' }),
    purchase('2026-09-12', 8000, { cardId: 'bbva', currency: 'USD', penCents: 30400 }),
    purchase('2026-10-02', 2000, { cardId: 'bbva', currency: 'USD' }),
  ];
  const statement = statementFor(dual, purchases, [], '2026-09-25', '2026-10-03');
  assert.deepEqual(statement.total, { PEN: 50000, USD: 8000 });
  const use = creditUse(dual, purchases, [], '2026-10-03');
  assert.equal(use.billedCents, 80400);
  assert.equal(use.currentCents, 0);
  assert.equal(use.pendingUsdCents, 2000);
  // Paying the soles leaves the statement due until the dollars are paid too.
  const soles = [payment('2026-09-25', 50000, { cardId: 'bbva' })];
  const afterSoles = statementFor(dual, purchases, soles, '2026-09-25', '2026-10-05');
  assert.deepEqual(afterSoles.balance, { PEN: 0, USD: 8000 });
  assert.equal(afterSoles.status, 'due');
  // Half the dollars paid frees half the soles they cost.
  const half = [...soles, payment('2026-09-25', 4000, { cardId: 'bbva', currency: 'USD' })];
  assert.equal(creditUse(dual, purchases, half, '2026-10-05').billedCents, 15200);
  const both = [...soles, payment('2026-09-25', 8000, { cardId: 'bbva', currency: 'USD' })];
  assert.equal(statementFor(dual, purchases, both, '2026-09-25', '2026-10-05').status, 'paid');
  assert.equal(creditUse(dual, purchases, both, '2026-10-05').usedCents, 0);
  const summary = cycleSummary(dual, purchases, '2026-10-25', '2026-10-05');
  assert.deepEqual(summary.spent, { PEN: 0, USD: 2000 });
  assert.equal(summary.spentCents, 0);
  assert.equal(summary.pendingUsdCents, 2000);
});

test('the cycle chart puts each day\'s soles on its day', () => {
  const purchases = [purchase('2026-09-26', 1000), purchase('2026-09-26', 500), purchase('2026-10-03', 2000), purchase('2026-08-01', 60000, { installments: 3 })];
  const summary = cycleSummary(card, purchases, '2026-10-25', '2026-10-05');
  assert.equal(summary.days.length, 30);
  assert.deepEqual(summary.days[0], { date: '2026-09-26', cents: 1500 });
  assert.equal(summary.days[7].cents, 2000);
  // A carried installment counts in the total but sits on no day.
  assert.equal(summary.spentCents, 1500 + 2000 + 20000);
});

test('cashback uses the category rate, the base rate otherwise, and respects caps', () => {
  const purchases = [
    purchase('2026-10-01', 80000, { category: 'supermarket' }),
    purchase('2026-10-02', 10000, { category: 'restaurants' }),
    purchase('2026-10-03', 60000, { category: 'shopping', installments: 3 }),
    purchase('2026-10-04', 2000, { category: 'travel', currency: 'USD', penCents: 7600 }),
    purchase('2026-10-05', 3000, { category: 'travel', currency: 'USD' }),
  ];
  const cashback = cashbackFor(card, purchases, '2026-10-25');
  const supermarket = cashback.lines.find((line) => line.category === 'supermarket');
  assert.equal(supermarket.cents, 3000);
  assert.equal(supermarket.capped, true);
  assert.equal(cashback.lines.find((line) => line.category === 'restaurants').cents, 100);
  // The full price of a purchase in installments earns cashback when bought.
  assert.equal(cashback.lines.find((line) => line.category === 'shopping').cents, 600);
  // Cashback is on the soles the bank charged; dollars without them earn nothing yet.
  assert.equal(cashback.lines.find((line) => line.category === 'travel').cents, 76);
  assert.equal(cashbackFor(card, purchases, '2026-11-25').cents, 0);
});

test('the open cycle reports spending and a projection', () => {
  const purchases = [
    purchase('2026-09-28', 30000, { category: 'delivery' }),
    purchase('2026-10-04', 20000),
    purchase('2026-08-20', 4490, { recurring: true, category: 'subscriptions' }),
  ];
  const summary = cycleSummary(card, purchases, '2026-10-25', '2026-10-05');
  assert.equal(summary.spentCents, 50000);
  assert.equal(summary.scheduledCents, 4490);
  assert.equal(summary.daysLeft, 20);
  assert.equal(summary.daysTotal, 30);
  assert.equal(summary.projectedCents, 4490 + Math.round((50000 * 30) / 10));
  const delivery = summary.categories.find((item) => item.category === 'delivery');
  assert.deepEqual(delivery, { category: 'delivery', cents: 30000, limitCents: 20000 });
});

test('no projection before five days of the cycle', () => {
  const summary = cycleSummary(card, [purchase('2026-09-27', 30000)], '2026-10-25', '2026-09-28');
  assert.equal(summary.projectedCents, null);
});

test('amounts and rates are read in either decimal style', () => {
  assert.equal(parseMoney('1250.5'), 125050);
  assert.equal(parseMoney('1,250.50'), 125050);
  assert.equal(parseMoney('1.250,50'), 125050);
  assert.equal(parseMoney('45,9'), 4590);
  assert.equal(parseMoney('S/ 30'), 3000);
  assert.equal(parseMoney('US$ 12.99'), 1299);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
  assert.match(formatMoney(125050), /^S\/ 1.250.50$/);
  assert.match(formatMoney(1299, { currency: 'USD' }), /^US\$ 12.99$/);
  assert.match(formatAmounts({ PEN: 0, USD: 1299 }), /^US\$ 12.99$/);
  assert.match(formatAmounts({ PEN: 5000, USD: 1299 }), /^S\/ 50.00 \+ US\$ 12.99$/);
});

test('the best card for a category returns the most, then has the most room', () => {
  const other = { ...card, id: 'bcp', cashback: [], baseCashback: 1 };
  const third = { ...card, id: 'bbva', cashback: [], baseCashback: 1 };
  const room = { ibk: 1, bcp: 5, bbva: 9 };
  assert.deepEqual(bestCardsFor([other, third, card], 'supermarket', (item) => room[item.id]).map((item) => item.id), ['ibk', 'bbva', 'bcp']);
  assert.equal(daysBetween('2026-10-01', '2026-10-25'), 24);
});

test('an exchange rate estimates dollars without the bank\'s soles, and the bank\'s soles win', () => {
  const { effectiveRate, parseRate } = cards;
  const purchases = [
    purchase('2026-10-02', 2000, { currency: 'USD', penCents: 7600 }),
    purchase('2026-10-03', 1000, { currency: 'USD', category: 'travel' }),
  ];
  const summary = cycleSummary(card, purchases, '2026-10-25', '2026-10-05', 3.8);
  assert.equal(summary.spentCents, 7600 + 3800);
  assert.equal(summary.estimatedCents, 3800);
  assert.equal(summary.pendingUsdCents, 1000);
  // The statement still bills the unconverted dollars as dollars.
  assert.deepEqual(statementFor(card, purchases, [], '2026-10-25', '2026-10-26').total, { PEN: 7600, USD: 1000 });
  const use = creditUse(card, purchases, [], '2026-10-05', 3.8);
  assert.equal(use.usedCents, 11400);
  assert.equal(use.pendingUsdCents, 0);
  assert.equal(use.estimated, true);
  const cashback = cashbackFor(card, purchases, '2026-10-25', 3.8);
  assert.equal(cashback.cents, 76 + 38);
  assert.equal(cashback.estimated, true);
  assert.equal(effectiveRate({ mode: 'auto', market: 3.7, marketOn: '2026-10-05', marginPercent: 1.5, manual: null }), 3.756);
  assert.equal(effectiveRate({ mode: 'manual', market: 3.7, marketOn: null, marginPercent: 1.5, manual: 3.8 }), 3.8);
  assert.equal(effectiveRate({ mode: 'auto', market: null, marketOn: null, marginPercent: 0, manual: null }), null);
  assert.equal(parseRate('3,712'), 3.712);
  assert.equal(parseRate(''), null);
});
