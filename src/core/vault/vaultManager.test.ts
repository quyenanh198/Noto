import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashText, readDraft, replayDraft, writeDraft } from '../../features/editor/draftJournal';
import { useWorkspace } from '../../state/store';
import { FileSystemAccessAdapter, type DirectoryHandle, type FileHandle, type FileLike, type WritableLike } from './fsa';
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
  reconnectFolder,
  resolveSavedVault,
  saveVaultChoice,
  switchToBrowserVault,
  vaultLabelFor,
  type VaultHost,
} from './vaultManager';

class FakeFileHandle implements FileHandle {
  readonly kind = 'file' as const;
  constructor(
    public readonly name: string,
    public content: string,
    public lastModified = 1000,
  ) {}
  async getFile(): Promise<FileLike> {
    return {
      lastModified: this.lastModified,
      text: async () => this.content,
      arrayBuffer: async () => new TextEncoder().encode(this.content).buffer as ArrayBuffer,
    };
  }
  async createWritable(): Promise<WritableLike> {
    let buffer = '';
    return {
      write: async (data) => {
        buffer += typeof data === 'string' ? data : new TextDecoder().decode(data);
      },
      close: async () => {
        this.content = buffer;
      },
    };
  }
}

/**
 * Minimal directory handle holding flat files. Methods live on the prototype so the instance survives
 * the structured clone IndexedDB applies (only own properties are copied), like a real handle.
 */
class FakeHandle implements DirectoryHandle {
  readonly kind = 'directory' as const;
  files = new Map<string, FakeFileHandle>();
  /** Stands in for the disk entry, so a stored clone still compares equal to the original (as real handles do). */
  readonly entry = Math.random();
  constructor(
    public readonly name: string,
    public permission: PermissionState = 'granted',
  ) {}
  async isSameEntry(other: DirectoryHandle | FileHandle): Promise<boolean> {
    return (other as { entry?: number }).entry === this.entry;
  }
  async *values(): AsyncGenerator<DirectoryHandle | FileHandle> {
    yield* this.files.values();
  }
  getDirectoryHandle(): Promise<DirectoryHandle> {
    return Promise.reject(new Error('not implemented'));
  }
  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const file = new FakeFileHandle(name, '');
    this.files.set(name, file);
    return file;
  }
  removeEntry(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }
  /** Like the browser prompt with the user clicking Allow: a lapsed permission is granted, a denied one stays denied. */
  async requestPermission(): Promise<PermissionState> {
    if (this.permission === 'prompt') this.permission = 'granted';
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

  it('closes the open tabs before switching so pending edits still reach the old vault', async () => {
    const host = makeHost({ 'Old.md': 'old' });
    await host.vault.load();
    useWorkspace.getState().openFile('Old.md');
    const next = new MemoryAdapter();
    let tabsWhileLoading: string[] | null = null;
    next.load = async () => {
      tabsWhileLoading = useWorkspace.getState().openTabs;
      return { files: [], folders: [] };
    };
    await activateVault(host, next);
    expect(tabsWhileLoading).toEqual([]);
  });

  it('leaves the current vault in place when the new adapter fails to load', async () => {
    const host = makeHost({ 'Old.md': 'old' });
    await host.vault.load();
    const before = host.vault.adapter;
    useWorkspace.getState().setVaultLabel('Before');
    const broken = new MemoryAdapter();
    broken.load = () => Promise.reject(new Error('unreadable'));
    await expect(activateVault(host, broken)).rejects.toThrow('unreadable');
    expect(host.vault.adapter).toBe(before);
    expect(host.vault.getFiles().map((f) => f.path)).toEqual(['Old.md']);
    expect(host.attach).not.toHaveBeenCalled();
    expect(useWorkspace.getState().vaultLabel).toBe('Before');
  });

  it('does not remember a picked folder that fails to load', async () => {
    await saveVaultChoice({ kind: 'indexeddb' });
    const host = makeHost({ 'Old.md': 'old' });
    await host.vault.load();
    const handle = new FakeHandle('Broken');
    handle.values = async function* () {
      throw new DOMException('gone', 'NotFoundError');
    };
    picker(async () => handle);
    await expect(openFolderVault(host)).rejects.toThrow(/gone/);
    expect(await loadVaultChoice()).toEqual({ kind: 'indexeddb' });
    expect(host.vault.adapter.kind).toBe('memory');
    expect(host.vault.getFiles().map((f) => f.path)).toEqual(['Old.md']);
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

    await switchToBrowserVault(host);
    expect(host.vault.adapter).toBe(getBrowserAdapter());
    expect(useWorkspace.getState().vaultLabel).toBe(BROWSER_VAULT_LABEL);
    expect(await loadVaultChoice()).toEqual({ kind: 'indexeddb' });
    expect(await getPendingFolder()).toBeNull();
  });

  it('replays the draft journal into a folder reconnected after a browser restart and opens the recovered note', async () => {
    try {
      const host = makeHost({ 'Browser.md': 'b' });
      await host.vault.load();
      const handle = new FakeHandle('Notes', 'prompt');
      handle.files.set('Welcome.md', new FakeFileHandle('Welcome.md', 'welcome', 1000));
      handle.files.set('A.md', new FakeFileHandle('A.md', 'old', 1000));
      await saveVaultChoice({ kind: 'fsa', handle, name: 'Notes' });
      const saved = await loadVaultChoice();
      const folderId = saved?.kind === 'fsa' ? saved.id : '';
      // What the last session journaled while typing into the folder; the interrupted write never reached the disk.
      writeDraft({ vault: `fsa:${folderId}`, path: 'A.md', content: 'old plus typed', seen: [hashText('old')] });

      // After a restart the folder's permission is back to 'prompt', so bootstrap runs on browser storage and keeps the draft.
      expect((await resolveSavedVault(saved)).kind).toBe('indexeddb');
      expect(await replayDraft(host.vault)).toBe(false);
      expect(readDraft()?.content).toBe('old plus typed');

      await reconnectFolder(host, { name: 'Notes', handle });
      expect(host.vault.adapter.kind).toBe('fsa');
      expect(host.vault.getFile('A.md')?.content).toBe('old plus typed');
      expect(handle.files.get('A.md')?.content).toBe('old plus typed');
      expect(readDraft()).toBeNull();
      expect(useWorkspace.getState().activeFile).toBe('A.md');
    } finally {
      localStorage.clear();
      await saveVaultChoice({ kind: 'indexeddb' });
    }
  });

  it('gives a picked folder a lasting identity that another folder of the same name does not share', async () => {
    const host = makeHost();
    await host.vault.load();
    const notes = new FakeHandle('Notes');
    picker(async () => notes);
    expect(await openFolderVault(host)).toBe(true);
    const first = host.vault.adapter as FileSystemAccessAdapter;
    expect(first.id).toMatch(/\S/);
    const saved = await loadVaultChoice();
    expect(saved?.kind === 'fsa' ? saved.id : undefined).toBe(first.id);

    // Picking the same folder again (after a browser restart, say) keeps the identity...
    expect(await openFolderVault(host)).toBe(true);
    expect((host.vault.adapter as FileSystemAccessAdapter).id).toBe(first.id);

    // ...while a different folder, however it is called, is another vault.
    picker(async () => new FakeHandle('Notes'));
    expect(await openFolderVault(host)).toBe(true);
    expect((host.vault.adapter as FileSystemAccessAdapter).id).not.toBe(first.id);
    await switchToBrowserVault(host);
  });

  it('assigns an identity to a folder remembered before folders had one, and keeps it', async () => {
    const handle = new FakeHandle('Old');
    await saveVaultChoice({ kind: 'fsa', handle, name: 'Old' });
    const loaded = await loadVaultChoice();
    const id = loaded?.kind === 'fsa' ? loaded.id : undefined;
    expect(id).toMatch(/\S/);
    const again = await loadVaultChoice();
    expect(again?.kind === 'fsa' ? again.id : undefined).toBe(id);
    expect(await resolveSavedVault({ kind: 'fsa', handle, name: 'Old', id })).toHaveProperty('id', id);
    await saveVaultChoice({ kind: 'indexeddb' });
  });
});
