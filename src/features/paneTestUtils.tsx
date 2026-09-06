import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { app } from '../app';
import { MemoryAdapter } from '../core/vault/storage';
import { useWorkspace } from '../state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Point the app singleton at an in-memory vault holding `files`, rebuild the index and reset the workspace. */
export async function seedApp(files: Record<string, string>): Promise<void> {
  app.index.detach();
  app.vault.adapter = new MemoryAdapter({ files: Object.entries(files).map(([path, content]) => ({ path, content, mtime: 1 })), folders: [] });
  await app.vault.load();
  app.index.attach();
  useWorkspace.getState().closeAllTabs();
}

/** Render `element` into the document; call `unmount` when done. */
export function mount(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Dispatch a bubbling keydown for `key` on `el` and return the event (to inspect `defaultPrevented`). */
export function keydown(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Let pending vault writes and index updates flush into React. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
