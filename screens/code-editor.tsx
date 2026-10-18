// The code editor: CodeMirror in a WebView, from the page bundled in
// editor-html.ts. The text lives in the page; the app asks for it on save.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { EDITOR_HTML } from '../editor-html';
import { SCRIPT_API } from '../script-api';

export type CodeEditorHandle = {
  /** The current text, straight from the editor (any pending change included). */
  getText: () => Promise<string>;
  setText: (text: string) => void;
  /** Marks the line with an error and scrolls to it; null clears it. */
  setError: (line: number | null) => void;
};

type Props = { initial: string; dark: boolean; typescript: boolean; onChange: (text: string) => void };

const call = (method: string, argument: unknown) => `window.__editor && window.__editor.${method}(${JSON.stringify(argument) ?? 'null'}); true;`;

export const CodeEditorRN = forwardRef<CodeEditorHandle, Props>(function CodeEditorRN({ initial, dark, typescript, onChange }, ref) {
  const web = useRef<WebView>(null);
  const latest = useRef(initial);
  const waiting = useRef(new Map<number, (text: string) => void>());
  const nextId = useRef(1);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Given once: later changes travel as messages, so the page never reloads under the cursor.
  const setup = useMemo(() => `window.__EDITOR__ = ${JSON.stringify({ doc: initial, dark, typescript, api: SCRIPT_API }).replace(/</g, '\\u003c')}; true;`, []);

  useImperativeHandle(ref, () => ({
    getText: () => new Promise<string>((resolve) => {
      const id = nextId.current++;
      waiting.current.set(id, resolve);
      web.current?.injectJavaScript(call('requestDoc', id));
      // If the page does not answer, the last text it sent is used.
      setTimeout(() => {
        if (waiting.current.delete(id)) resolve(latest.current);
      }, 800);
    }),
    setText: (text: string) => {
      latest.current = text;
      web.current?.injectJavaScript(call('setDoc', text));
    },
    setError: (line: number | null) => web.current?.injectJavaScript(call('setError', line)),
  }), []);

  useEffect(() => {
    web.current?.injectJavaScript(call('setDark', dark));
  }, [dark]);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; doc?: unknown; id?: unknown };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (typeof message.doc !== 'string') return;
    latest.current = message.doc;
    if (message.type === 'change') onChangeRef.current(message.doc);
    if (message.type === 'doc' && typeof message.id === 'number') {
      const resolve = waiting.current.get(message.id);
      waiting.current.delete(message.id);
      onChangeRef.current(message.doc);
      resolve?.(message.doc);
    }
  };

  return <WebView
    ref={web}
    originWhitelist={['about:blank']}
    source={{ html: EDITOR_HTML }}
    injectedJavaScriptBeforeContentLoaded={setup}
    onMessage={onMessage}
    // Links and navigation never leave the editor page.
    onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
    hideKeyboardAccessoryView
    keyboardDisplayRequiresUserAction={false}
    scrollEnabled={false}
    bounces={false}
    automaticallyAdjustContentInsets={false}
    contentInsetAdjustmentBehavior="never"
    dataDetectorTypes="none"
    allowsLinkPreview={false}
    style={{ flex: 1, backgroundColor: dark ? '#1F1F24' : '#FFFFFF' }}
  />;
});
