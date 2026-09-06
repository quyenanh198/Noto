import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../app';
import { MemoryAdapter } from '../../core/vault/storage';
import { useWorkspace } from '../../state/store';
import { FileExplorer } from './FileExplorer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lacks the two DOM APIs the explorer uses to reveal rows.
const globals = globalThis as { CSS?: { escape(value: string): string } };
globals.CSS ??= { escape: (s) => s.replace(/[^\w-]/g, (c) => `\\${c}`) };
Element.prototype.scrollIntoView ??= () => {};

/**
 * Stands in for the workspace: like the real editor, the view for the active file is re-created whenever
 * the active file changes and grabs keyboard focus as soon as it mounts.
 */
function FocusingView() {
  const active = useWorkspace((s) => s.activeFile);
  return active ? <View key={active} path={active} /> : null;
}

function View({ path }: { path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <div ref={ref} tabIndex={0} data-testid="view" data-path={path} />;
}

const STORAGE_KEY = 'noto-explorer-expanded';
const initialWorkspace = useWorkspace.getState();

let container: HTMLDivElement;
let root: Root;

const tree = () => document.querySelector<HTMLDivElement>('.explorer-tree')!;
const row = (path: string) => document.querySelector<HTMLDivElement>(`[data-testid="explorer-item"][data-path="${path}"]`);
const focusedRow = () => document.querySelector('.explorer-row.is-focused')?.getAttribute('data-path') ?? null;
const view = () => document.querySelector<HTMLDivElement>('[data-testid="view"]');
const stored = (): string[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];

async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

async function click(target: Element) {
  await act(async () => {
    // A real mousedown focuses the tree (the row's nearest focusable ancestor) before the click lands.
    tree().focus();
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount() {
  await act(async () => {
    root.render(
      <>
        <FileExplorer />
        <FocusingView />
      </>,
    );
  });
}

beforeEach(async () => {
  app.vault.adapter = new MemoryAdapter();
  await app.vault.load();
  for (const path of ['a.md', 'b.md', 'c.md', 'Projects/Sub/note.md']) await app.vault.create(path, '');
  await app.vault.createFolder('Daily');
  useWorkspace.setState({ ...initialWorkspace, openTabs: [], activeFile: null, history: [], historyIndex: -1 });
  useWorkspace.getState().openFile('a.md');
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('FileExplorer focus', () => {
  it('keeps keyboard focus in the tree when a file is opened by clicking it', async () => {
    await mount();
    expect(view()?.dataset.path).toBe('a.md');

    await click(row('b.md')!);
    expect(useWorkspace.getState().activeFile).toBe('b.md');
    expect(view()?.dataset.path).toBe('b.md');
    expect(document.activeElement).toBe(tree());
    expect(focusedRow()).toBe('b.md');

    // Arrow keys and Delete still drive the tree instead of the newly mounted view.
    await press(tree(), 'ArrowDown');
    expect(focusedRow()).toBe('c.md');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await press(tree(), 'Delete');
    expect(confirm).toHaveBeenCalledWith('Delete "c.md"?');
  });

  it('keeps keyboard focus in the tree when a file is opened with Enter', async () => {
    await mount();
    await act(async () => tree().focus());
    expect(focusedRow()).toBe('a.md');
    await press(tree(), 'ArrowDown');
    expect(focusedRow()).toBe('b.md');

    await press(tree(), 'Enter');
    expect(view()?.dataset.path).toBe('b.md');
    expect(document.activeElement).toBe(tree());

    await press(tree(), 'ArrowDown');
    expect(focusedRow()).toBe('c.md');
  });

  it('lets the view take focus when a file is opened from elsewhere', async () => {
    await mount();
    await act(async () => useWorkspace.getState().openFile('c.md'));
    expect(document.activeElement).toBe(view());
  });
});

describe('FileExplorer expanded folders', () => {
  it('follows a folder rename with the expanded state of the folder and its subfolders', async () => {
    await mount();
    await click(row('Projects')!);
    await click(row('Projects/Sub')!);
    expect(row('Projects/Sub/note.md')).not.toBeNull();
    expect(stored().sort()).toEqual(['Projects', 'Projects/Sub']);

    await press(tree(), 'ArrowUp');
    expect(focusedRow()).toBe('Projects');
    await press(tree(), 'F2');
    const input = document.querySelector<HTMLInputElement>('[data-testid="explorer-rename-input"]')!;
    await typeInto(input, 'Work');
    await press(input, 'Enter');
    await act(async () => {
      await vi.waitFor(() => expect(row('Work')).not.toBeNull());
    });

    expect(row('Work')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('Work/Sub')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('Work/Sub/note.md')).not.toBeNull();
    expect(stored().sort()).toEqual(['Work', 'Work/Sub']);
  });

  it('drops the expanded state of a deleted folder and its subfolders', async () => {
    await mount();
    await click(row('Projects')!);
    await click(row('Projects/Sub')!);
    await press(tree(), 'ArrowUp');
    expect(focusedRow()).toBe('Projects');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await press(tree(), 'Delete');
    await act(async () => {
      await vi.waitFor(() => expect(row('Projects')).toBeNull());
    });
    expect(stored()).toEqual([]);

    // A folder created later with the same name starts collapsed.
    await act(async () => {
      await app.vault.createFolder('Projects');
    });
    expect(row('Projects')?.getAttribute('aria-expanded')).toBe('false');
  });
});
