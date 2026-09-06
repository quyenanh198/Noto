import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, bootstrap } from './app';
import { MemoryAdapter } from './core/vault/storage';
import { getBrowserAdapter, loadSavedVault } from './core/vault/vaultManager';
import { useWorkspace } from './state/store';

vi.mock('./core/vault/vaultManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core/vault/vaultManager')>();
  return { ...actual, loadSavedVault: vi.fn(actual.loadSavedVault) };
});

const SAMPLE_PATHS = ['Linking notes.md', 'Markdown syntax.md', 'Projects/Noto roadmap.md', 'Welcome.md'];

describe('bootstrap', () => {
  beforeEach(() => {
    vi.mocked(loadSavedVault).mockImplementation(async () => getBrowserAdapter());
  });

  it('seeds the sample vault on first launch and puts the opened note into history', async () => {
    await bootstrap();
    const ws = useWorkspace.getState();
    expect(ws.ready).toBe(true);
    expect(app.vault.getFiles().map((f) => f.path)).toEqual(SAMPLE_PATHS);
    expect(ws.activeFile).toBe('Welcome.md');
    expect(ws.history).toEqual(['Welcome.md']);
    expect(ws.historyIndex).toBe(0);
  });

  it('makes the restored note the first history entry after a reload', async () => {
    // A reload rehydrates the active file and tabs but not the history.
    useWorkspace.setState({ activeFile: 'Welcome.md', openTabs: ['Welcome.md'], history: [], historyIndex: -1, ready: false });
    await bootstrap();
    const s = () => useWorkspace.getState();
    expect(s().ready).toBe(true);
    expect(s().history).toEqual(['Welcome.md']);
    s().openFile('Linking notes.md');
    s().goBack();
    expect(s().activeFile).toBe('Welcome.md');
  });

  it('does not re-create the sample notes in a vault the user emptied', async () => {
    for (const f of app.vault.getFiles()) await app.vault.delete(f.path);
    for (const d of app.vault.getFolders()) if (app.vault.folderExists(d)) await app.vault.deleteFolder(d);
    expect((await app.vault.adapter.load()).files).toEqual([]);
    useWorkspace.setState({ ready: false });
    await bootstrap();
    expect(app.vault.getFiles()).toEqual([]);
    expect(app.vault.getFolders()).toEqual([]);
    expect(useWorkspace.getState().ready).toBe(true);
  });

  it('falls back to browser storage when the saved vault cannot be loaded', async () => {
    const broken = new MemoryAdapter();
    broken.load = () => Promise.reject(new DOMException('gone', 'NotFoundError'));
    vi.mocked(loadSavedVault).mockResolvedValueOnce(broken);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    useWorkspace.setState({ ready: false });
    await bootstrap();
    expect(useWorkspace.getState().ready).toBe(true);
    expect(app.vault.adapter).toBe(getBrowserAdapter());
    expect(app.vault.loaded).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
