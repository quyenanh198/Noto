import { describe, expect, it } from 'vitest';
import { codeRegions, countWords, parseFrontmatter, parseHeadings, parseInlineTags, parseLinkInner, parseNote, parseWikiLinks } from './links';
import { renderMarkdown } from './render';

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
    // An unclosed opener inside code does not hide the link that follows it.
    expect(parseWikiLinks('Type `[[` to link, for example [[Linking notes]].').map((l) => l.target)).toEqual(['Linking notes']);
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

  it('treats an escaped pipe (as written inside tables) as the alias separator', () => {
    expect(parseLinkInner('A\\|b')).toMatchObject({ target: 'A', alias: 'b', display: 'b' });
    expect(parseLinkInner('A#H\\|b')).toMatchObject({ target: 'A', heading: 'H', alias: 'b' });
    const [link] = parseWikiLinks('| [[Welcome#Get started\\|start]] |');
    expect(link).toMatchObject({ target: 'Welcome', heading: 'Get started', alias: 'start' });
  });

  it('ignores escaped brackets', () => {
    expect(parseWikiLinks('see \\[[Other]] here, but \\\\[[Real]]').map((l) => l.target)).toEqual(['Real']);
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

  it('never reads text inside wikilinks as tags', () => {
    expect(parseInlineTags('see [[#Explore]]')).toEqual([]);
    expect(parseInlineTags('[[#Heading with alias|alias]] [[Other #H]] [[Other|see #todo later]]')).toEqual([]);
    expect(parseInlineTags('[[Note#Heading]] #real').map((t) => t.name)).toEqual(['real']);
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

  it('parses setext, blockquoted and indented headings like the renderer', () => {
    const text = 'Intro\n=====\n\nSecond\n------\n\n> # Quoted\n\n   # Indented\n\n    # Code\n\n- item\n---\n\nText\n\n---\n\n> Quoted setext\n> ---';
    expect(parseHeadings(text).map((h) => [h.level, h.text, h.position.line])).toEqual([
      [1, 'Intro', 0],
      [2, 'Second', 3],
      [1, 'Quoted', 6],
      [1, 'Indented', 8],
      [2, 'Quoted setext', 19],
    ]);
    const [intro] = parseHeadings(text);
    expect(text.slice(intro.position.start, intro.position.end)).toBe('Intro\n=====');
  });

  it('does not read front matter as headings', () => {
    expect(parseHeadings('---\ntitle: x\n# comment\n---\n# Real').map((h) => h.text)).toEqual(['Real']);
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

  it('does not index heading links or alias text as tags', () => {
    const m = parseNote('N.md', 'Contents: [[#Intro]] [[#Setup notes]] [[Other #Heading]] [[Other|see #todo later]]\n\n# Intro');
    expect(m.tags).toEqual([]);
    expect(m.links.map((l) => [l.target, l.heading])).toEqual([
      ['', 'Intro'],
      ['', 'Setup notes'],
      ['Other', 'Heading'],
      ['Other', undefined],
    ]);
  });
});

describe('codeRegions', () => {
  it('handles unterminated fences', () => {
    expect(codeRegions('a\n```\nb')).toEqual([[2, 7]]);
  });

  it('does not open a fence on a line whose info string has backticks', () => {
    const text = '```code``` inline.\n\nThen [[Other]] and #tag\n\n## Heading';
    expect(codeRegions(text)).toEqual([[0, 10]]);
    const m = parseNote('a.md', text);
    expect(m.links.map((l) => l.target)).toEqual(['Other']);
    expect(m.tags.map((t) => t.name)).toEqual(['tag']);
    expect(m.headings.map((h) => h.text)).toEqual(['Heading']);
  });

  it('only closes a fence with a bare marker line', () => {
    expect(parseWikiLinks('```\ncode\n```js\nmore [[Link]]\n```\n[[After]]').map((l) => l.target)).toEqual(['After']);
    expect(parseWikiLinks('~~~ info `x`\n[[In]]\n~~~ not a closer\n[[Still]]\n~~~\n[[Out]]').map((l) => l.target)).toEqual(['Out']);
  });

  it('does not let inline code span paragraphs', () => {
    const text = 'use ` for code\n\nSee [[Other]] and #tag\n\nand ` again';
    expect(parseWikiLinks(text).map((l) => l.target)).toEqual(['Other']);
    expect(parseInlineTags(text).map((t) => t.name)).toEqual(['tag']);
  });

  it('treats indented code as code, including fences indented inside list items', () => {
    expect(parseWikiLinks('para\n\n    [[Other]] #tag')).toEqual([]);
    expect(parseInlineTags('para\n\n    [[Other]] #tag')).toEqual([]);
    expect(parseWikiLinks('- item\n\n    ```\n    [[Other]] #tag\n    ```\n[[Out]]').map((l) => l.target)).toEqual(['Out']);
    // Indented text inside a list item or after paragraph text is still a paragraph.
    expect(parseWikiLinks('- item\n\n    [[Inner]]').map((l) => l.target)).toEqual(['Inner']);
    expect(parseWikiLinks('text\n    [[Cont]]').map((l) => l.target)).toEqual(['Cont']);
    // Fences inside blockquotes are code too.
    expect(parseHeadings('> ```\n> # shell comment\n> ```\n> # Real')).toMatchObject([{ text: 'Real' }]);
  });
});

describe('agreement with the renderer', () => {
  const cases = [
    '```code``` inline.\n\nThen [[Other]] and #tag\n\n## Heading\n\n[[Welcome]]',
    '```\ncode\n```js\nmore [[Link]]\n```\n[[After]]',
    'use ` for code\n\nSee [[Other]] and #tag\n\nand ` again',
    'para\n\n    [[Other]] #tag',
    '- item\n\n    ```\n    [[Other]] #tag\n    ```\n',
    'see \\[[Other]] here',
    'Intro\n=====\n\ntext\n\n> # Quoted\n\n   # Indented\n\n## Control',
    '| col |\n| --- |\n| [[Welcome#Get started\\|start]] |',
    'Contents: [[#Intro]] [[Other|see #todo]]\n\n# Intro\n\n#real',
    '> ```\n> # not a heading\n> ```\n> # Quoted',
  ];

  function rendered(text: string) {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown(text, { path: 'N.md', resolveLink: () => undefined });
    return {
      links: [...div.querySelectorAll('a.internal-link')].map((a) => [a.getAttribute('data-href'), a.getAttribute('data-heading') ?? undefined]),
      tags: [...div.querySelectorAll('a.tag')].map((a) => a.getAttribute('data-tag')),
      headings: [...div.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => [Number(h.tagName[1]), h.getAttribute('data-heading')]),
    };
  }

  it.each(cases)('indexes the same links, tags and headings as the reading view for %j', (text) => {
    const m = parseNote('N.md', text);
    expect({
      links: m.links.map((l) => [l.target, l.heading]),
      tags: m.tags.map((t) => t.name),
      headings: m.headings.map((h) => [h.level, h.text]),
    }).toEqual(rendered(text));
  });
});

describe('countWords', () => {
  it('counts words', () => {
    expect(countWords("Hello, world! It's 3 o'clock.")).toBe(5);
    expect(countWords('')).toBe(0);
  });
});
