import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../app';
import { MemoryAdapter } from '../../core/vault/storage';
import { useWorkspace } from '../../state/store';
import { MarkdownEditor } from './MarkdownEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  // CodeMirror measures text with ranges, which jsdom does not lay out.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  await app.vault.switchAdapter(new MemoryAdapter({ files: [{ path: 'Notes/Welcome.md', content: '# Title\n\nbody', mtime: 0 }], folders: [] }));
});

beforeEach(async () => {
  useWorkspace.setState({ openTabs: ['Notes/Welcome.md'], activeFile: 'Notes/Welcome.md', pendingNavigation: null, graphOpen: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MarkdownEditor path="Notes/Welcome.md" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const titleField = () => container.querySelector<HTMLTextAreaElement>('[data-testid="inline-title"]')!;

/** Type into the controlled title field the way a user would (React listens for `input`). */
async function typeTitle(value: string): Promise<void> {
  const field = titleField();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    field.focus();
    setValue.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(field.value).toBe(value);
}

describe('MarkdownEditor inline title', () => {
  it('commits a title still being edited when a hotkey unmounts the editor without a blur', async () => {
    await typeTitle('Hello there');
    // Ctrl+E, Ctrl+G or closing the tab from the keyboard tear the field down before React sees any blur.
    await act(async () => root.render(<div />));
    await vi.waitFor(() => expect(app.vault.exists('Notes/Hello there.md')).toBe(true));
    expect(app.vault.exists('Notes/Welcome.md')).toBe(false);
    expect(useWorkspace.getState().openTabs).toEqual(['Notes/Hello there.md']);
    await app.vault.rename('Notes/Hello there.md', 'Notes/Welcome.md');
  });

  it('leaves the name alone when the field was not changed or the edit was cancelled', async () => {
    const renames: string[] = [];
    const off = app.vault.on((e) => {
      if (e.type === 'rename') renames.push(e.newPath);
    });
    await typeTitle('Changed my mind');
    await act(async () => {
      titleField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(titleField().value).toBe('Welcome');
    await act(async () => root.render(<div />));
    await new Promise((r) => setTimeout(r, 20));
    off();
    expect(renames).toEqual([]);
    expect(app.vault.exists('Notes/Welcome.md')).toBe(true);
  });
});
