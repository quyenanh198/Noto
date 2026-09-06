import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap } from '@codemirror/search';
import { type Compartment, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, type KeyBinding, keymap, placeholder } from '@codemirror/view';
import { IS_MAC, normalizeHotkey } from '../../commands/registry';
import { type CompletionDeps, createCompletionSources } from './completion';
import { editorTheme, markdownHighlightStyle } from './editorTheme';
import { frontmatter } from './frontmatter';
import { type LivePreviewHandlers, livePreview } from './livePreview';

const IS_WIN = typeof navigator !== 'undefined' && /Win/.test(navigator.platform);

/** Convert a CodeMirror key name (`Mod-Shift-f`, `Mod--`) into the command registry's normalized form. */
export function cmKeyToHotkey(key: string): string {
  const parts = key.split('-');
  let last = parts.pop() ?? '';
  if (last === '' && parts.length) {
    parts.pop();
    last = '-';
  }
  return normalizeHotkey([...parts, last].join('+'));
}

function platformKey(binding: KeyBinding): string | undefined {
  return (IS_MAC ? binding.mac : IS_WIN ? binding.win : binding.linux) ?? binding.key;
}

/** Drop bindings whose chord is owned by an app command, so the shell's hotkey handler is the only one that runs. */
export function withoutReserved(bindings: readonly KeyBinding[], reserved: ReadonlySet<string>): KeyBinding[] {
  return bindings.filter((b) => {
    const key = platformKey(b);
    return !key || !reserved.has(cmKeyToHotkey(key));
  });
}

export interface EditorExtensionOptions {
  /** App hotkeys such as `Mod+B` that CodeMirror's own keymaps must not handle. */
  reservedHotkeys: readonly string[];
  completion: CompletionDeps;
  preview: LivePreviewHandlers;
  onDocChanged: (doc: string) => void;
  /** Wraps the handler-bound extensions so a state kept from an earlier mount can be re-pointed at a new one. */
  dynamic?: Compartment;
}

/** The extensions that close over one mount's handlers: completion sources, live-preview clicks, change reporting. */
export function mountExtensions(options: Pick<EditorExtensionOptions, 'completion' | 'preview' | 'onDocChanged'>): Extension[] {
  return [
    autocompletion({ activateOnTyping: true, override: createCompletionSources(options.completion), icons: false }),
    livePreview(options.preview),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChanged(update.state.doc.toString());
    }),
  ];
}

export function createEditorExtensions(options: EditorExtensionOptions): Extension[] {
  const reserved = new Set(options.reservedHotkeys.map(normalizeHotkey));
  const bound = mountExtensions(options);
  return [
    history(),
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [frontmatter], addKeymap: true, completeHTMLTags: false }),
    syntaxHighlighting(markdownHighlightStyle),
    editorTheme,
    EditorView.lineWrapping,
    highlightActiveLine(),
    drawSelection(),
    bracketMatching(),
    closeBrackets(),
    placeholder('Start writing…'),
    options.dynamic ? options.dynamic.of(bound) : bound,
    search({ top: true }),
    keymap.of([
      ...closeBracketsKeymap,
      ...withoutReserved(defaultKeymap, reserved),
      ...withoutReserved(historyKeymap, reserved),
      ...withoutReserved(searchKeymap, reserved),
      indentWithTab,
    ]),
  ];
}
