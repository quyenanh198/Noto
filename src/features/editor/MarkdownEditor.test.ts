import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { findHeadingLine, renamedNotePath } from './MarkdownEditor';

describe('renamedNotePath', () => {
  it('keeps the file in its folder and keeps its extension', () => {
    expect(renamedNotePath('Welcome.md', 'Hello')).toBe('Hello.md');
    expect(renamedNotePath('Projects/Plan.md', 'Roadmap')).toBe('Projects/Roadmap.md');
    expect(renamedNotePath('notes.txt', 'renamed-notes')).toBe('renamed-notes.txt');
    expect(renamedNotePath('board.canvas', 'sketch')).toBe('sketch.canvas');
    expect(renamedNotePath('README', 'Readme')).toBe('Readme.md');
  });
});

describe('findHeadingLine', () => {
  it('matches headings by their link text when the note is not indexed', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '# Title\n\n## A | B\n\n## E]F\n' }) });
    expect(findHeadingLine(view, 'unindexed.md', 'A | B')).toBe(2);
    expect(findHeadingLine(view, 'unindexed.md', 'A B')).toBe(2);
    expect(findHeadingLine(view, 'unindexed.md', 'e f')).toBe(4);
    expect(findHeadingLine(view, 'unindexed.md', 'missing')).toBeUndefined();
    view.destroy();
  });
});
