import { openSearchPanel, search } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { editorCanAct } from './editorCommands';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
});

describe('editorCanAct', () => {
  it('acts when the editor content or nothing in particular has focus', () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'hello' }) });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(editorCanAct(view)).toBe(true);
    view.contentDOM.focus();
    expect(editorCanAct(view)).toBe(true);
  });

  it('does not act while typing in another text field', () => {
    view = new EditorView({ parent: document.body });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(editorCanAct(view)).toBe(false);
  });

  it("does not act while typing in the editor's own search panel", () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'hello world', extensions: [search({ top: true })] }) });
    openSearchPanel(view);
    const field = view.dom.querySelector<HTMLInputElement>('.cm-panel input.cm-textfield');
    expect(field).not.toBeNull();
    field?.focus();
    expect(document.activeElement).toBe(field);
    expect(editorCanAct(view)).toBe(false);
    view.contentDOM.focus();
    expect(editorCanAct(view)).toBe(true);
  });
});
