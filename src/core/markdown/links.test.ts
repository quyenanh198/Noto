import { describe, expect, it } from 'vitest';
import { codeRegions, countWords, parseFrontmatter, parseHeadings, parseInlineTags, parseLinkInner, parseNote, parseWikiLinks } from './links';

describe('parseWikiLinks', () => {
  it('parses plain, alias, heading, block and embed links', () => {
    const text = 'See [[Note A]] and [[Note B|alias]] and [[Note C#Section]] and [[Note D#^abc]] and ![[img.png]].';
    const links = parseWikiLinks(text);
    expect(links.map((l) => l.target)).toEqual(['Note A', 'Note B', 'Note C', 'Note D', 'img.png']);
    expect(links[1].alias).toBe('alias');
    expect(links[1].display).toBe('alias');
    expect(links[2].heading).toBe('Section');
    expect(links[2].display).toBe('Note C > Section');
    expect(links[3].block).toBe('abc');
    expect(links[4].embed).toBe(true);
    expect(links[0].raw).toBe('[[Note A]]');
    expect(text.slice(links[0].position.start, links[0].position.end)).toBe('[[Note A]]');
  });

  it('records line numbers', () => {
    const links = parseWikiLinks('a\nb [[X]]\n\n[[Y]]');
    expect(links.map((l) => l.position.line)).toEqual([1, 3]);
  });

  it('ignores links inside code fences and inline code', () => {
    const text = '[[Real]]\n```\n[[Fenced]]\n```\nand `[[Inline]]` and [[Real2]]';
    expect(parseWikiLinks(text).map((l) => l.target)).toEqual(['Real', 'Real2']);
  });

  it('skips empty links', () => {
    expect(parseWikiLinks('[[]] [[ ]]')).toEqual([]);
  });

  it('handles heading-only links', () => {
    const [l] = parseWikiLinks('[[#Heading]]');
    expect(l.target).toBe('');
    expect(l.heading).toBe('Heading');
    expect(l.display).toBe('Heading');
  });

  it('parseLinkInner trims and splits', () => {
    expect(parseLinkInner(' folder/Note #Head | Alias ')).toMatchObject({ target: 'folder/Note', heading: 'Head', alias: 'Alias' });
  });
});

describe('parseInlineTags', () => {
  it('finds tags with nesting and unicode', () => {
    const tags = parseInlineTags('Hello #tag and #nested/child, #việt-nam. Not a#tag or #123 but #a1');
    expect(tags.map((t) => t.name)).toEqual(['tag', 'nested/child', 'việt-nam', 'a1']);
  });

  it('ignores tags in code and headings markers', () => {
    const tags = parseInlineTags('# Heading\n`#code`\n```\n#fenced\n```\n#real');
    expect(tags.map((t) => t.name)).toEqual(['real']);
  });

  it('records positions', () => {
    const text = 'x #abc y';
    const [t] = parseInlineTags(text);
    expect(text.slice(t.position.start, t.position.end)).toBe('#abc');
  });
});

describe('parseHeadings', () => {
  it('parses levels and text, skipping code', () => {
    const text = '# Title\n\n## Sub ##\n```\n# not\n```\n###### Six\n#NotHeading';
    const h = parseHeadings(text);
    expect(h.map((x) => [x.level, x.text])).toEqual([
      [1, 'Title'],
      [2, 'Sub'],
      [6, 'Six'],
    ]);
  });
});

describe('parseFrontmatter', () => {
  it('parses scalars, inline lists and block lists', () => {
    const text = '---\ntitle: Hello\ncount: 3\ndone: true\ntags: [a, b]\naliases:\n  - x\n  - y\n---\n# Body';
    const fm = parseFrontmatter(text);
    expect(fm.data).toEqual({ title: 'Hello', count: 3, done: true, tags: ['a', 'b'], aliases: ['x', 'y'] });
    expect(text.slice(fm.bodyStart)).toBe('# Body');
  });

  it('returns empty when no frontmatter', () => {
    expect(parseFrontmatter('# Hi\n---\n')).toEqual({ data: {}, bodyStart: 0 });
    expect(parseFrontmatter('---\nunterminated')).toEqual({ data: {}, bodyStart: 0 });
  });
});

describe('parseNote', () => {
  it('combines everything and merges frontmatter tags', () => {
    const m = parseNote('dir/My note.md', '---\ntags: [fm, "#quoted"]\n---\n# H\ntext #inline [[Link]]');
    expect(m.title).toBe('My note');
    expect(m.tags.map((t) => t.name)).toEqual(['quoted', 'fm', 'inline']);
    expect(m.links[0].target).toBe('Link');
    expect(m.headings[0].text).toBe('H');
    expect(m.frontmatter.tags).toEqual(['fm', '#quoted']);
    expect(m.wordCount).toBe(4);
  });

  it('does not scan frontmatter for links', () => {
    const m = parseNote('a.md', '---\nrelated: [[Other]]\n---\nbody');
    expect(m.links).toEqual([]);
  });
});

describe('codeRegions', () => {
  it('handles unterminated fences', () => {
    expect(codeRegions('a\n```\nb')).toEqual([[2, 7]]);
  });
});

describe('countWords', () => {
  it('counts words', () => {
    expect(countWords("Hello, world! It's 3 o'clock.")).toBe(5);
    expect(countWords('')).toBe(0);
  });
});
