import { describe, expect, it } from 'vitest';
import { FileSystemAccessAdapter, isTextFile, shouldSkipEntry, type DirectoryHandle, type FileHandle, type FileLike, type WritableLike } from './fsa';
import { Vault } from './Vault';

// ----- in-memory fake of the File System Access handles -----

class FakeFile implements FileHandle {
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
        this.lastModified = 2000;
      },
    };
  }
}

class FakeDir implements DirectoryHandle {
  readonly kind = 'directory' as const;
  entries = new Map<string, FakeDir | FakeFile>();
  permission: PermissionState = 'granted';
  constructor(public readonly name: string) {}

  async *values(): AsyncGenerator<FakeDir | FakeFile> {
    for (const entry of this.entries.values()) yield entry;
  }
  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FakeDir> {
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new DOMException(`${name} is a file`, 'TypeMismatchError');
      return existing;
    }
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const dir = new FakeDir(name);
    this.entries.set(name, dir);
    return dir;
  }
  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FakeFile> {
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
      return existing;
    }
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const file = new FakeFile(name, '');
    this.entries.set(name, file);
    return file;
  }
  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    const existing = this.entries.get(name);
    if (!existing) throw new DOMException(`${name} not found`, 'NotFoundError');
    if (existing.kind === 'directory' && existing.entries.size > 0 && !options?.recursive) {
      throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
    }
    this.entries.delete(name);
  }
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }
  async requestPermission(): Promise<PermissionState> {
    return this.permission;
  }
}

type Tree = { [name: string]: string | Tree };

function build(tree: Tree, name = 'Vault'): FakeDir {
  const dir = new FakeDir(name);
  for (const [entry, value] of Object.entries(tree)) {
    dir.entries.set(entry, typeof value === 'string' ? new FakeFile(entry, value) : build(value, entry));
  }
  return dir;
}

/** Flatten a fake directory into `path -> content` for assertions. */
function dump(dir: FakeDir, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, entry] of dir.entries) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'file') out[path] = entry.content;
    else {
      out[`${path}/`] = '';
      Object.assign(out, dump(entry, path));
    }
  }
  return out;
}

const SAMPLE: Tree = {
  'Welcome.md': '# Welcome',
  'notes.txt': 'plain',
  'board.canvas': '{}',
  'data.json': '{"a":1}',
  'image.png': 'PNG',
  '.obsidian': { 'app.json': '{}' },
  '.hidden.md': 'secret',
  node_modules: { 'pkg.md': 'nope' },
  Projects: { 'Roadmap.md': 'roadmap', Nested: { 'Deep.markdown': 'deep' } },
  Empty: {},
};

describe('fsa helpers', () => {
  it('recognises text files and skipped entries', () => {
    expect(isTextFile('a.md')).toBe(true);
    expect(isTextFile('A.MD')).toBe(true);
    expect(isTextFile('a.markdown')).toBe(true);
    expect(isTextFile('a.txt')).toBe(true);
    expect(isTextFile('a.canvas')).toBe(true);
    expect(isTextFile('a.json')).toBe(true);
    expect(isTextFile('a.png')).toBe(false);
    expect(isTextFile('README')).toBe(false);
    expect(shouldSkipEntry('.git')).toBe(true);
    expect(shouldSkipEntry('.obsidian')).toBe(true);
    expect(shouldSkipEntry('node_modules')).toBe(true);
    expect(shouldSkipEntry('Notes')).toBe(false);
  });
});

describe('FileSystemAccessAdapter', () => {
  it('loads text files recursively, skipping dot entries, node_modules and binaries', async () => {
    const root = build(SAMPLE);
    const adapter = new FileSystemAccessAdapter(root);
    expect(adapter.kind).toBe('fsa');
    expect(adapter.name).toBe('Vault');
    const snap = await adapter.load();
    const paths = snap.files.map((f) => f.path).sort();
    expect(paths).toEqual(['Projects/Nested/Deep.markdown', 'Projects/Roadmap.md', 'Welcome.md', 'board.canvas', 'data.json', 'notes.txt']);
    expect(snap.files.find((f) => f.path === 'Projects/Nested/Deep.markdown')).toEqual({ path: 'Projects/Nested/Deep.markdown', content: 'deep', mtime: 1000 });
    expect(snap.folders.sort()).toEqual(['Empty', 'Projects', 'Projects/Nested']);
  });

  it('writes files, creating missing parent folders', async () => {
    const root = build({});
    const adapter = new FileSystemAccessAdapter(root);
    await adapter.load();
    await adapter.writeFile('A/B/note.md', 'hello');
    expect(dump(root)).toEqual({ 'A/': '', 'A/B/': '', 'A/B/note.md': 'hello' });
    await adapter.writeFile('A/B/note.md', 'replaced');
    expect(dump(root)['A/B/note.md']).toBe('replaced');
    await adapter.writeFile('top.md', 'root level');
    expect(dump(root)['top.md']).toBe('root level');
  });

  it('deletes files and reports missing ones', async () => {
    const root = build({ 'a.md': 'a', Sub: { 'b.md': 'b' } });
    const adapter = new FileSystemAccessAdapter(root);
    await adapter.load();
    await adapter.deleteFile('Sub/b.md');
    expect(dump(root)).toEqual({ 'a.md': 'a', 'Sub/': '' });
    await expect(adapter.deleteFile('Sub/missing.md')).rejects.toThrow(/Cannot delete Sub\/missing\.md/);
    await expect(adapter.deleteFile('Nope/x.md')).rejects.toThrow(/Folder not found: Nope/);
  });

  it('renames files by copying then removing, across folders', async () => {
    const root = build({ 'a.md': 'content A' });
    const adapter = new FileSystemAccessAdapter(root);
    await adapter.load();
    await adapter.renameFile('a.md', 'Moved/renamed.md');
    expect(dump(root)).toEqual({ 'Moved/': '', 'Moved/renamed.md': 'content A' });
    await expect(adapter.renameFile('ghost.md', 'x.md')).rejects.toThrow(/Cannot read ghost\.md/);
  });

  it('creates and deletes folders, forgetting cached handles', async () => {
    const root = build({ A: { 'x.md': 'x', Inner: { 'y.md': 'y' } } });
    const adapter = new FileSystemAccessAdapter(root);
    await adapter.load();
    await adapter.createFolder('New/Deeper');
    expect(dump(root)['New/Deeper/']).toBe('');
    expect((await adapter.load()).folders.sort()).toEqual(['A', 'A/Inner', 'New', 'New/Deeper']);

    await adapter.deleteFolder('A');
    expect(Object.keys(dump(root)).some((p) => p.startsWith('A'))).toBe(false);
    // A fresh folder with the same name must not reuse the stale handle.
    await adapter.writeFile('A/again.md', 'again');
    const a = root.entries.get('A');
    expect(a?.kind).toBe('directory');
    expect(dump(root)['A/again.md']).toBe('again');
    await expect(adapter.deleteFolder('')).rejects.toThrow(/vault root/);
  });

  it('renames folders by copying the whole tree, including binaries and dotfiles', async () => {
    const root = build({ A: { 'x.md': 'x', 'pic.png': 'binary', '.keep': '', Inner: { 'y.md': 'y' } }, 'other.md': 'o' });
    const adapter = new FileSystemAccessAdapter(root);
    await adapter.load();
    await adapter.renameFolder('A', 'Archive/B');
    expect(dump(root)).toEqual({
      'other.md': 'o',
      'Archive/': '',
      'Archive/B/': '',
      'Archive/B/x.md': 'x',
      'Archive/B/pic.png': 'binary',
      'Archive/B/.keep': '',
      'Archive/B/Inner/': '',
      'Archive/B/Inner/y.md': 'y',
    });
    await adapter.writeFile('Archive/B/Inner/z.md', 'z');
    expect(dump(root)['Archive/B/Inner/z.md']).toBe('z');
    await expect(adapter.renameFolder('Missing', 'X')).rejects.toThrow(/Folder not found: Missing/);
  });

  it('works as the backend of a Vault', async () => {
    const root = build({ 'Welcome.md': '# Hi', Notes: {} });
    const vault = new Vault(new FileSystemAccessAdapter(root));
    await vault.load();
    expect(vault.getFiles().map((f) => f.path)).toEqual(['Welcome.md']);
    expect(vault.folderExists('Notes')).toBe(true);
    await vault.create('Notes/Idea.md', 'idea');
    await vault.rename('Notes/Idea.md', 'Notes/Plan.md');
    await vault.modify('Notes/Plan.md', 'plan v2');
    await vault.renameFolder('Notes', 'Thoughts');
    expect(dump(root)).toEqual({ 'Welcome.md': '# Hi', 'Thoughts/': '', 'Thoughts/Plan.md': 'plan v2' });
    await vault.deleteFolder('Thoughts');
    expect(dump(root)).toEqual({ 'Welcome.md': '# Hi' });
  });
});
