import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { MemoryAdapter } from '../core/vault/storage';
import { useWorkspace } from '../state/store';
import { openLink, registerCoreCommands } from './coreCommands';

describe('openLink', () => {
  beforeEach(async () => {
    await app.vault.switchAdapter(new MemoryAdapter({ files: [{ path: 'Welcome.md', content: '', mtime: 1 }], folders: [] }));
    useWorkspace.setState({ activeFile: 'Welcome.md', openTabs: ['Welcome.md'], history: ['Welcome.md'], historyIndex: 0 });
  });

  it('does not create a note for targets that normalise to nothing or to an invalid name', async () => {
    for (const target of ['/', '..', '.', 'a:b']) await openLink(target, 'Welcome.md');
    expect(app.vault.getFiles().map((f) => f.path)).toEqual(['Welcome.md']);
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
  });

  it('refuses targets with ".", ".." or empty segments rather than creating the normalised path', async () => {
    // Same rule as the quick switcher, which shows "Cannot create" for these; a click must not create New.md either.
    for (const target of ['Projects/../New', '../New', './New', 'a//New', '/New', 'New/']) await openLink(target, 'Welcome.md');
    expect(app.vault.getFiles().map((f) => f.path)).toEqual(['Welcome.md']);
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
  });

  it('creates and opens a missing note next to the source note', async () => {
    await openLink('Ideas inbox', 'Projects/Roadmap.md');
    expect(app.vault.exists('Projects/Ideas inbox.md')).toBe(true);
    expect(useWorkspace.getState().activeFile).toBe('Projects/Ideas inbox.md');
  });
});

describe('core commands', () => {
  let unregister: () => void;
  beforeEach(() => {
    unregister = registerCoreCommands();
  });
  afterEach(() => unregister());

  it('ignores the reading view toggle while the graph is open', async () => {
    const s = () => useWorkspace.getState();
    useWorkspace.setState({ activeFile: 'a.md', openTabs: ['a.md'], viewModes: {}, graphOpen: true });
    expect(await app.commands.execute('view:toggle-mode')).toBe(false);
    expect(s().viewModes).toEqual({});
    expect(app.commands.list().some((c) => c.id === 'view:toggle-mode')).toBe(false);
    s().setGraphOpen(false);
    expect(await app.commands.execute('view:toggle-mode')).toBe(true);
    expect(s().getViewMode('a.md')).toBe('preview');
  });

  it('focuses the search box every time the search command runs', async () => {
    const before = useWorkspace.getState().searchFocusRequest;
    await app.commands.execute('search:open');
    await app.commands.execute('search:open');
    expect(useWorkspace.getState().searchFocusRequest).toBe(before + 2);
    expect(useWorkspace.getState().leftTab).toBe('search');
    expect(useWorkspace.getState().leftSidebarOpen).toBe(true);
  });

  it('keeps new-note and close-tab off the chords browsers reserve', () => {
    expect(app.commands.get('file:new')?.hotkey).toBe('Mod+Alt+N');
    expect(app.commands.get('file:close')?.hotkey).toBe('Mod+Alt+W');
  });

  it('uses Alt+Arrow for history navigation on this platform', () => {
    expect(app.commands.get('nav:back')?.hotkey).toBe('Alt+ArrowLeft');
    expect(app.commands.get('nav:forward')?.hotkey).toBe('Alt+ArrowRight');
  });
});

describe('history hotkeys on macOS', () => {
  it('leave Option+Arrow to CodeMirror word movement', async () => {
    const original = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    vi.resetModules();
    try {
      const [{ registerCoreCommands: register }, { app: macApp }, registry, extensions, { defaultKeymap, cursorGroupLeft, cursorGroupRight }] =
        await Promise.all([import('./coreCommands'), import('../app'), import('./registry'), import('../features/editor/extensions'), import('@codemirror/commands')]);
      expect(registry.IS_MAC).toBe(true);
      const off = register();
      expect(macApp.commands.get('nav:back')?.hotkey).toBe('Ctrl+Alt+ArrowLeft');
      expect(macApp.commands.get('nav:forward')?.hotkey).toBe('Ctrl+Alt+ArrowRight');
      const reserved = new Set(
        macApp.commands
          .list()
          .map((c) => c.hotkey)
          .filter((h): h is string => h !== undefined)
          .map(registry.normalizeHotkey),
      );
      const kept = extensions.withoutReserved(defaultKeymap, reserved);
      expect(kept.some((b) => b.run === cursorGroupLeft)).toBe(true);
      expect(kept.some((b) => b.run === cursorGroupRight)).toBe(true);
      off();
    } finally {
      Object.defineProperty(navigator, 'platform', { value: original, configurable: true });
      vi.resetModules();
    }
  });
});
