import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch, highlightMatch, isWordStart } from './fuzzy';

const score = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? -Infinity;

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively and rejects non-subsequences', () => {
    expect(fuzzyMatch('nr', 'Noto roadmap')).not.toBeNull();
    expect(fuzzyMatch('NOTO', 'noto roadmap')).not.toBeNull();
    expect(fuzzyMatch('roadn', 'Noto roadmap')).toBeNull();
    expect(fuzzyMatch('xyz', 'Noto roadmap')).toBeNull();
    expect(fuzzyMatch('longer than', 'short')).toBeNull();
  });

  it('returns score 0 and no indices for an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('', '')).toEqual({ score: 0, indices: [] });
  });

  it('reports the indices of the matched characters', () => {
    expect(fuzzyMatch('road', 'Noto roadmap')?.indices).toEqual([5, 6, 7, 8]);
    expect(fuzzyMatch('nr', 'Noto roadmap')?.indices).toEqual([0, 5]);
    expect(fuzzyMatch('ms', 'Markdown syntax')?.indices).toEqual([0, 9]);
    expect(fuzzyMatch('welcome', 'Welcome')?.indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('prefers a consecutive run over scattered characters', () => {
    expect(fuzzyMatch('tax', 'Tag syntax')?.indices).toEqual([7, 8, 9]);
  });

  it('ranks exact > prefix > word start > substring > scattered', () => {
    const exact = score('note', 'note');
    const prefix = score('note', 'notebook');
    const wordStart = score('note', 'my note');
    const substring = score('note', 'annotell');
    const scattered = score('note', 'no time to eat');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(scattered);
  });

  it('rewards camelCase and separator boundaries', () => {
    expect(score('rv', 'ReadingView')).toBeGreaterThan(score('rv', 'readingview'));
    expect(score('tm', 'toggle-mode')).toBeGreaterThan(score('tm', 'togglemode'));
    expect(score('tm', 'toggle_mode')).toBeGreaterThan(score('tm', 'togglemode'));
    expect(score('nr', 'Notes/Roadmap')).toBeGreaterThan(score('nr', 'Notesroadmap'));
  });

  it('prefers matches near the start and penalises gaps', () => {
    expect(score('road', 'roadmap')).toBeGreaterThan(score('road', 'Noto roadmap'));
    expect(score('ab', 'a b')).toBeGreaterThan(score('ab', 'a long way to b'));
  });

  it('prefers the shorter of two texts with the same match', () => {
    expect(score('road', 'Noto roadmap')).toBeGreaterThan(score('road', 'Projects/Noto roadmap.md'));
  });
});

describe('isWordStart', () => {
  it('detects separators and camelCase boundaries', () => {
    expect(isWordStart('abc', 0)).toBe(true);
    expect(isWordStart('abc', 1)).toBe(false);
    expect(isWordStart('a b', 2)).toBe(true);
    expect(isWordStart('a/b', 2)).toBe(true);
    expect(isWordStart('a-b', 2)).toBe(true);
    expect(isWordStart('a_b', 2)).toBe(true);
    expect(isWordStart('aB', 1)).toBe(true);
    expect(isWordStart('AB', 1)).toBe(false);
  });
});

describe('fuzzyFilter', () => {
  const notes = [
    { title: 'Welcome', path: 'Welcome.md' },
    { title: 'Linking notes', path: 'Linking notes.md' },
    { title: 'Noto roadmap', path: 'Projects/Noto roadmap.md' },
    { title: 'Markdown syntax', path: 'Markdown syntax.md' },
  ];

  it('returns everything in the original order with score 0 for a blank query', () => {
    const all = fuzzyFilter('   ', notes, (n) => [n.title, n.path]);
    expect(all.map((r) => r.item.title)).toEqual(notes.map((n) => n.title));
    expect(all.every((r) => r.score === 0 && r.indices.length === 0 && r.field === 0)).toBe(true);
  });

  it('drops non-matching items and sorts by score', () => {
    // "road" is also a scattered subsequence of "Markdown syntax.md" (r,o,a,d) but must rank below the real hit.
    const results = fuzzyFilter('road', notes, (n) => [n.title, n.path]);
    expect(results.map((r) => r.item.title)).toEqual(['Noto roadmap', 'Markdown syntax']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(fuzzyFilter('xyz', notes, (n) => [n.title, n.path])).toEqual([]);
    const byNote = fuzzyFilter('note', notes, (n) => n.title);
    expect(byNote[0].item.title).toBe('Linking notes');
  });

  it('picks the best field and reports it', () => {
    const [byTitle] = fuzzyFilter('roadmap', notes, (n) => [n.title, n.path]);
    expect(byTitle.field).toBe(0);
    expect(byTitle.indices).toEqual([5, 6, 7, 8, 9, 10, 11]);
    const [byPath] = fuzzyFilter('projects', notes, (n) => [n.title, n.path]);
    expect(byPath.item.title).toBe('Noto roadmap');
    expect(byPath.field).toBe(1);
    expect(byPath.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('is stable for equal scores', () => {
    const items = ['alpha one', 'alpha two', 'alpha six'];
    const results = fuzzyFilter('alpha', items, (s) => s);
    expect(results.map((r) => r.item)).toEqual(items);
  });
});

describe('highlightMatch', () => {
  it('merges consecutive matched indices into runs', () => {
    expect(highlightMatch('Noto roadmap', [5, 6, 7, 8])).toEqual([
      { text: 'Noto ', matched: false },
      { text: 'road', matched: true },
      { text: 'map', matched: false },
    ]);
    expect(highlightMatch('abc', [0, 2])).toEqual([
      { text: 'a', matched: true },
      { text: 'b', matched: false },
      { text: 'c', matched: true },
    ]);
  });

  it('handles no matches and empty text', () => {
    expect(highlightMatch('abc', [])).toEqual([{ text: 'abc', matched: false }]);
    expect(highlightMatch('', [])).toEqual([]);
  });
});
