import { toggleComment } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { app } from '../../app';
import { insertWikilink, toggleBold, toggleChecklist, toggleHighlight, toggleItalic, toggleStrikethrough } from './formatting';

export interface EditorCommand {
  id: string;
  name: string;
  hotkey?: string;
  run: (view: EditorView) => boolean;
}

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  { id: 'editor:toggle-bold', name: 'Toggle bold', hotkey: 'Mod+B', run: toggleBold },
  { id: 'editor:toggle-italic', name: 'Toggle italic', hotkey: 'Mod+I', run: toggleItalic },
  { id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', run: toggleStrikethrough },
  { id: 'editor:toggle-highlight', name: 'Toggle highlight', run: toggleHighlight },
  { id: 'editor:insert-link', name: 'Insert internal link', hotkey: 'Mod+K', run: insertWikilink },
  { id: 'editor:toggle-checklist', name: 'Toggle checklist status', hotkey: 'Mod+L', run: toggleChecklist },
  { id: 'editor:toggle-comment', name: 'Toggle comment', hotkey: 'Mod+/', run: toggleComment },
  { id: 'editor:search-in-file', name: 'Search current file', hotkey: 'Mod+F', run: openSearchPanel },
];

/** Editor commands apply unless the keyboard focus sits in some other text field (sidebar search, inline title…). */
export function editorCanAct(view: EditorView): boolean {
  const el = document.activeElement;
  if (!el || el === document.body || view.dom.contains(el) || el.closest('.modal')) return true;
  return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable);
}

/** Register the editor commands for the view returned by `getView`. Returns an unregister function. */
export function registerEditorCommands(getView: () => EditorView | null): () => void {
  const unregisters = EDITOR_COMMANDS.map((command) =>
    app.commands.register({
      id: command.id,
      name: command.name,
      hotkey: command.hotkey,
      checkCallback: () => {
        const view = getView();
        return view !== null && editorCanAct(view);
      },
      callback: () => {
        const view = getView();
        if (!view) return false;
        const result = command.run(view);
        if (!view.dom.contains(document.activeElement)) view.focus();
        return result;
      },
    }),
  );
  return () => unregisters.forEach((unregister) => unregister());
}
