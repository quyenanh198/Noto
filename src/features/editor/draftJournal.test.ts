import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSystemAccessAdapter, type DirectoryHandle, type FileHandle, type FileLike, type WritableLike } from '../../core/vault/fsa';
import { MemoryAdapter } from '../../core/vault/storage';
import { Vault } from '../../core/vault/Vault';
import { clearDraft, hashText, readDraft, replayDraft, vaultDraftId, writeDraft } from './draftJournal';

async function vaultWith(content: string, mtime: number): Promise<Vault> {
  const vault = new Vault(new MemoryAdapter({ folders: [], files: [{ path: 'A.md', content, mtime }] }));
  await vault.load();
  return vault;
}

// ----- just enough of the File System Access handles for a folder vault with one file per path -----

class FakeFile implements FileHandle {
  readonly kind = 'file' as const;
  constructor(
    public readonly name: string,
    public content: string,
    public lastModified = 1000,
  ) {}
  async getFile(): Promise<FileLike> {
    return { lastModified: this.lastModified, text: async () => this.content, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  async createWritable(): Promise<WritableLike> {
    let buffer = '';
    return {
      write: async (data) => {
        buffer += typeof data === 'string' ? data : '';
      },
      close: async () => {
        this.content = buffer;
      },
    };
  }
}

class FakeDir implements DirectoryHandle {
  readonly kind = 'directory' as const;
  entries = new Map<string, FakeDir | FakeFile>();
  constructor(public readonly name: string) {}
  async *values(): AsyncGenerator<FakeDir | FakeFile> {
    yield* this.entries.values();
  }
  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FakeDir> {
    const existing = this.entries.get(name);
    if (existing instanceof FakeDir) return existing;
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const dir = new FakeDir(name);
    this.entries.set(name, dir);
    return dir;
  }
  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FakeFile> {
    const existing = this.entries.get(name);
    if (existing instanceof FakeFile) return existing;
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const file = new FakeFile(name, '');
    this.entries.set(name, file);
    return file;
  }
  removeEntry(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }
  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }
}

/** A folder called `name` on some disk, holding `files` (vault-relative path -> content). */
function folder(name: string, files: Record<string, string>): FakeDir {
  const root = new FakeDir(name);
  for (const [path, content] of Object.entries(files)) {
    const segments = path.split('/');
    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      const next = new FakeDir(segment);
      dir.entries.set(segment, next);
      dir = next;
    }
    const file = segments[segments.length - 1];
    dir.entries.set(file, new FakeFile(file, content));
  }
  return root;
}

async function folderVault(root: FakeDir, id?: string): Promise<Vault> {
  const vault = new Vault(new FileSystemAccessAdapter(root, id));
  await vault.load();
  return vault;
}

/** What the fake disk holds at `path` (the vault's in-memory copy is checked separately). */
async function onDisk(root: FakeDir, path: string): Promise<string> {
  let dir = root;
  const segments = path.split('/');
  for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment);
  return (await dir.getFileHandle(segments[segments.length - 1])).content;
}

describe('draft journal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: 5000 });
  });
  afterEach(() => vi.useRealTimers());

  it('round-trips a draft and clears it only when the content matches', () => {
    writeDraft({ vault: 'memory:test', path: 'A.md', content: 'hello', seen: [hashText('hell')] });
    expect(readDraft()).toEqual({ vault: 'memory:test', path: 'A.md', content: 'hello', seen: [hashText('hell')], time: 5000 });
    clearDraft('other');
    expect(readDraft()).not.toBeNull();
    clearDraft('hello');
    expect(readDraft()).toBeNull();
  });

  it('replays a draft newer than the stored file into the vault it came from, then forgets it', async () => {
    const vault = await vaultWith('old', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'old plus typed', seen: [hashText('old')] });
    expect(await replayDraft(vault)).toBe(true);
    expect(vault.getFile('A.md')?.content).toBe('old plus typed');
    expect(readDraft()).toBeNull();
  });

  it('forgets a draft that is already stored or whose file is gone', async () => {
    const vault = await vaultWith('same', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'same', seen: [hashText('old')] });
    expect(await replayDraft(vault)).toBe(false);
    expect(readDraft()).toBeNull();
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'Missing.md', content: 'x', seen: [hashText('old')] });
    expect(await replayDraft(vault)).toBe(false);
    expect(readDraft()).toBeNull();
  });

  it('does not overwrite a file modified after the draft, and keeps drafts of other vaults', async () => {
    const vault = await vaultWith('old', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'stale draft', seen: [hashText('old')] });
    vi.setSystemTime(6000);
    await vault.modify('A.md', 'newer');
    expect(await replayDraft(vault)).toBe(false);
    expect(vault.getFile('A.md')?.content).toBe('newer');
    expect(readDraft()).toBeNull();

    writeDraft({ vault: 'fsa:elsewhere', path: 'A.md', content: 'theirs', seen: [hashText('newer')] });
    expect(await replayDraft(vault)).toBe(false);
    expect(vault.getFile('A.md')?.content).toBe('newer');
    expect(readDraft()?.vault).toBe('fsa:elsewhere');
  });

  it('applies a draft only over a content the editor had in front of it while typing', async () => {
    // The file was replaced under the editor without the clock noticing (a copy with an old mtime, a wrong vault id...).
    const vault = await vaultWith('replaced elsewhere', 1000);
    writeDraft({ vault: vaultDraftId(vault.adapter), path: 'A.md', content: 'old plus typed', seen: [hashText('old')] });
    expect(await replayDraft(vault)).toBe(false);
    expect(vault.getFile('A.md')?.content).toBe('replaced elsewhere');
    expect(readDraft()).toBeNull();

    // Any content the editor opened with or saved since is fine, whichever of those writes made it to disk.
    const partial = await vaultWith('old plus', 1000);
    writeDraft({ vault: vaultDraftId(partial.adapter), path: 'A.md', content: 'old plus typed', seen: [hashText('old'), hashText('old plus')] });
    expect(await replayDraft(partial)).toBe(true);
    expect(partial.getFile('A.md')?.content).toBe('old plus typed');
  });

  it('never replays a draft into another folder that merely shares the name', async () => {
    const path = 'Daily/2026-09-06.md';
    const diary = 'A: my private diary entry';
    const personalDisk = folder('Notes', { [path]: diary, 'Welcome.md': 'welcome' });
    const workDisk = folder('Notes', { [path]: 'B: unrelated work log', 'Welcome.md': 'welcome' });
    const personal = await folderVault(personalDisk);
    const work = await folderVault(workDisk);
    expect(vaultDraftId(personal.adapter)).not.toBe(vaultDraftId(work.adapter));

    // Typed in the personal folder; the page went away before the write landed, and the work folder loaded next.
    writeDraft({ vault: vaultDraftId(personal.adapter), path, content: `${diary} plus new text`, seen: [hashText(diary)] });
    expect(await replayDraft(work)).toBe(false);
    expect(work.getFile(path)?.content).toBe('B: unrelated work log');
    expect(await onDisk(workDisk, path)).toBe('B: unrelated work log');
    expect(readDraft()?.path).toBe(path);

    // A backup copy of the personal folder (same name, same files) is not the personal folder either.
    const backupDisk = folder('Notes', { [path]: diary, 'Welcome.md': 'welcome' });
    const backup = await folderVault(backupDisk);
    expect(await replayDraft(backup)).toBe(false);
    expect(await onDisk(backupDisk, path)).toBe(diary);

    // Back in the personal folder the draft lands.
    expect(await replayDraft(personal)).toBe(true);
    expect(await onDisk(personalDisk, path)).toBe(`${diary} plus new text`);
    expect(readDraft()).toBeNull();
  });

  it('knows a folder by the identity kept next to its handle, so it survives a reload', async () => {
    const disk = folder('Notes', { 'Welcome.md': 'welcome' });
    const before = await folderVault(disk, 'folder-42');
    writeDraft({ vault: vaultDraftId(before.adapter), path: 'Welcome.md', content: 'welcome back', seen: [hashText('welcome')] });
    const after = await folderVault(disk, 'folder-42');
    expect(vaultDraftId(after.adapter)).toBe('fsa:folder-42');
    expect(await replayDraft(after)).toBe(true);
    expect(after.getFile('Welcome.md')?.content).toBe('welcome back');
  });

  it('survives a broken or unavailable localStorage', () => {
    localStorage.setItem('noto:draft', '{not json');
    expect(readDraft()).toBeNull();
    localStorage.setItem('noto:draft', JSON.stringify({ vault: 'v', path: 'A.md', content: 'x' }));
    expect(readDraft()).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeDraft({ vault: 'v', path: 'A.md', content: 'x', seen: [] })).not.toThrow();
    setItem.mockRestore();
  });
});
