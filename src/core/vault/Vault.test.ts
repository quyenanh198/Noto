import { describe, expect, it } from 'vitest';
import type { VaultEvent } from '../types';
import { IndexedDBAdapter, MemoryAdapter } from './storage';
import { Vault } from './Vault';
import { ancestors, basename, dirname, extname, isWithin, joinPath, normalizePath, noteTitle, validateName, withMdExt } from './path';

async function makeVault(files: Record<string, string> = {}, folders: string[] = []) {
  const adapter = new MemoryAdapter({
    files: Object.entries(files).map(([path, content]) => ({ path, content, mtime: 1 })),
    folders,
  });
  const vault = new Vault(adapter);
  await vault.load();
  return { vault, adapter };
}

describe('path helpers', () => {
  it('normalizes', () => {
    expect(normalizePath('/a//b/./c.md')).toBe('a/b/c.md');
    expect(normalizePath('a/../b.md')).toBe('b.md');
    expect(normalizePath('a\\b')).toBe('a/b');
    // Names on disk may legitimately start or end with spaces; only user-typed names are trimmed (by the UI).
    expect(normalizePath(' Archive/ draft.md')).toBe(' Archive/ draft.md');
  });
  it('splits', () => {
    expect(dirname('a/b/c.md')).toBe('a/b');
    expect(dirname('c.md')).toBe('');
    expect(basename('a/b/c.md')).toBe('c.md');
    expect(extname('a/b.c/d')).toBe('');
    expect(extname('.hidden')).toBe('');
    expect(noteTitle('a/My note.md')).toBe('My note');
    expect(withMdExt('x')).toBe('x.md');
    expect(withMdExt('x.MD')).toBe('x.MD');
    expect(joinPath('', 'a', 'b.md')).toBe('a/b.md');
    expect(ancestors('a/b/c.md')).toEqual(['a', 'a/b']);
    expect(isWithin('a/b', 'a')).toBe(true);
    expect(isWithin('ab', 'a')).toBe(false);
  });
  it('validates names', () => {
    expect(validateName('ok name')).toBeNull();
    expect(validateName('')).not.toBeNull();
    expect(validateName('a/b')).not.toBeNull();
    expect(validateName('a[b]')).not.toBeNull();
  });
});

describe('Vault', () => {
  it('loads files and folders', async () => {
    const { vault } = await makeVault({ 'a.md': 'A', 'dir/b.md': 'B' }, ['empty']);
    expect(vault.getFiles().map((f) => f.path)).toEqual(['a.md', 'dir/b.md']);
    expect(vault.getFolders()).toEqual(['dir', 'empty']);
    expect(vault.folderExists('dir')).toBe(true);
    expect(vault.folderExists('nope')).toBe(false);
    expect(vault.listChildren('')).toMatchObject({ folders: ['dir', 'empty'] });
    expect(vault.listChildren('').files.map((f) => f.path)).toEqual(['a.md']);
  });

  it('creates, modifies, renames, deletes and emits events', async () => {
    const { vault, adapter } = await makeVault();
    const events: VaultEvent[] = [];
    vault.on((e) => events.push(e));
    await vault.create('x/y.md', 'hi');
    await vault.modify('x/y.md', 'hello');
    await vault.modify('x/y.md', 'hello'); // no-op
    await vault.rename('x/y.md', 'z.md');
    await vault.delete('z.md');
    expect(events.map((e) => e.type)).toEqual(['create', 'modify', 'rename', 'delete']);
    expect(adapter.files.size).toBe(0);
    expect(vault.revision).toBe(5); // load + 4 mutations
  });

  it('rejects duplicates and missing files', async () => {
    const { vault } = await makeVault({ 'a.md': '' });
    await expect(vault.create('a.md')).rejects.toThrow(/exists/);
    await expect(vault.modify('nope.md', '')).rejects.toThrow(/not found/);
    await expect(vault.rename('nope.md', 'b.md')).rejects.toThrow(/not found/);
    await vault.create('b.md');
    await expect(vault.rename('a.md', 'b.md')).rejects.toThrow(/exists/);
  });

  it('treats names that differ only in case as the same entry when renaming', async () => {
    const { vault } = await makeVault({ 'Note.md': 'n', 'Other.md': 'o', 'Docs/a.md': 'a', 'Misc/b.md': 'b' });
    await expect(vault.rename('Note.md', 'other.md')).rejects.toThrow(/File already exists: Other\.md/);
    await expect(vault.renameFolder('Misc', 'docs')).rejects.toThrow(/Folder already exists: Docs/);
    expect(vault.getFiles().map((f) => f.path).sort()).toEqual(['Docs/a.md', 'Misc/b.md', 'Note.md', 'Other.md']);
    // Changing only the casing of an entry's own name is a legitimate rename.
    await vault.rename('Note.md', 'note.md');
    await vault.renameFolder('Docs', 'DOCS');
    expect(vault.getFiles().map((f) => f.path).sort()).toEqual(['DOCS/a.md', 'Misc/b.md', 'Other.md', 'note.md']);
    expect(vault.getFolders()).toEqual(['DOCS', 'Misc']);
  });

  it('createUnique appends counters', async () => {
    const { vault } = await makeVault({ 'Untitled.md': '' });
    expect((await vault.createUnique('Untitled')).path).toBe('Untitled 1.md');
    expect((await vault.createUnique('Untitled.md')).path).toBe('Untitled 2.md');
  });

  it('folder operations move files and update adapter', async () => {
    const { vault, adapter } = await makeVault({ 'a/one.md': '1', 'a/b/two.md': '2', 'c.md': '3' });
    await vault.createFolder('a/empty');
    await vault.renameFolder('a', 'renamed');
    expect(vault.getFiles().map((f) => f.path)).toEqual(['c.md', 'renamed/b/two.md', 'renamed/one.md']);
    expect(vault.getFolders()).toEqual(['renamed', 'renamed/b', 'renamed/empty']);
    expect([...adapter.files.keys()].sort()).toEqual(['c.md', 'renamed/b/two.md', 'renamed/one.md']);
    await expect(vault.renameFolder('renamed', 'renamed/inner')).rejects.toThrow(/into itself/);
    await vault.deleteFolder('renamed');
    expect(vault.getFiles().map((f) => f.path)).toEqual(['c.md']);
    expect(vault.getFolders()).toEqual([]);
    expect(adapter.folders.size).toBe(0);
  });

  it('resolves links Obsidian-style', async () => {
    const { vault } = await makeVault({ 'Note.md': '', 'deep/Other.md': '', 'deep/x/Other.md': '', 'deep/Local.md': '', 'Deep/Case.md': '' });
    expect(vault.resolveLink('Note')).toBe('Note.md');
    expect(vault.resolveLink('Note.md')).toBe('Note.md');
    expect(vault.resolveLink('note')).toBe('Note.md');
    expect(vault.resolveLink('Other')).toBe('deep/Other.md');
    expect(vault.resolveLink('x/Other')).toBe('deep/x/Other.md');
    expect(vault.resolveLink('Local', 'deep/Other.md')).toBe('deep/Local.md');
    expect(vault.resolveLink('case')).toBe('Deep/Case.md');
    expect(vault.resolveLink('Missing')).toBeUndefined();
    expect(vault.resolveLink('')).toBeUndefined();
  });

  it('computes shortest link text', async () => {
    const { vault } = await makeVault({ 'A.md': '', 'x/B.md': '', 'y/B.md': '' });
    expect(vault.linkTextFor('A.md')).toBe('A');
    expect(vault.linkTextFor('x/B.md')).toBe('x/B');
  });

  it('switches adapters', async () => {
    const { vault } = await makeVault({ 'a.md': '' });
    await vault.switchAdapter(new MemoryAdapter({ files: [{ path: 'b.md', content: '', mtime: 1 }], folders: [] }));
    expect(vault.getFiles().map((f) => f.path)).toEqual(['b.md']);
  });
});

describe('IndexedDBAdapter', () => {
  it('round-trips files and folders across instances', async () => {
    const a = new IndexedDBAdapter('test-' + Math.random());
    await a.writeFile('dir/a.md', 'A');
    await a.writeFile('dir/sub/b.md', 'B');
    await a.createFolder('empty');
    await a.renameFile('dir/a.md', 'dir/a2.md');
    await a.renameFolder('dir', 'moved');
    const b = new IndexedDBAdapter(a.vaultName);
    const snap = await b.load();
    expect(snap.files.map((f) => [f.path, f.content]).sort()).toEqual([
      ['moved/a2.md', 'A'],
      ['moved/sub/b.md', 'B'],
    ]);
    expect(snap.folders.sort()).toEqual(['empty', 'moved']);
    await b.deleteFolder('moved');
    await b.deleteFile('nope.md');
    expect((await b.load()).files).toEqual([]);
    await b.replaceAll({ files: [{ path: 'z.md', content: 'Z', mtime: 1 }], folders: ['q'] });
    expect((await b.load()).files.map((f) => f.path)).toEqual(['z.md']);
  });
});
