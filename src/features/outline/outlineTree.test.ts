import { describe, expect, it } from 'vitest';
import { parseHeadings } from '../../core/markdown/links';
import { buildOutlineTree, stripMarkup } from './outlineTree';

const shape = (nodes: ReturnType<typeof buildOutlineTree>): unknown =>
  nodes.map((n) => (n.children.length ? { [n.display]: shape(n.children) } : n.display));

describe('buildOutlineTree', () => {
  it('nests headings under the nearest shallower heading', () => {
    const tree = buildOutlineTree(parseHeadings('# A\n## B\n### C\n## D\n# E'));
    expect(shape(tree)).toEqual([{ A: [{ B: ['C'] }, 'D'] }, 'E']);
  });

  it('tolerates skipped levels', () => {
    const tree = buildOutlineTree(parseHeadings('# A\n### C\n#### D\n## B\n### F'));
    expect(shape(tree)).toEqual([{ A: [{ C: ['D'] }, { B: ['F'] }] }]);
  });

  it('makes a deeper first heading a root and later shallower headings siblings', () => {
    const tree = buildOutlineTree(parseHeadings('### C\n# A\n## B'));
    expect(shape(tree)).toEqual(['C', { A: ['B'] }]);
  });

  it('keeps raw text, level and line for navigation', () => {
    const [a] = buildOutlineTree(parseHeadings('intro\n\n# **Bold** title'));
    expect(a).toMatchObject({ level: 1, text: '**Bold** title', display: 'Bold title', line: 2 });
  });

  it('gives headings with the same level and text distinct, position-independent keys', () => {
    const [a, b] = buildOutlineTree(parseHeadings('## Notes\n\n## Notes'));
    expect(a.key).not.toBe(b.key);
    const [c, d] = buildOutlineTree(parseHeadings('intro\n\n## Notes\n\n\n## Notes'));
    expect([c.key, d.key]).toEqual([a.key, b.key]);
  });

  it('returns an empty tree for no headings', () => {
    expect(buildOutlineTree([])).toEqual([]);
  });
});

describe('stripMarkup', () => {
  it('removes emphasis, code, strikethrough and highlight markers', () => {
    expect(stripMarkup('**bold** and *it* and _em_ and `code` and ~~gone~~ and ==hi==')).toBe('bold and it and em and code and gone and hi');
  });

  it('shows wikilinks by their display text and markdown links by their label', () => {
    expect(stripMarkup('See [[Note|Alias]] and [[Other]] and [[Other#Part]] and [label](http://x)')).toBe('See Alias and Other and Other > Part and label');
  });

  it('keeps underscores inside words and strips html tags', () => {
    expect(stripMarkup('snake_case_name <b>tag</b>')).toBe('snake_case_name tag');
  });
});
