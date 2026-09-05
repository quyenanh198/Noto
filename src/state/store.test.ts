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

  it('stores navigation targets until consumed', () => {
    const s = () => useWorkspace.getState();
    s().openFile('a.md', { heading: 'H' });
    expect(s().consumeNavigation()).toEqual({ path: 'a.md', heading: 'H', line: undefined });
    expect(s().consumeNavigation()).toBeNull();
  });
});
