import { describe, expect, it, vi } from 'vitest';
import type { VaultEvent } from '../types';
import { IndexedDBAdapter, MemoryAdapter } from './storage';
import { Vault } from './Vault';
import { ancestors, basename, dirname, extname, folderMatchesHint, isWithin, joinPath, normalizePath, noteKey, noteTitle, validateName, withMdExt } from './path';

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
  it('strips only the markdown extension from link targets and file names', () => {
    expect(noteKey('Note.md')).toBe('Note');
    expect(noteKey('x/Note.MD')).toBe('x/Note');
    expect(noteKey('Release 1.2')).toBe('Release 1.2');
    expect(noteKey('Release 1.2.md')).toBe('Release 1.2');
    expect(noteKey('Node.js')).toBe('Node.js');
    expect(noteKey('notes.txt')).toBe('notes.txt');
  });
  it('matches folder hints on segment boundaries only', () => {
    expect(folderMatchesHint('a/b', '')).toBe(true);
    expect(folderMatchesHint('b', 'b')).toBe(true);
    expect(folderMatchesHint('a/b', 'b')).toBe(true);
    expect(folderMatchesHint('a/b', 'a/b')).toBe(true);
    expect(folderMatchesHint('ab', 'b')).toBe(false);
    expect(folderMatchesHint('old ideas', 'ideas')).toBe(false);
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

  it('treats names that differ only in case as the same entry when creating', async () => {
    const { vault, adapter } = await makeVault({ 'Note.md': '# Important', 'untitled.md': 'draft', 'Docs/a.md': 'a' });
    await expect(vault.create('note.md', '')).rejects.toThrow(/File already exists: Note\.md/);
    await expect(vault.create('docs/A.md', '')).rejects.toThrow(/File already exists: Docs\/a\.md/);
    await expect(vault.createFolder('docs')).rejects.toThrow(/Folder already exists: Docs/);
    expect(vault.getFile('Note.md')?.content).toBe('# Important');
    expect(adapter.files.get('Note.md')?.content).toBe('# Important');
    // A counter is appended, as for an exact-case clash.
    expect((await vault.createUnique('note')).path).toBe('note 1.md');
    expect((await vault.createUnique('Untitled.md')).path).toBe('Untitled 1.md');
    expect((await vault.createUnique('UNTITLED')).path).toBe('UNTITLED 2.md');
    // New entries inside a folder spelled differently land in the existing folder: on disk they would anyway.
    expect((await vault.createUnique('docs/Lowercase')).path).toBe('Docs/Lowercase.md');
    await vault.createFolder('docs/sub');
    expect((await vault.create('DOCS/Sub/x.md', 'x')).path).toBe('Docs/sub/x.md');
    expect(vault.getFolders()).toEqual(['Docs', 'Docs/sub']);
    expect(vault.findFile('NOTE.MD')?.path).toBe('Note.md');
    expect(vault.findFile('docs/lowercase.md')?.path).toBe('Docs/Lowercase.md');
    expect(vault.findFile('nope.md')).toBeUndefined();
  });

  it('refuses to move a folder into a case variant of itself', async () => {
    // Both spellings can only coexist when loaded from a case-sensitive disk; on disk they are one folder elsewhere.
    const { vault, adapter } = await makeVault({ 'Docs/a.md': 'a' }, ['docs']);
    await expect(vault.renameFolder('Docs', 'docs/Docs')).rejects.toThrow(/into itself/);
    await expect(vault.renameFolder('docs', 'Docs/Sub/docs')).rejects.toThrow(/into itself/);
    // A folder that exists with exactly that spelling is used as written.
    await vault.rename('Docs/a.md', 'docs/b.md');
    expect(vault.getFiles().map((f) => f.path)).toEqual(['docs/b.md']);
    expect([...adapter.files.keys()]).toEqual(['docs/b.md']);
  });

  it('keeps folders that were only implied by files once their last file is gone', async () => {
    const { vault, adapter } = await makeVault();
    await vault.create('Areas/Health/Running log.md', 'run');
    await vault.delete('Areas/Health/Running log.md');
    expect(vault.getFolders()).toEqual(['Areas', 'Areas/Health']);
    expect([...adapter.folders].sort()).toEqual(['Areas', 'Areas/Health']);
    await vault.create('tmp.md', '');
    await vault.rename('tmp.md', 'Moved/Deeper/tmp.md');
    await vault.renameFolder('Moved', 'Archive/Old');
    await vault.delete('Archive/Old/Deeper/tmp.md');
    expect(vault.getFolders()).toEqual(['Archive', 'Archive/Old', 'Archive/Old/Deeper', 'Areas', 'Areas/Health']);
    expect([...adapter.folders].sort()).toEqual(['Archive', 'Archive/Old', 'Archive/Old/Deeper', 'Areas', 'Areas/Health']);
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

  it('resolves links to notes whose names contain dots', async () => {
    const { vault } = await makeVault({ 'Node.js.md': '', 'Mr. Smith.md': '', 'docs/Release 1.2.md': '', 'A.md': '' });
    expect(vault.resolveLink('node.js')).toBe('Node.js.md');
    expect(vault.resolveLink('mr. smith')).toBe('Mr. Smith.md');
    expect(vault.resolveLink('Node.js.md')).toBe('Node.js.md');
    expect(vault.resolveLink('Release 1.2', 'A.md')).toBe('docs/Release 1.2.md');
    expect(vault.resolveLink('release 1.2.md')).toBe('docs/Release 1.2.md');
    expect(vault.resolveLink('Release 1')).toBeUndefined();
  });

  it('matches a folder hint only on whole segments', async () => {
    const { vault } = await makeVault({ 'Old Ideas/Inbox.md': '', 'deep/ax/Other.md': '', 'a/b/c.md': '' });
    expect(vault.resolveLink('Ideas/Inbox')).toBeUndefined();
    expect(vault.resolveLink('Ideas/Inbox', 'Some/Note.md')).toBeUndefined();
    expect(vault.resolveLink('x/Other')).toBeUndefined();
    expect(vault.resolveLink('b/c')).toBe('a/b/c.md');
    expect(vault.resolveLink('a/b/c')).toBe('a/b/c.md');
  });

  it('resolves links to attachments by their full name', async () => {
    const { vault } = await makeVault({ 'A.md': '', 'Archive/notes.txt': 'plain', 'Archive/board.canvas': '{}', 'Archive/notes.md': '', 'Deep.markdown': '' });
    expect(vault.resolveLink('notes.txt', 'A.md')).toBe('Archive/notes.txt');
    expect(vault.resolveLink('Board.Canvas')).toBe('Archive/board.canvas');
    expect(vault.resolveLink('notes')).toBe('Archive/notes.md');
    expect(vault.resolveLink('notes.md')).toBe('Archive/notes.md');
    expect(vault.resolveLink('Deep.markdown')).toBe('Deep.markdown');
    expect(vault.resolveLink('Deep')).toBeUndefined();
  });

  it('computes shortest link text', async () => {
    const { vault } = await makeVault({ 'A.md': '', 'x/B.md': '', 'y/B.md': '' });
    expect(vault.linkTextFor('A.md')).toBe('A');
    expect(vault.linkTextFor('x/B.md')).toBe('x/B');
  });

  it('computes link text the way links are matched: ignoring case, implying only .md', async () => {
    const { vault } = await makeVault({ 'Note.md': '', 'x/note.md': '', 'a/Local.md': '', 'b/Local.md': '', 'docs/Only.md': '', 'notes.txt': '', 'Archive/pic.canvas': '', 'Node.js.md': '' });
    // Resolution is case-insensitive, so a title that differs only in case is not unique.
    expect(vault.linkTextFor('x/note.md')).toBe('x/note');
    expect(vault.linkTextFor('Note.md')).toBe('Note');
    // A name used elsewhere gets the path form even from a sibling note, so the link keeps its meaning if the note moves.
    expect(vault.linkTextFor('b/Local.md', 'b/Other.md')).toBe('b/Local');
    expect(vault.linkTextFor('a/Local.md')).toBe('a/Local');
    expect(vault.linkTextFor('docs/Only.md', 'a/Local.md')).toBe('Only');
    // Attachments keep their extension; only `.md` is implied.
    expect(vault.linkTextFor('notes.txt')).toBe('notes.txt');
    expect(vault.linkTextFor('Archive/pic.canvas')).toBe('pic.canvas');
    expect(vault.linkTextFor('Node.js.md')).toBe('Node.js');
  });

  it('switches adapters', async () => {
    const { vault } = await makeVault({ 'a.md': '' });
    await vault.switchAdapter(new MemoryAdapter({ files: [{ path: 'b.md', content: '', mtime: 1 }], folders: [] }));
    expect(vault.getFiles().map((f) => f.path)).toEqual(['b.md']);
  });

  it('keeps the current adapter and files when the new adapter fails to load', async () => {
    const { vault, adapter } = await makeVault({ 'a.md': 'A' });
    const broken = new MemoryAdapter();
    broken.load = () => Promise.reject(new Error('unreadable'));
    const writes = vi.spyOn(broken, 'writeFile');
    await expect(vault.switchAdapter(broken)).rejects.toThrow('unreadable');
    expect(vault.adapter).toBe(adapter);
    expect(vault.getFiles().map((f) => f.path)).toEqual(['a.md']);
    await vault.modify('a.md', 'edited');
    expect(writes).not.toHaveBeenCalled();
    expect(adapter.files.get('a.md')?.content).toBe('edited');
  });

  it('sends writes made while a switch is still loading to the old adapter', async () => {
    const { vault, adapter } = await makeVault({ 'a.md': 'A' });
    const next = new MemoryAdapter({ files: [{ path: 'a.md', content: 'disk', mtime: 1 }], folders: [] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const load = next.load.bind(next);
    next.load = async () => {
      await gate;
      return load();
    };
    const switching = vault.switchAdapter(next);
    await vault.modify('a.md', 'typed while loading');
    expect(adapter.files.get('a.md')?.content).toBe('typed while loading');
    expect(next.files.get('a.md')?.content).toBe('disk');
    release();
    await switching;
    expect(vault.adapter).toBe(next);
    expect(vault.getFile('a.md')?.content).toBe('disk');
  });

  it('createUnique rejects an empty path instead of creating ".md"', async () => {
    const { vault } = await makeVault();
    await expect(vault.createUnique('/')).rejects.toThrow(/empty/);
    await expect(vault.createUnique('..')).rejects.toThrow(/empty/);
    expect(vault.getFiles()).toEqual([]);
  });
});

describe('Vault link updates on rename', () => {
  it('rewrites links in other notes when a note is renamed', async () => {
    const { vault, adapter } = await makeVault({
      'Welcome.md': 'See [[Linking notes]], [[Linking notes|alias]], [[linking notes#Tags]], ![[Linking notes]], `[[Linking notes]]` and [[Other]].',
      'Linking notes.md': 'Self [[Linking notes]] and [[#Backlinks]]',
      'Other.md': 'No links',
    });
    const events: VaultEvent[] = [];
    vault.on((e) => events.push(e));
    await vault.rename('Linking notes.md', 'Linked notes.md');
    expect(events.map((e) => e.type)).toEqual(['rename', 'modify', 'modify']);
    expect(vault.getFile('Welcome.md')?.content).toBe(
      'See [[Linked notes]], [[Linked notes|alias]], [[Linked notes#Tags]], ![[Linked notes]], `[[Linking notes]]` and [[Other]].',
    );
    expect(vault.getFile('Linked notes.md')?.content).toBe('Self [[Linked notes]] and [[#Backlinks]]');
    expect(vault.getFile('Other.md')?.content).toBe('No links');
    expect(adapter.files.get('Welcome.md')?.content).toContain('[[Linked notes]]');
    expect(adapter.files.get('Linked notes.md')?.content).toBe('Self [[Linked notes]] and [[#Backlinks]]');
  });

  it('uses the shortest unique link text after a move', async () => {
    const { vault } = await makeVault({ 'A.md': 'Link [[Note]] and [[x/Note]]', 'Note.md': '', 'x/Note.md': '' });
    await vault.rename('Note.md', 'y/Note.md');
    expect(vault.getFile('A.md')?.content).toBe('Link [[y/Note]] and [[x/Note]]');
    await vault.rename('x/Note.md', 'x/Renamed.md');
    expect(vault.getFile('A.md')?.content).toBe('Link [[y/Note]] and [[Renamed]]');
  });

  it('rewrites links into a renamed folder and leaves links that still resolve alone', async () => {
    const { vault } = await makeVault({
      'Welcome.md': 'See [[Projects/Noto roadmap]] and [[Noto roadmap|road]]',
      'Projects/Noto roadmap.md': 'Sibling [[Ideas]] and [[Projects/Ideas]]',
      'Projects/Ideas.md': '',
    });
    const events: VaultEvent[] = [];
    vault.on((e) => events.push(e));
    await vault.renameFolder('Projects', 'Work');
    expect(events.map((e) => e.type)).toEqual(['folder-rename', 'modify', 'modify']);
    expect(vault.getFile('Welcome.md')?.content).toBe('See [[Noto roadmap]] and [[Noto roadmap|road]]');
    // Path-form links are shortened too, since the basename is unique.
    expect(vault.getFile('Work/Noto roadmap.md')?.content).toBe('Sibling [[Ideas]] and [[Ideas]]');
    expect(vault.getFile('Work/Ideas.md')?.content).toBe('');
  });

  it('rewrites links to notes whose names contain dots', async () => {
    const { vault } = await makeVault({
      'A.md': 'See [[Release 1.2]], [[Release 1.2|alias]], [[docs/Node.js]] and [[docs/Plain]]',
      'Release 1.2.md': '',
      'docs/Node.js.md': '',
      'docs/Plain.md': '',
    });
    await vault.rename('Release 1.2.md', 'Release 1.3.md');
    expect(vault.getFile('A.md')?.content).toBe('See [[Release 1.3]], [[Release 1.3|alias]], [[docs/Node.js]] and [[docs/Plain]]');
    await vault.renameFolder('docs', 'archive');
    expect(vault.getFile('A.md')?.content).toBe('See [[Release 1.3]], [[Release 1.3|alias]], [[Node.js]] and [[Plain]]');
    expect(vault.resolveLink('Node.js', 'A.md')).toBe('archive/Node.js.md');
  });

  it('keeps rewritten links on the moved note when another title differs only in case', async () => {
    // `[[note]]` would resolve to the root `Note.md` (resolution is case-insensitive), so the path form is needed.
    const renamed = await makeVault({ 'A.md': 'See [[Old]]', 'Old.md': 'old', 'Note.md': 'other' });
    await renamed.vault.rename('Old.md', 'x/note.md');
    expect(renamed.vault.getFile('A.md')?.content).toBe('See [[x/note]]');
    expect(renamed.vault.resolveLink('x/note', 'A.md')).toBe('x/note.md');
    // The same for a plain move and for a folder rename.
    const moved = await makeVault({ 'A.md': 'See [[y/note]]', 'y/note.md': 'y', 'Note.md': 'other' });
    await moved.vault.rename('y/note.md', 'z/note.md');
    expect(moved.vault.getFile('A.md')?.content).toBe('See [[z/note]]');
    await moved.vault.renameFolder('z', 'w');
    expect(moved.vault.getFile('A.md')?.content).toBe('See [[w/note]]');
    expect(moved.vault.resolveLink('w/note', 'A.md')).toBe('w/note.md');
  });

  it('keeps the extension when rewriting links to attachments', async () => {
    const { vault, adapter } = await makeVault({
      'A.md': 'See [[notes.txt]], ![[board.canvas]], [[Docs/data.json]] and [[Deep.markdown]]',
      'notes.txt': 'plain',
      'board.canvas': '{}',
      'Docs/data.json': '{}',
      'Deep.markdown': 'deep',
    });
    await vault.rename('notes.txt', 'notes2.txt');
    await vault.rename('board.canvas', 'Archive/board.canvas');
    await vault.renameFolder('Docs', 'Archive/Docs');
    await vault.rename('Deep.markdown', 'Deeper.markdown');
    const expected = 'See [[notes2.txt]], ![[board.canvas]], [[data.json]] and [[Deeper.markdown]]';
    expect(vault.getFile('A.md')?.content).toBe(expected);
    expect(adapter.files.get('A.md')?.content).toBe(expected);
    expect(vault.resolveLink('notes2.txt', 'A.md')).toBe('notes2.txt');
    expect(vault.resolveLink('board.canvas', 'A.md')).toBe('Archive/board.canvas');
    expect(vault.resolveLink('data.json', 'A.md')).toBe('Archive/Docs/data.json');
    expect(vault.resolveLink('Deeper.markdown', 'A.md')).toBe('Deeper.markdown');
  });

  it('keeps the escaped alias separator of links written inside tables', async () => {
    const { vault, adapter } = await makeVault({ 'A.md': '| a | b |\n|---|---|\n| [[Old\\|alias]] | ![[Old\\|pic]] |', 'Old.md': '' });
    await vault.rename('Old.md', 'New.md');
    expect(vault.getFile('A.md')?.content).toBe('| a | b |\n|---|---|\n| [[New\\|alias]] | ![[New\\|pic]] |');
    expect(adapter.files.get('A.md')?.content).toBe('| a | b |\n|---|---|\n| [[New\\|alias]] | ![[New\\|pic]] |');
  });

  it("rewrites a moved note's own relative links so they keep pointing at the same notes", async () => {
    const { vault, adapter } = await makeVault({
      'a/Note.md': 'See [[Local]], [[Local#H|alias]], [[Global]], [[b/Local]] and [[Missing]]',
      'a/Local.md': 'A local',
      'b/Local.md': 'B local',
      'Global.md': '',
    });
    await vault.rename('a/Note.md', 'b/Note.md');
    // Only links whose meaning would change are touched; `[[b/Local]]` still names the same note.
    const expected = 'See [[a/Local]], [[a/Local#H|alias]], [[Global]], [[b/Local]] and [[Missing]]';
    expect(vault.getFile('b/Note.md')?.content).toBe(expected);
    expect(adapter.files.get('b/Note.md')?.content).toBe(expected);
    expect(vault.resolveLink('a/Local', 'b/Note.md')).toBe('a/Local.md');
    // The same when the note moves with its folder; the sibling moved too, so its link is updated like any other.
    await vault.renameFolder('b', 'c');
    expect(vault.getFile('c/Note.md')?.content).toBe('See [[a/Local]], [[a/Local#H|alias]], [[Global]], [[c/Local]] and [[Missing]]');
    expect(vault.resolveLink('c/Local', 'c/Note.md')).toBe('c/Local.md');
  });

  it('leaves links alone when a move does not change what they resolve to', async () => {
    const { vault } = await makeVault({ 'a/Note.md': 'See [[Only]] and [[a/Sibling]]', 'a/Only.md': '', 'a/Sibling.md': '' });
    const events: VaultEvent[] = [];
    vault.on((e) => events.push(e));
    await vault.rename('a/Note.md', 'b/Note.md');
    expect(events.map((e) => e.type)).toEqual(['rename']);
    expect(vault.getFile('b/Note.md')?.content).toBe('See [[Only]] and [[a/Sibling]]');
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
