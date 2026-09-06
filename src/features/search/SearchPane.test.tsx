import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app';
import { MemoryAdapter } from '../../core/vault/storage';
import { useWorkspace } from '../../state/store';
import { SearchPane } from './SearchPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Longer than the pane's search debounce. */
const SETTLE_MS = 250;

let host: HTMLDivElement;
let root: Root;

const rowsOf = (path: string) => Array.from(host.querySelectorAll<HTMLElement>(`[data-path="${path}"] [data-testid="search-result-match"]`));
const selectedCount = (selector: string) => host.querySelectorAll(`${selector}.is-selected`).length;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  });
}

async function search(query: string) {
  await act(async () => {
    useWorkspace.getState().setSearchQuery(query);
  });
  await settle();
}

async function press(key: string) {
  await act(async () => {
    host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = () => {};
  app.vault.adapter = new MemoryAdapter();
  await app.vault.load();
  await app.vault.create('Linking notes.md', 'Links are the heart of a link graph.\nplain line\nlink me');
  await app.vault.create('Other.md', 'One link here.');
});

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<SearchPane />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  useWorkspace.getState().setSearchQuery('');
});

describe('SearchPane results', () => {
  it('renders one row per matching line and highlights every hit on it', async () => {
    await search('link');
    const linking = rowsOf('Linking notes.md');
    expect(linking.map((r) => r.dataset.line)).toEqual(['0', '2']);
    expect(Array.from(linking[0].querySelectorAll('mark'), (m) => m.textContent)).toEqual(['Link', 'link']);
    expect(linking[1].querySelectorAll('mark')).toHaveLength(1);
    expect(rowsOf('Other.md')).toHaveLength(1);
    // The badge and the summary count matches (as Obsidian does), not rows.
    expect(host.querySelector('[data-path="Linking notes.md"] .search-result-count')?.textContent).toBe('3');
    expect(host.querySelector('[data-testid="search-summary"]')?.textContent).toBe('4 results in 2 files');
  });

  it('steps the keyboard selection through distinct lines', async () => {
    await search('link');
    await press('ArrowDown');
    await press('ArrowDown');
    const selected = host.querySelectorAll<HTMLElement>('.search-result-match.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].closest('[data-path]')?.getAttribute('data-path')).toBe('Linking notes.md');
    expect(selected[0].dataset.line).toBe('2');
    await press('Enter');
    expect(useWorkspace.getState().pendingNavigation).toEqual({ path: 'Linking notes.md', heading: undefined, line: 2 });
  });
});

describe('SearchPane header selection', () => {
  it('does not mark file headers as selected while no row is selected', async () => {
    await search('link');
    expect(host.querySelectorAll('.search-result-header')).toHaveLength(2);
    expect(host.querySelectorAll('.is-selected')).toHaveLength(0);
    await press('ArrowDown');
    expect(selectedCount('.search-result-header')).toBe(0);
    expect(selectedCount('.search-result-match')).toBe(1);
    // A vault edit re-runs the search; headers stay unselected and the cursor survives the refresh.
    await act(async () => {
      await app.vault.modify('Other.md', 'One link here!');
    });
    await settle();
    expect(selectedCount('.search-result-header')).toBe(0);
    expect(selectedCount('.search-result-match')).toBe(1);
  });

  it('still selects a collapsed file header through the keyboard', async () => {
    await search('link');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="Collapse results"]')!.click();
    });
    expect(host.querySelectorAll('[data-testid="search-result-match"]')).toHaveLength(0);
    await press('ArrowDown');
    expect(selectedCount('.search-result-header')).toBe(1);
    expect(host.querySelector('.search-result-header.is-selected')?.getAttribute('title')).toBe('Linking notes.md');
  });
});
