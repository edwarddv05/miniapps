// The miniapp code editor, run inside a WebView: CodeMirror with line numbers,
// JS/JSX/TS highlighting in Xcode's colours, the miniapp API in autocomplete,
// search, and a row of code keys above the keyboard. `npm run build:editor`
// bundles it into editor-html.ts.

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, GutterMarker, gutter, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const initial = window.__EDITOR__ ?? { doc: '', dark: false, typescript: false, api: [] };
const post = (message) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

// ─── Colours ───────────────────────────────────────────────────────────────

const PALETTE = {
  light: { bg: '#FFFFFF', text: '#1F1F24', gutter: '#A6A6AD', gutterBg: '#FFFFFF', active: '#ECF5FF', selection: '#B4D8FD', caret: '#0A66E8', keyword: '#9B2393', string: '#C41A16', number: '#1C00CF', comment: '#5D6C79', type: '#0B4F79', tag: '#0F68A0', func: '#326D74', prop: '#3E8087', error: '#FF3B3020', errorMark: '#FF3B30', bar: '#F2F2F7', key: '#FFFFFF', keyText: '#1F1F24', panel: '#F2F2F7' },
  dark: { bg: '#1F1F24', text: '#FFFFFF', gutter: '#6C6C70', gutterBg: '#1F1F24', active: '#23252B', selection: '#515B70', caret: '#7DB0FF', keyword: '#FF7AB2', string: '#FF8170', number: '#D9C97C', comment: '#7F8C98', type: '#DABAFF', tag: '#6BDFFF', func: '#67B7A4', prop: '#78C2B3', error: '#FF453A33', errorMark: '#FF453A', bar: '#2C2C2E', key: '#48484A', keyText: '#FFFFFF', panel: '#2C2C2E' },
};

function theme(dark) {
  const c = PALETTE[dark ? 'dark' : 'light'];
  document.documentElement.style.setProperty('--bar', c.bar);
  document.documentElement.style.setProperty('--key', c.key);
  document.documentElement.style.setProperty('--key-text', c.keyText);
  document.body.style.background = c.bg;
  return [
    EditorView.theme({
      '&': { color: c.text, backgroundColor: c.bg, height: '100%', fontSize: '13px' },
      '.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', lineHeight: '1.55', overscrollBehavior: 'contain' },
      '.cm-content': { caretColor: c.caret, padding: '8px 0 40vh' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.caret, borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: c.selection },
      '.cm-gutters': { backgroundColor: c.gutterBg, color: c.gutter, border: 'none' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', minWidth: '26px' },
      '.cm-activeLine': { backgroundColor: c.active },
      '.cm-activeLineGutter': { backgroundColor: c.active, color: c.text },
      '.cm-errorLine': { backgroundColor: c.error },
      '.cm-errorMark': { color: c.errorMark, fontWeight: '700' },
      '.cm-matchingBracket': { backgroundColor: c.selection, outline: 'none' },
      '.cm-tooltip': { backgroundColor: c.panel, border: 'none', borderRadius: '10px', boxShadow: '0 6px 24px #0003', overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'ui-monospace, Menlo, monospace', maxHeight: '11em' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '6px 10px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: c.caret, color: '#FFFFFF' },
      '.cm-completionDetail': { opacity: 0.6, fontStyle: 'normal', marginLeft: '8px' },
      '.cm-panels': { backgroundColor: c.panel, color: c.text, borderTop: 'none' },
      '.cm-panel.cm-search': { padding: '8px', fontFamily: '-apple-system, system-ui', fontSize: '15px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '15px', borderRadius: '8px', border: 'none', padding: '6px 8px', margin: '3px', background: c.key, color: c.keyText },
      '.cm-panel.cm-search label': { fontSize: '13px' },
      '.cm-searchMatch': { backgroundColor: '#FFD60A55' },
      '.cm-searchMatch-selected': { backgroundColor: '#FFD60A' },
    }, { dark }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self, t.null, t.bool], color: c.keyword, fontWeight: '600' },
      { tag: [t.string, t.special(t.string), t.regexp], color: c.string },
      { tag: [t.number, t.integer, t.float], color: c.number },
      { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.comment, fontStyle: 'italic' },
      { tag: [t.typeName, t.className, t.namespace], color: c.type },
      { tag: [t.tagName, t.angleBracket], color: c.tag },
      { tag: [t.attributeName], color: c.prop },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.func },
      { tag: [t.propertyName], color: c.prop },
      { tag: t.invalid, color: c.errorMark },
    ])),
  ];
}

// ─── Error line ────────────────────────────────────────────────────────────

const setErrorLine = StateEffect.define();
const errorLine = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setErrorLine)) return effect.value;
    return transaction.docChanged && value !== null ? null : value;
  },
  provide: (field) => EditorView.decorations.from(field, (line) => (view) => {
    if (line === null || line < 1 || line > view.state.doc.lines) return Decoration.none;
    return Decoration.set([Decoration.line({ class: 'cm-errorLine' }).range(view.state.doc.line(line).from)]);
  }),
});

class ErrorMarker extends GutterMarker {
  toDOM() {
    const mark = document.createElement('span');
    mark.className = 'cm-errorMark';
    mark.textContent = '●';
    return mark;
  }
}
const errorGutter = gutter({
  class: 'cm-errorGutter',
  lineMarker(view, line) {
    const error = view.state.field(errorLine);
    return error !== null && error <= view.state.doc.lines && view.state.doc.line(error).from === line.from ? new ErrorMarker() : null;
  },
  lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setErrorLine)) || tr.docChanged),
});

// ─── Autocomplete ──────────────────────────────────────────────────────────

const api = Array.isArray(initial.api) ? initial.api : [];
const byName = new Map(api.map((entry) => [entry.label, entry]));
const apiOptions = api.map((entry) => ({ label: entry.label, type: entry.type, detail: entry.detail, boost: 2 }));

function apiCompletions(context) {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 400), context.pos);
  // Inside a JSX tag of a known view: its props.
  const tag = /<([A-Z][\w.]*)(?:\s+[^<>]*?)?\s+([a-zA-Z]*)$/.exec(before);
  if (tag && byName.get(tag[1])?.props) {
    const word = context.matchBefore(/[a-zA-Z]*/);
    return { from: word ? word.from : context.pos, options: byName.get(tag[1]).props.map((prop) => ({ label: prop, type: 'property', apply: `${prop}=` })), validFor: /^[a-zA-Z]*$/ };
  }
  const word = context.matchBefore(/[\w$]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  // After a dot it is a property of something else, not the API.
  if (word.from > 0 && context.state.sliceDoc(word.from - 1, word.from) === '.') return null;
  return { from: word.from, options: apiOptions, validFor: /^[\w$]*$/ };
}

// ─── Editor ────────────────────────────────────────────────────────────────

const themeSlot = new Compartment();
let changeTimer = null;
const sendChange = () => {
  clearTimeout(changeTimer);
  changeTimer = null;
  post({ type: 'change', doc: view.state.doc.toString() });
};

const view = new EditorView({
  parent: document.getElementById('editor'),
  state: EditorState.create({
    doc: initial.doc,
    extensions: [
      lineNumbers(),
      errorGutter,
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      indentOnInput(),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ icons: false, activateOnTypingDelay: 120 }),
      EditorState.languageData.of(() => [{ autocomplete: apiCompletions }]),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      javascript({ jsx: true, typescript: Boolean(initial.typescript) }),
      errorLine,
      themeSlot.of(theme(Boolean(initial.dark))),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, { key: 'Tab', run: indentMore, shift: indentLess }]),
      EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        clearTimeout(changeTimer);
        changeTimer = setTimeout(sendChange, 150);
      }),
      EditorView.domEventHandlers({ blur: () => { if (changeTimer) sendChange(); } }),
    ],
  }),
});

// ─── Keys above the keyboard ───────────────────────────────────────────────

const insert = (text, back = 0) => {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length - back }, scrollIntoView: true, userEvent: 'input' });
  view.focus();
};
const KEYS = [
  ['↶', () => undo(view), 'Deshacer'],
  ['↷', () => redo(view), 'Rehacer'],
  ['⇥', () => indentMore(view), 'Sangrar'],
  ['{ }', () => insert('{}', 1)],
  ['( )', () => insert('()', 1)],
  ['[ ]', () => insert('[]', 1)],
  ['< >', () => insert('<>', 1)],
  ['=', () => insert('=')],
  ["' '", () => insert("''", 1)],
  ['" "', () => insert('""', 1)],
  ['` `', () => insert('``', 1)],
  [';', () => insert(';')],
  [':', () => insert(':')],
  ['/', () => insert('/')],
  ['=>', () => insert(' => ')],
  ['$', () => insert('${}', 1)],
  ['⌕', () => openSearchPanel(view), 'Buscar'],
  ['…', () => startCompletion(view), 'Sugerencias'],
];
const bar = document.getElementById('keys');
for (const [label, run, title] of KEYS) {
  const button = document.createElement('button');
  button.textContent = label;
  if (title) button.setAttribute('aria-label', title);
  // Pressing a key must not take the focus away from the code.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  button.addEventListener('touchend', (event) => {
    event.preventDefault();
    run();
  });
  button.addEventListener('click', run);
  bar.appendChild(button);
}
const done = document.createElement('button');
done.textContent = '⌄';
done.className = 'done';
done.setAttribute('aria-label', 'Ocultar teclado');
done.addEventListener('touchend', (event) => {
  event.preventDefault();
  view.contentDOM.blur();
});
bar.appendChild(done);

// The keys show only while typing, right above the keyboard.
const placeKeys = () => {
  const viewport = window.visualViewport;
  const covered = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.body.style.paddingBottom = `${covered}px`;
};
window.visualViewport?.addEventListener('resize', placeKeys);
window.visualViewport?.addEventListener('scroll', placeKeys);
view.contentDOM.addEventListener('focus', () => document.body.classList.add('typing'));
view.contentDOM.addEventListener('blur', () => document.body.classList.remove('typing'));

// ─── Messages from the app ─────────────────────────────────────────────────

window.__editor = {
  view,
  setError(line) {
    view.dispatch({ effects: setErrorLine.of(typeof line === 'number' ? line : null) });
    if (typeof line === 'number' && line >= 1 && line <= view.state.doc.lines) {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) });
    }
  },
  setDark(dark) {
    view.dispatch({ effects: themeSlot.reconfigure(theme(Boolean(dark))) });
  },
  setDoc(doc) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(doc) } });
  },
  requestDoc(id) {
    clearTimeout(changeTimer);
    changeTimer = null;
    post({ type: 'doc', id, doc: view.state.doc.toString() });
  },
};
post({ type: 'ready' });
