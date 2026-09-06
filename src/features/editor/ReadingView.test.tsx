import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../app';
import { MemoryAdapter } from '../../core/vault/storage';
import { useWorkspace } from '../../state/store';
import { findNavigationTarget, ReadingView } from './ReadingView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notes: Record<string, string> = {
  'Welcome.md': '# Title\n\nline one\nline two\n\nSee [[Linking notes]] and #tag and [rel](Linking%20notes.md) and [back](#title)',
  'Linking notes.md': '# Linking notes\n\nback to [[Welcome]]',
};

const scrollIntoView = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  Element.prototype.scrollIntoView = scrollIntoView;
  const files = Object.entries(notes).map(([path, content]) => ({ path, content, mtime: 0 }));
  await app.vault.switchAdapter(new MemoryAdapter({ files, folders: [] }));
});

beforeEach(async () => {
  scrollIntoView.mockClear();
  useWorkspace.setState({ openTabs: ['Welcome.md'], activeFile: 'Welcome.md', pendingNavigation: null, searchQuery: '', leftTab: 'files' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ReadingView path="Welcome.md" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function fire(el: Element, type: string, init: MouseEventInit): Promise<MouseEvent> {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    el.dispatchEvent(event);
  });
  return event;
}

const linkByText = (text: string) => [...container.querySelectorAll('a')].find((a) => a.textContent === text) as HTMLAnchorElement;

describe('ReadingView clicks', () => {
  it('middle-click opens an internal link in a new tab instead of a new browser tab', async () => {
    const event = await fire(linkByText('Linking notes'), 'auxclick', { button: 1 });
    expect(event.defaultPrevented).toBe(true);
    const ws = useWorkspace.getState();
    expect(ws.activeFile).toBe('Linking notes.md');
    expect(ws.openTabs).toEqual(['Welcome.md', 'Linking notes.md']);
  });

  it('middle-click on a tag does not leave the page', async () => {
    const event = await fire(container.querySelector('a.tag') as Element, 'auxclick', { button: 1 });
    expect(event.defaultPrevented).toBe(true);
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
  });

  it('opens a relative markdown link inside the app', async () => {
    const event = await fire(linkByText('rel'), 'click', { button: 0 });
    expect(event.defaultPrevented).toBe(true);
    const ws = useWorkspace.getState();
    expect(ws.activeFile).toBe('Linking notes.md');
    expect(ws.openTabs).toEqual(['Linking notes.md']);
  });

  it('scrolls to the heading of a same-note fragment link', async () => {
    const event = await fire(linkByText('back'), 'click', { button: 0 });
    expect(event.defaultPrevented).toBe(true);
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
    const h1 = container.querySelector('h1[data-heading="Title"]');
    expect(h1).not.toBeNull();
    expect(scrollIntoView.mock.contexts).toEqual([h1]);
  });

  it('re-renders when strict line breaks is toggled', async () => {
    expect(container.querySelectorAll('br')).toHaveLength(1);
    await act(async () => useWorkspace.setState({ strictLineBreaks: true }));
    expect(container.querySelectorAll('br')).toHaveLength(0);
    await act(async () => useWorkspace.setState({ strictLineBreaks: false }));
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });
});

describe('findNavigationTarget', () => {
  it('falls back to the slug of the heading text when the id was stripped', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1 data-heading="Title!">Title!</h1><h2 id="summary" data-heading="Summary">Summary</h2>';
    expect(findNavigationTarget(root, { path: 'x', heading: 'title' })).toBe(root.firstElementChild);
    expect(findNavigationTarget(root, { path: 'x', heading: 'SUMMARY' })).toBe(root.lastElementChild);
    expect(findNavigationTarget(root, { path: 'x', heading: 'nope' })).toBeNull();
  });

  it('uses a top-level embed as a line target but ignores blocks inside embeds', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p data-line="0">a</p>' +
      '<div class="markdown-embed" data-line="2"><div class="markdown-embed-content"><p data-line="3">x</p><h1 data-heading="Inner">Inner</h1></div></div>' +
      '<p data-line="6">b</p>';
    expect(findNavigationTarget(root, { path: 'x', line: 4 })).toBe(root.children[1]);
    expect(findNavigationTarget(root, { path: 'x', line: 7 })).toBe(root.children[2]);
    expect(findNavigationTarget(root, { path: 'x', heading: 'Inner' })).toBeNull();
  });
});
