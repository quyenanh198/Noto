import { Compartment, EditorState } from '@codemirror/state';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app';
import { MemoryAdapter } from '../../core/vault/storage';
import { useWorkspace } from '../../state/store';
import { rememberEditor, rememberLine, takeEditor, takeLine } from './viewMemory';

const notes = ['Projects/a.md', 'Projects/Sub/deep.md', 'c.md'];

beforeAll(async () => {
  await app.vault.switchAdapter(new MemoryAdapter({ files: notes.map((path) => ({ path, content: `# ${path}`, mtime: 0 })), folders: [] }));
});

beforeEach(() => {
  useWorkspace.setState({ openTabs: [...notes], activeFile: 'c.md', history: [...notes], historyIndex: 2, viewModes: {} });
});

const memory = () => ({ state: EditorState.create({ doc: 'kept' }), dynamic: new Compartment() });

describe('view memory', () => {
  it('hands back what a view kept and forgets it when the tab closes', () => {
    const kept = memory();
    rememberEditor('c.md', kept);
    rememberLine('c.md', 7, 'reading');
    expect(takeEditor('c.md')).toBe(kept);
    expect(takeEditor('c.md')).toBeUndefined();
    expect(takeLine('c.md')).toEqual({ line: 7, from: 'reading' });

    rememberEditor('c.md', kept);
    rememberLine('c.md', 7, 'reading');
    useWorkspace.getState().closeTab('c.md');
    expect(takeEditor('c.md')).toBeUndefined();
    expect(takeLine('c.md')).toBeUndefined();
  });

  it('follows a background note through a rename of the note and of a folder above it', async () => {
    const kept = memory();
    rememberEditor('Projects/a.md', kept);
    rememberLine('Projects/a.md', 12, 'editor');
    await app.vault.rename('Projects/a.md', 'Projects/b.md');
    expect(useWorkspace.getState().openTabs).toEqual(['Projects/b.md', 'Projects/Sub/deep.md', 'c.md']);
    expect(takeLine('Projects/a.md')).toBeUndefined();
    expect(takeLine('Projects/b.md')).toEqual({ line: 12, from: 'editor' });

    rememberLine('Projects/Sub/deep.md', 3, 'reading');
    await app.vault.renameFolder('Projects', 'Work');
    expect(useWorkspace.getState().openTabs).toEqual(['Work/b.md', 'Work/Sub/deep.md', 'c.md']);
    expect(takeEditor('Work/b.md')).toBe(kept);
    expect(takeLine('Work/Sub/deep.md')).toEqual({ line: 3, from: 'reading' });
    expect(takeEditor('Projects/b.md')).toBeUndefined();

    await app.vault.renameFolder('Work', 'Projects');
    await app.vault.rename('Projects/b.md', 'Projects/a.md');
  });
});
