import { describe, expect, it } from 'vitest';
import { parseWikiLinks } from '../../core/markdown/links';
import { findUnlinkedMentions, lineContaining, linkSnippets, wikilinkFor } from './mentions';

describe('findUnlinkedMentions', () => {
  const file = (path: string, content: string) => ({ path, content });

  it('matches whole words case-insensitively and reports positions', () => {
    const content = 'First line.\nThe welcome note and Welcome again; notwelcome, welcomes.';
    const found = findUnlinkedMentions('Welcome', [file('A.md', content)], new Set());
    expect(found.map((m) => m.text)).toEqual(['welcome', 'Welcome']);
    expect(found.map((m) => m.line)).toEqual([1, 1]);
    for (const m of found) expect(content.slice(m.start, m.end)).toBe(m.text);
    expect(found[0].start).toBe(content.indexOf('welcome'));
  });

  it('treats punctuation as a word boundary', () => {
    const found = findUnlinkedMentions('Welcome', [file('A.md', '(Welcome), "welcome"!')], new Set());
    expect(found).toHaveLength(2);
  });

  it('ignores text inside wikilinks', () => {
    const content = 'See [[Welcome]] and [[Welcome|the welcome page]] and [[Other|Welcome]] but Welcome here.';
    const found = findUnlinkedMentions('Welcome', [file('A.md', content)], new Set());
    expect(found).toHaveLength(1);
    expect(found[0].start).toBe(content.lastIndexOf('Welcome'));
  });

  it('ignores code blocks, inline code and front matter', () => {
    const content = '---\ntitle: Welcome\n---\n`Welcome` here\n```\nWelcome fenced\n```\nWelcome ok';
    const found = findUnlinkedMentions('Welcome', [file('A.md', content)], new Set());
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(7);
  });

  it('excludes the note itself and excluded notes', () => {
    const files = [file('Welcome.md', 'Welcome'), file('Linked.md', 'Welcome'), file('Other.md', 'Welcome')];
    const found = findUnlinkedMentions('Welcome', files, new Set(['Welcome.md', 'Linked.md']));
    expect(found.map((m) => m.path)).toEqual(['Other.md']);
  });

  it('matches aliases and prefers the longest name', () => {
    const content = 'Markdown syntax and syntax alone.';
    const found = findUnlinkedMentions('Markdown syntax', [file('A.md', content)], new Set(), ['syntax']);
    expect(found.map((m) => m.text)).toEqual(['Markdown syntax', 'syntax']);
  });

  it('escapes regex characters in titles', () => {
    expect(findUnlinkedMentions('C++ (notes)', [file('A.md', 'about C++ (notes) today')], new Set())).toHaveLength(1);
  });

  it('handles multi-line files with correct line numbers', () => {
    const content = 'a\nb\n\nWelcome\nx Welcome';
    expect(findUnlinkedMentions('Welcome', [file('A.md', content)], new Set()).map((m) => m.line)).toEqual([3, 4]);
  });
});

describe('lineContaining', () => {
  it('returns the surrounding line and its offset', () => {
    const content = 'first\nsecond line\nthird';
    expect(lineContaining(content, 8)).toEqual({ start: 6, end: 17, text: 'second line' });
    expect(lineContaining(content, 0)).toEqual({ start: 0, end: 5, text: 'first' });
    expect(lineContaining(content, 20)).toEqual({ start: 18, end: 23, text: 'third' });
  });
});

describe('linkSnippets', () => {
  it('groups links by line, trims indentation and keeps ranges relative', () => {
    const content = '# Title\n  - see [[A]] and [[A|alias]]\nplain [[A]]';
    const snippets = linkSnippets(content, parseWikiLinks(content));
    expect(snippets).toHaveLength(2);
    expect(snippets[0].line).toBe(1);
    expect(snippets[0].text).toBe('- see [[A]] and [[A|alias]]');
    expect(snippets[0].ranges.map(([s, e]) => snippets[0].text.slice(s, e))).toEqual(['[[A]]', '[[A|alias]]']);
    expect(snippets[1]).toEqual({ line: 2, text: 'plain [[A]]', ranges: [[6, 11]] });
  });
});

describe('wikilinkFor', () => {
  it('uses an alias only when the text differs from the link', () => {
    expect(wikilinkFor('Welcome', 'Welcome')).toBe('[[Welcome]]');
    expect(wikilinkFor('Welcome', 'welcome')).toBe('[[Welcome|welcome]]');
    expect(wikilinkFor('Markdown syntax', 'Syntax')).toBe('[[Markdown syntax|Syntax]]');
  });
});
