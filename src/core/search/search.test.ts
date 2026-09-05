import { describe, expect, it } from 'vitest';
import { MAX_MATCHES_PER_FILE, MAX_RESULTS, buildSnippet, formatSummary, parseQuery, runSearch, searchNotes, type TagIndex } from './search';

const files = [
  {
    path: 'Welcome.md',
    content: '# Welcome\n\nLinks are great. See [[Linking notes]].\nEscape /[/ literally.\n#getting-started\n',
  },
  {
    path: 'Guides/Linking notes.md',
    content: '# Linking notes\n\nLinks link notes. A link, another LINK.\n\n#reference/links #getting-started\n',
  },
  {
    path: 'Markdown syntax.md',
    content: '---\ntags: [reference, markdown]\n---\n# Markdown syntax\n\nBold and italic.\n',
  },
  {
    path: 'Projects/Roadmap.md',
    content: '# Roadmap\n\n#project/noto\n\n- [ ] Canvas view\n',
  },
];

const paths = (query: string, index: TagIndex | null = null, options?: { matchCase?: boolean }) =>
  searchNotes(files, index, query, options).map((r) => r.path);

const fakeIndex: TagIndex = {
  getFilesWithTag: (tag) => {
    const t = tag.replace(/^#/, '').toLowerCase();
    if (t === 'reference') return ['Guides/Linking notes.md', 'Markdown syntax.md'];
    if (t === 'getting-started') return ['Welcome.md', 'Guides/Linking notes.md'];
    return [];
  },
};

describe('parseQuery', () => {
  it('splits words, phrases, negations, operators and regexes', () => {
    const { terms } = parseQuery('foo "bar baz" -qux -"no way" tag:#t path:Guides file:road /re+g/i -tag:x');
    expect(terms).toEqual([
      { kind: 'text', value: 'foo', flags: '', negate: false },
      { kind: 'text', value: 'bar baz', flags: '', negate: false },
      { kind: 'text', value: 'qux', flags: '', negate: true },
      { kind: 'text', value: 'no way', flags: '', negate: true },
      { kind: 'tag', value: 't', flags: '', negate: false },
      { kind: 'path', value: 'Guides', flags: '', negate: false },
      { kind: 'file', value: 'road', flags: '', negate: false },
      { kind: 'regex', value: 're+g', flags: 'i', negate: false },
      { kind: 'tag', value: 'x', flags: '', negate: true },
    ]);
  });

  it('treats an invalid or unclosed regex as literal text', () => {
    expect(parseQuery('/[/').terms).toEqual([{ kind: 'text', value: '/[/', flags: '', negate: false }]);
    expect(parseQuery('/foo').terms).toEqual([{ kind: 'text', value: '/foo', flags: '', negate: false }]);
    expect(parseQuery('/a/b/c').terms).toEqual([{ kind: 'text', value: '/a/b/c', flags: '', negate: false }]);
  });

  it('handles escaped quotes, empty operators, lone dashes and whitespace', () => {
    expect(parseQuery('  "say \\"hi\\""  ').terms).toEqual([{ kind: 'text', value: 'say "hi"', flags: '', negate: false }]);
    expect(parseQuery('tag: foo').terms).toEqual([{ kind: 'text', value: 'foo', flags: '', negate: false }]);
    expect(parseQuery('- foo').terms).toEqual([
      { kind: 'text', value: '-', flags: '', negate: false },
      { kind: 'text', value: 'foo', flags: '', negate: false },
    ]);
    expect(parseQuery('').terms).toEqual([]);
  });
});

describe('searchNotes', () => {
  it('returns nothing for an empty query', () => {
    expect(searchNotes(files, null, '')).toEqual([]);
    expect(searchNotes(files, null, '   ')).toEqual([]);
  });

  it('ANDs whitespace-separated terms', () => {
    expect(paths('links')).toEqual(['Guides/Linking notes.md', 'Welcome.md']);
    expect(paths('links great')).toEqual(['Welcome.md']);
    expect(paths('links nowhere')).toEqual([]);
  });

  it('matches quoted phrases exactly', () => {
    expect(paths('"link, another"')).toEqual(['Guides/Linking notes.md']);
    expect(paths('"link another"')).toEqual([]);
  });

  it('excludes files matching a negated term or phrase (content or title)', () => {
    expect(paths('links -welcome')).toEqual(['Guides/Linking notes.md']);
    expect(paths('links -"another LINK"')).toEqual(['Welcome.md']);
    expect(paths('-links')).toEqual(['Markdown syntax.md', 'Projects/Roadmap.md']);
  });

  it('resolves tag: terms through the index and highlights the tag occurrences', () => {
    expect(paths('tag:#reference', fakeIndex)).toEqual(['Guides/Linking notes.md', 'Markdown syntax.md']);
    expect(paths('tag:reference', fakeIndex)).toEqual(['Guides/Linking notes.md', 'Markdown syntax.md']);
    expect(paths('tag:nope', fakeIndex)).toEqual([]);
    const [linking, syntax] = searchNotes(files, fakeIndex, 'tag:reference');
    expect(linking.matches).toEqual([{ line: 4, start: 0, end: 16, text: '#reference/links #getting-started' }]);
    expect(syntax.matches).toEqual([{ line: 1, start: 7, end: 16, text: 'tags: [reference, markdown]' }]);
  });

  it('falls back to scanning for the tag text without an index', () => {
    expect(paths('tag:#reference')).toEqual(['Guides/Linking notes.md', 'Markdown syntax.md']);
    expect(paths('tag:project')).toEqual(['Projects/Roadmap.md']);
    expect(paths('tag:getting')).toEqual([]);
    expect(paths('tag:getting-started')).toEqual(['Guides/Linking notes.md', 'Welcome.md']);
    expect(paths('tag:markdown')).toEqual(['Markdown syntax.md']);
  });

  it('filters by path: and file: substrings, case-insensitively', () => {
    expect(paths('path:guides')).toEqual(['Guides/Linking notes.md']);
    expect(paths('path:GUIDES links')).toEqual(['Guides/Linking notes.md']);
    expect(paths('file:road')).toEqual(['Projects/Roadmap.md']);
    expect(paths('file:ROADMAP.md')).toEqual(['Projects/Roadmap.md']);
    expect(paths('-path:guides links')).toEqual(['Welcome.md']);
  });

  it('supports regex terms', () => {
    expect(paths('/l[io]nk/')).toEqual(['Guides/Linking notes.md', 'Welcome.md']);
    expect(paths('/^- \\[ \\]/m')).toEqual(['Projects/Roadmap.md']);
    expect(paths('/^- \\[ \\]/')).toEqual([]);
    const [r] = searchNotes(files, null, '/canvas|roadmap/');
    expect(r.matches.map((m) => m.text.slice(m.start, m.end))).toEqual(['Roadmap', 'Canvas']);
  });

  it('searches an invalid regex literally', () => {
    const results = searchNotes(files, null, '/[/');
    expect(results.map((r) => r.path)).toEqual(['Welcome.md']);
    expect(results[0].matches).toEqual([{ line: 3, start: 7, end: 10, text: 'Escape /[/ literally.' }]);
  });

  it('is case-insensitive unless matchCase is set', () => {
    const loose = searchNotes(files, null, 'link').find((r) => r.path === 'Guides/Linking notes.md');
    expect(loose?.matches).toHaveLength(6);
    const strict = searchNotes(files, null, 'link', { matchCase: true }).find((r) => r.path === 'Guides/Linking notes.md');
    expect(strict?.matches.map((m) => m.text.slice(m.start, m.end))).toEqual(['link', 'link', 'link']);
    expect(paths('LINK', null, { matchCase: true })).toEqual(['Guides/Linking notes.md']);
    expect(paths('/LINK/', null, { matchCase: true })).toEqual(['Guides/Linking notes.md']);
    expect(paths('/LINK/i', null, { matchCase: true })).toEqual(['Guides/Linking notes.md', 'Welcome.md']);
  });

  it('merges overlapping ranges and reports line-relative positions', () => {
    const one = searchNotes([{ path: 'a.md', content: 'links' }], null, 'link links');
    expect(one[0].matches).toEqual([{ line: 0, start: 0, end: 5, text: 'links' }]);
    const multi = searchNotes([{ path: 'b.md', content: 'x\n  y link\r\nlink link' }], null, 'link');
    expect(multi[0].matches).toEqual([
      { line: 1, start: 4, end: 8, text: '  y link' },
      { line: 2, start: 0, end: 4, text: 'link link' },
      { line: 2, start: 5, end: 9, text: 'link link' },
    ]);
  });

  it('scores title matches with weight 10 and sorts by score then path', () => {
    const results = searchNotes(
      [
        { path: 'b/Zebra facts.md', content: 'nothing here' },
        { path: 'a/Zebra.md', content: 'nothing here' },
        { path: 'Other.md', content: 'zebra zebra zebra' },
      ],
      null,
      'zebra',
    );
    expect(results.map((r) => [r.path, r.score, r.matches.length])).toEqual([
      ['a/Zebra.md', 10, 0],
      ['b/Zebra facts.md', 10, 0],
      ['Other.md', 3, 3],
    ]);
    expect(results[0].title).toBe('Zebra');
  });

  it('caps matches per file and results overall, exposing the totals', () => {
    const big = { path: 'big.md', content: Array.from({ length: 60 }, () => 'x').join('\n') };
    const one = runSearch([big], null, 'x');
    expect(one.results[0].matches).toHaveLength(MAX_MATCHES_PER_FILE);
    expect(one.results[0].score).toBe(60);
    expect(one).toMatchObject({ totalFiles: 1, totalResults: 60 });

    const many = Array.from({ length: 250 }, (_, i) => ({ path: `n${i}.md`, content: 'x' }));
    const out = runSearch(many, null, 'x');
    expect(out.results).toHaveLength(MAX_RESULTS);
    expect(out.totalFiles).toBe(250);
    expect(out.totalResults).toBe(250);
  });

  it('counts title-only hits as one result each', () => {
    const out = runSearch([{ path: 'Zebra.md', content: '' }, { path: 'a.md', content: 'zebra zebra' }], null, 'zebra');
    expect(out).toMatchObject({ totalFiles: 2, totalResults: 3 });
  });
});

describe('buildSnippet', () => {
  it('returns the trimmed line split into plain and highlighted segments', () => {
    const segments = buildSnippet('  a link and a Link ', [{ start: 4, end: 8 }, { start: 15, end: 19 }], { start: 4, end: 8 });
    expect(segments).toEqual([
      { text: 'a ', mark: false },
      { text: 'link', mark: true },
      { text: ' and a ', mark: false },
      { text: 'Link', mark: true },
    ]);
  });

  it('windows long lines around the focused match with ellipses', () => {
    const line = 'a'.repeat(200) + 'needle' + 'b'.repeat(200);
    const focus = { start: 200, end: 206 };
    const segments = buildSnippet(line, [focus], focus, 120);
    expect(segments[0]).toEqual({ text: '…', mark: false });
    expect(segments[segments.length - 1]).toEqual({ text: '…', mark: false });
    expect(segments.find((s) => s.mark)).toEqual({ text: 'needle', mark: true });
    const shown = segments.map((s) => s.text).join('');
    expect(shown.length).toBe(122);
    expect(shown.indexOf('needle')).toBe(31);
  });

  it('keeps the window inside the line at either end', () => {
    const start = buildSnippet('needle' + 'b'.repeat(200), [{ start: 0, end: 6 }], { start: 0, end: 6 }, 50);
    expect(start[0]).toEqual({ text: 'needle', mark: true });
    expect(start[start.length - 1].text).toBe('…');
    const end = buildSnippet('a'.repeat(200) + 'needle', [{ start: 200, end: 206 }], { start: 200, end: 206 }, 50);
    expect(end[0].text).toBe('…');
    expect(end[end.length - 1]).toEqual({ text: 'needle', mark: true });
  });
});

describe('formatSummary', () => {
  it('pluralizes and reports no results', () => {
    expect(formatSummary(0, 0)).toBe('No results');
    expect(formatSummary(1, 1)).toBe('1 result in 1 file');
    expect(formatSummary(12, 3)).toBe('12 results in 3 files');
  });
});
