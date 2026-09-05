import { describe, expect, it } from 'vitest';
import { importPath, importSummary, planImport, serializeVault } from './vaultTransfer';

describe('vaultTransfer', () => {
  it('derives vault paths from picked files and folder entries', () => {
    expect(importPath({ name: 'Note.md' })).toBe('Note.md');
    expect(importPath({ name: 'Note.md', webkitRelativePath: '' })).toBe('Note.md');
    expect(importPath({ name: 'Note.md', webkitRelativePath: 'MyVault/Note.md' })).toBe('Note.md');
    expect(importPath({ name: 'Deep.md', webkitRelativePath: 'MyVault/Projects/Sub/Deep.md' })).toBe('Projects/Sub/Deep.md');
    expect(importPath({ name: 'x.md', webkitRelativePath: 'Top\\Win\\x.md' })).toBe('Win/x.md');
  });

  it('plans imports skipping existing paths, duplicates and non-text files', () => {
    const files = [
      { name: 'New.md' },
      { name: 'Existing.md' },
      { name: 'New.md' },
      { name: 'photo.png' },
      { name: 'plain.txt', webkitRelativePath: 'Folder/plain.txt' },
      { name: 'hidden.md', webkitRelativePath: 'Folder/.obsidian/hidden.md' },
    ];
    const plan = planImport(files, (path) => path === 'Existing.md');
    expect(plan.create.map((c) => c.path)).toEqual(['New.md', 'plain.txt', '.obsidian/hidden.md']);
    expect(plan.create[0].file).toBe(files[0]);
    expect(plan.skipped).toBe(3);
  });

  it('formats the summary', () => {
    expect(importSummary(1, 0)).toBe('Imported 1 file, skipped 0');
    expect(importSummary(3, 2)).toBe('Imported 3 files, skipped 2');
  });

  it('serialises the vault as { files, folders }', () => {
    const json = serializeVault({ files: [{ path: 'a.md', content: '# A', mtime: 5 }], folders: ['Daily'] });
    expect(JSON.parse(json)).toEqual({ files: [{ path: 'a.md', content: '# A', mtime: 5 }], folders: ['Daily'] });
  });
});
