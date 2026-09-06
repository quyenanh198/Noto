import { describe, expect, it } from 'vitest';
import { recentPaths, switcherRows } from './switcherItems';

const src = {
  notePaths: ['Linking notes.md', 'Markdown syntax.md', 'Projects/Noto roadmap.md', 'Welcome.md'],
  unresolvedTargets: ['Ideas inbox'],
  history: ['Welcome.md', 'Projects/Noto roadmap.md', 'Gone.md', 'Welcome.md'],
};

const titles = (query: string) => switcherRows(query, src).map((r) => (r.item.kind === 'create' ? `+${r.item.name}` : r.item.title));

describe('recentPaths', () => {
  it('lists most recent first, de-duplicated and existing only', () => {
    expect(recentPaths(src.history, new Set(src.notePaths))).toEqual(['Welcome.md', 'Projects/Noto roadmap.md']);
    expect(recentPaths([], new Set(src.notePaths))).toEqual([]);
  });
});

describe('switcherRows', () => {
  it('shows recent notes, then the rest alphabetically, then unresolved targets for a blank query', () => {
    expect(titles('')).toEqual(['Welcome', 'Noto roadmap', 'Linking notes', 'Markdown syntax', 'Ideas inbox']);
    const rows = switcherRows('  ', src);
    expect(rows.every((r) => r.indices.length === 0)).toBe(true);
    expect(rows[4].item.kind).toBe('unresolved');
  });

  it('ranks fuzzy matches over title and path and appends a create item', () => {
    const rows = switcherRows('road', src);
    expect(rows[0].item).toEqual({ kind: 'note', path: 'Projects/Noto roadmap.md', title: 'Noto roadmap' });
    expect(rows[0].field).toBe(0);
    expect(rows[0].indices).toEqual([5, 6, 7, 8]);
    const last = rows[rows.length - 1].item;
    expect(last).toEqual({ kind: 'create', name: 'road', path: 'road.md' });
  });

  it('matches on the folder part of the path', () => {
    const rows = switcherRows('projects', src);
    expect(rows[0].item.kind).toBe('note');
    expect(rows[0].field).toBe(1);
  });

  it('does not match the ".md" path of root-level notes', () => {
    // "road" is a scattered subsequence of "Markdown syntax.md" but not of the title.
    expect(titles('road')).toEqual(['Noto roadmap', '+road']);
    // Only the note inside a folder exposes its path (and thus ".md") as a match field.
    expect(titles('.md')).toEqual(['Noto roadmap', '+.md']);
  });

  it('does not offer to create a note whose title already exists (case-insensitive)', () => {
    expect(titles('welcome')).toEqual(['Welcome']);
    expect(titles('WELCOME')).toEqual(['Welcome']);
    expect(titles('ideas inbox')).toEqual(['Ideas inbox']);
    expect(titles('Brand new note')).toEqual(['+Brand new note']);
  });

  it('does not offer to create notes with empty or invalid names', () => {
    for (const q of ['/', '..', '.', 'a:b']) expect(titles(q).some((t) => t.startsWith('+'))).toBe(false);
    expect(titles('Folder/New note')).toContain('+Folder/New note');
  });

  it('includes unresolved targets in fuzzy results', () => {
    const rows = switcherRows('inbox', src);
    expect(rows[0].item).toEqual({ kind: 'unresolved', target: 'Ideas inbox', title: 'Ideas inbox' });
  });
});
