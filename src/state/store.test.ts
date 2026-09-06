import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from './store';

const initial = useWorkspace.getState();

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspace.setState({ ...initial, openTabs: [], activeFile: null, history: [], historyIndex: -1, viewModes: {} });
  });

  it('opens files replacing the active tab, or in a new tab', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md');
    s().openFile('b.md');
    expect(s().openTabs).toEqual(['b.md']);
    s().openFile('c.md', { newTab: true });
    expect(s().openTabs).toEqual(['b.md', 'c.md']);
    s().openFile('b.md');
    expect(s().activeFile).toBe('b.md');
    expect(s().openTabs).toEqual(['b.md', 'c.md']);
  });

  it('closes tabs and picks a neighbour', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md', { newTab: true });
    s().openFile('b.md', { newTab: true });
    s().openFile('c.md', { newTab: true });
    s().setActiveTab('b.md');
    s().closeTab('b.md');
    expect(s().activeFile).toBe('c.md');
    s().closeTab('c.md');
    expect(s().activeFile).toBe('a.md');
    s().closeTab('a.md');
    expect(s().activeFile).toBeNull();
  });

  it('tracks history for back/forward', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md');
    s().openFile('b.md');
    s().openFile('c.md');
    s().goBack();
    expect(s().activeFile).toBe('b.md');
    s().goBack();
    expect(s().activeFile).toBe('a.md');
    s().goForward();
    expect(s().activeFile).toBe('b.md');
    s().openFile('d.md');
    expect(s().history).toEqual(['a.md', 'b.md', 'd.md']);
  });

  it('follows renames and deletes', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md');
    s().setViewMode('a.md', 'preview');
    s().fileRenamed('a.md', 'z.md');
    expect(s().activeFile).toBe('z.md');
    expect(s().getViewMode('z.md')).toBe('preview');
    s().fileDeleted('z.md');
    expect(s().openTabs).toEqual([]);
    expect(s().getViewMode('z.md')).toBe('source');
  });

  it('remaps tabs, history and view modes under a renamed folder', () => {
    const s = () => useWorkspace.getState();
    s().openFile('Projects/a.md', { newTab: true });
    s().openFile('Projects/sub/b.md', { newTab: true });
    s().openFile('Other/c.md', { newTab: true });
    s().setViewMode('Projects/a.md', 'preview');
    s().setActiveTab('Projects/sub/b.md');
    s().folderRenamed('Projects', 'Work');
    expect(s().openTabs).toEqual(['Work/a.md', 'Work/sub/b.md', 'Other/c.md']);
    expect(s().activeFile).toBe('Work/sub/b.md');
    expect(s().history).toEqual(['Work/a.md', 'Work/sub/b.md', 'Other/c.md']);
    expect(s().getViewMode('Work/a.md')).toBe('preview');
    expect(s().getViewMode('Projects/a.md')).toBe('source');
  });

  it('prunes deleted files from history so back/forward cannot resurrect them', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md');
    s().openFile('b.md');
    s().fileDeleted('b.md');
    expect(s().history).toEqual(['a.md']);
    expect(s().activeFile).toBeNull();
    // Deleting the current note leaves the workspace empty, but Back still returns to the note before it.
    s().goBack();
    expect(s().activeFile).toBe('a.md');
    s().goForward();
    expect(s().activeFile).toBe('a.md');
    expect(s().openTabs).toEqual(['a.md']);

    s().openFile('b.md', { newTab: true });
    s().openFile('c.md', { newTab: true });
    s().fileDeleted('b.md');
    expect(s().history).toEqual(['a.md', 'c.md']);
    expect(s().historyIndex).toBe(1);
    s().goBack();
    expect(s().activeFile).toBe('a.md');
    expect(s().openTabs).toEqual(['a.md', 'c.md']);
  });

  it('ignores the view mode toggle while the graph is open', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md');
    s().setGraphOpen(true);
    s().toggleViewMode();
    expect(s().viewModes).toEqual({});
    s().setGraphOpen(false);
    s().toggleViewMode();
    expect(s().getViewMode('a.md')).toBe('preview');
  });

  it('focusSearch opens the search pane and bumps the focus request', () => {
    const s = () => useWorkspace.getState();
    useWorkspace.setState({ leftSidebarOpen: false, leftTab: 'files' });
    const before = s().searchFocusRequest;
    s().focusSearch();
    expect(s().leftTab).toBe('search');
    expect(s().leftSidebarOpen).toBe(true);
    expect(s().searchFocusRequest).toBe(before + 1);
    s().focusSearch();
    expect(s().searchFocusRequest).toBe(before + 2);
  });

  it('stores navigation targets until consumed', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md', { heading: 'H' });
    expect(s().consumeNavigation()).toEqual({ path: 'a.md', heading: 'H', line: undefined });
    expect(s().consumeNavigation()).toBeNull();
  });
});
