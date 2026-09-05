import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from '../../state/store';
import { FileSystemAccessAdapter, type DirectoryHandle, type FileHandle } from './fsa';
import { MemoryAdapter } from './storage';
import { Vault } from './Vault';
import {
  BROWSER_VAULT_LABEL,
  activateVault,
  getBrowserAdapter,
  getPendingFolder,
  isFsaSupported,
  loadSavedVault,
  loadVaultChoice,
  openFolderVault,
  pendingFolderFrom,
  resolveSavedVault,
  saveVaultChoice,
  useBrowserVault,
  vaultLabelFor,
  type VaultHost,
} from './vaultManager';

/**
 * Minimal directory handle. Methods live on the prototype so the instance survives the
 * structured clone IndexedDB applies (only own properties are copied), like a real handle.
 */
class FakeHandle implements DirectoryHandle {
  readonly kind = 'directory' as const;
  constructor(
    public readonly name: string,
    public permission: PermissionState = 'granted',
  ) {}
  async *values(): AsyncGenerator<DirectoryHandle | FileHandle> {}
  getDirectoryHandle(): Promise<DirectoryHandle> {
    return Promise.reject(new Error('not implemented'));
  }
  getFileHandle(): Promise<FileHandle> {
    return Promise.reject(new Error('not implemented'));
  }
  removeEntry(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }
  async requestPermission(): Promise<PermissionState> {
    return this.permission;
  }
}

function makeHost(files: Record<string, string> = {}): VaultHost & { attach: ReturnType<typeof vi.fn> } {
  const vault = new Vault(new MemoryAdapter({ files: Object.entries(files).map(([path, content]) => ({ path, content, mtime: 1 })), folders: [] }));
  const attach = vi.fn();
  return { vault, index: { attach }, attach };
}

const picker = (impl: () => Promise<DirectoryHandle>) => Object.defineProperty(window, 'showDirectoryPicker', { value: impl, configurable: true });

afterEach(() => {
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('vaultManager', () => {
  it('reports the File System Access API as unsupported in this environment', () => {
    expect(isFsaSupported()).toBe(false);
    picker(() => Promise.reject(new Error('x')));
    expect(isFsaSupported()).toBe(true);
  });

  it('falls back to browser storage when nothing is saved', async () => {
    expect(await loadVaultChoice()).toBeNull();
    const adapter = await loadSavedVault();
    expect(adapter.kind).toBe('indexeddb');
    expect(adapter).toBe(getBrowserAdapter());
    expect(await getPendingFolder()).toBeNull();
    expect(vaultLabelFor(adapter)).toBe(BROWSER_VAULT_LABEL);
  });

  it('persists the vault choice in the settings database', async () => {
    await saveVaultChoice({ kind: 'indexeddb' });
    expect(await loadVaultChoice()).toEqual({ kind: 'indexeddb' });
    const handle = new FakeHandle('My Notes');
    await saveVaultChoice({ kind: 'fsa', handle, name: 'My Notes' });
    const saved = await loadVaultChoice();
    expect(saved?.kind).toBe('fsa');
    if (saved?.kind === 'fsa') {
      expect(saved.name).toBe('My Notes');
      expect(saved.handle.name).toBe('My Notes');
    }
    await saveVaultChoice({ kind: 'indexeddb' });
  });

  it('opens the saved folder only while permission is granted', async () => {
    const granted = new FakeHandle('Granted', 'granted');
    const adapter = await resolveSavedVault({ kind: 'fsa', handle: granted, name: 'Granted' });
    expect(adapter).toBeInstanceOf(FileSystemAccessAdapter);
    expect(vaultLabelFor(adapter)).toBe('Granted');
    expect(await pendingFolderFrom({ kind: 'fsa', handle: granted, name: 'Granted' })).toBeNull();

    const prompt = new FakeHandle('Later', 'prompt');
    const fallback = await resolveSavedVault({ kind: 'fsa', handle: prompt, name: 'Later' });
    expect(fallback.kind).toBe('indexeddb');
    expect(await pendingFolderFrom({ kind: 'fsa', handle: prompt, name: 'Later' })).toEqual({ name: 'Later', handle: prompt });
    expect(await pendingFolderFrom({ kind: 'indexeddb' })).toBeNull();
    expect(await pendingFolderFrom(null)).toBeNull();
  });

  it('treats a handle that cannot be queried as needing reconnection', async () => {
    const broken = { kind: 'directory', name: 'Broken' } as unknown as DirectoryHandle;
    expect((await resolveSavedVault({ kind: 'fsa', handle: broken, name: 'Broken' })).kind).toBe('indexeddb');
    expect((await pendingFolderFrom({ kind: 'fsa', handle: broken, name: 'Broken' }))?.name).toBe('Broken');
  });

  it('activates an adapter: reloads, re-attaches the index and opens the first note', async () => {
    const host = makeHost({ 'Old.md': 'old' });
    await host.vault.load();
    const ws = useWorkspace.getState();
    ws.openFile('Old.md');
    ws.openFile('Other.md', { newTab: true });
    expect(useWorkspace.getState().openTabs).toEqual(['Old.md', 'Other.md']);

    const next = new MemoryAdapter({ files: [{ path: 'Notes/Zeta.md', content: 'z', mtime: 1 }, { path: 'Notes/Alpha.md', content: 'a', mtime: 1 }], folders: [] });
    await activateVault(host, next);
    expect(host.vault.adapter).toBe(next);
    expect(host.vault.getFiles().map((f) => f.path)).toEqual(['Notes/Alpha.md', 'Notes/Zeta.md']);
    expect(host.attach).toHaveBeenCalledTimes(1);
    expect(useWorkspace.getState().openTabs).toEqual(['Notes/Alpha.md']);
    expect(useWorkspace.getState().activeFile).toBe('Notes/Alpha.md');
    expect(useWorkspace.getState().vaultLabel).toBe(BROWSER_VAULT_LABEL);

    const welcome = new MemoryAdapter({ files: [{ path: 'Welcome.md', content: 'w', mtime: 1 }, { path: 'A.md', content: 'a', mtime: 1 }], folders: [] });
    await activateVault(host, welcome);
    expect(useWorkspace.getState().activeFile).toBe('Welcome.md');
  });

  it('rejects opening a folder when the picker is unavailable and ignores cancellation', async () => {
    const host = makeHost();
    await expect(openFolderVault(host)).rejects.toThrow(/does not support/);
    picker(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    expect(await openFolderVault(host)).toBe(false);
    expect(host.attach).not.toHaveBeenCalled();
  });

  it('opens a picked folder, saves it and switches the vault; browser storage switches back', async () => {
    const host = makeHost({ 'Old.md': 'old' });
    await host.vault.load();
    const handle = new FakeHandle('Picked');
    picker(async () => handle);
    expect(await openFolderVault(host)).toBe(true);
    expect(host.vault.adapter).toBeInstanceOf(FileSystemAccessAdapter);
    expect(host.vault.getFiles()).toEqual([]);
    expect(useWorkspace.getState().vaultLabel).toBe('Picked');
    const saved = await loadVaultChoice();
    expect(saved?.kind).toBe('fsa');
    if (saved?.kind === 'fsa') expect(saved.name).toBe('Picked');

    const denied = new FakeHandle('Denied', 'denied');
    picker(async () => denied);
    await expect(openFolderVault(host)).rejects.toThrow(/not granted/);
    expect(useWorkspace.getState().vaultLabel).toBe('Picked');

    await useBrowserVault(host);
    expect(host.vault.adapter).toBe(getBrowserAdapter());
    expect(useWorkspace.getState().vaultLabel).toBe(BROWSER_VAULT_LABEL);
    expect(await loadVaultChoice()).toEqual({ kind: 'indexeddb' });
    expect(await getPendingFolder()).toBeNull();
  });
});
