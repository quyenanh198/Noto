import { describe, expect, it } from 'vitest';
import { buildTagTree, sortTagTree, type TagNode } from './tagTree';

const shape = (nodes: TagNode[]): unknown => nodes.map((n) => [n.tag, n.count, shape(n.children)]);

describe('buildTagTree', () => {
  it('nests tags on "/" and creates implicit parents', () => {
    const tree = buildTagTree([
      { name: 'project/noto', count: 1 },
      { name: 'reference', count: 2 },
      { name: 'reference/links', count: 1 },
    ]);
    expect(tree.map((n) => n.tag)).toEqual(['project', 'reference']);
    expect(tree[0].name).toBe('project');
    expect(tree[0].children.map((n) => n.name)).toEqual(['noto']);
    expect(tree[1].children.map((n) => n.tag)).toEqual(['reference/links']);
  });

  it('rolls counts up from descendants when no counter is given', () => {
    const tree = buildTagTree([
      { name: 'a/b/c', count: 2 },
      { name: 'a/b', count: 1 },
      { name: 'a/d', count: 3 },
    ]);
    expect(shape(tree)).toEqual([['a', 6, [['a/b', 3, [['a/b/c', 2, []]]], ['a/d', 3, []]]]]);
  });

  it('uses the counter for accurate per-note counts', () => {
    const notes: Record<string, string[]> = { 'a/b': ['n1'], 'a/c': ['n1'] };
    const countFor = (tag: string) => new Set(Object.entries(notes).filter(([t]) => t === tag || t.startsWith(tag + '/')).flatMap(([, n]) => n)).size;
    const tree = buildTagTree([{ name: 'a/b', count: 1 }, { name: 'a/c', count: 1 }], countFor);
    expect(tree[0].count).toBe(1);
  });

  it('merges case variants of a tag into one node, keeping the first-seen casing', () => {
    const tree = buildTagTree([
      { name: 'Project/Alpha', count: 1 },
      { name: 'project/alpha', count: 1 },
      { name: 'project/noto', count: 1 },
    ]);
    expect(shape(tree)).toEqual([['Project', 3, [['Project/Alpha', 2, []], ['project/noto', 1, []]]]]);
  });

  it('ignores empty segments and names', () => {
    const tree = buildTagTree([{ name: 'a//b', count: 1 }, { name: '', count: 1 }]);
    expect(shape(tree)).toEqual([['a', 1, [['a/b', 1, []]]]]);
  });
});

describe('sortTagTree', () => {
  const tree = buildTagTree([
    { name: 'zeta', count: 5 },
    { name: 'alpha/two', count: 1 },
    { name: 'alpha/one', count: 1 },
    { name: 'beta', count: 3 },
  ]);

  it('sorts by name recursively', () => {
    const sorted = sortTagTree(tree, 'name');
    expect(sorted.map((n) => n.name)).toEqual(['alpha', 'beta', 'zeta']);
    expect(sorted[0].children.map((n) => n.name)).toEqual(['one', 'two']);
  });

  it('sorts by count descending with ties broken by name', () => {
    const sorted = sortTagTree(tree, 'count');
    expect(sorted.map((n) => n.name)).toEqual(['zeta', 'beta', 'alpha']);
    expect(sorted[2].children.map((n) => n.name)).toEqual(['one', 'two']);
  });

  it('does not mutate the input', () => {
    const before = shape(tree);
    sortTagTree(tree, 'count');
    expect(shape(tree)).toEqual(before);
  });
});
