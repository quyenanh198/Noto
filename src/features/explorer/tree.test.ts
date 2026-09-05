import { describe, expect, it } from 'vitest';
import {
  buildTree,
  canMoveTo,
  collectNodes,
  compareNames,
  expandAncestors,
  flattenTree,
  moveDestination,
  navigate,
  renamePrefill,
  renameTarget,
  uniqueFolderPath,
  type TreeNode,
} from './tree';

const names = (nodes: readonly TreeNode[]) => nodes.map((n) => n.name);

describe('compareNames', () => {
  it('orders naturally and case-insensitively', () => {
    expect(['note 10', 'Note 2', 'note 1'].sort(compareNames)).toEqual(['note 1', 'Note 2', 'note 10']);
    expect(['b', 'A', 'c'].sort(compareNames)).toEqual(['A', 'b', 'c']);
  });
});

describe('buildTree', () => {
  it('puts folders first, then files, each in natural order', () => {
    const tree = buildTree(['zeta.md', 'Note 10.md', 'note 2.md', 'Alpha/x.md'], ['beta', 'Alpha']);
    expect(names(tree)).toEqual(['Alpha', 'beta', 'note 2', 'Note 10', 'zeta']);
    expect(tree.map((n) => n.kind)).toEqual(['folder', 'folder', 'file', 'file', 'file']);
  });

  it('nests folders and files, computing depth and implicit folders', () => {
    const tree = buildTree(['Projects/Noto/roadmap.md', 'Projects/ideas.md', 'Welcome.md'], []);
    expect(names(tree)).toEqual(['Projects', 'Welcome']);
    const projects = tree[0];
    expect(projects.kind).toBe('folder');
    expect(projects.depth).toBe(0);
    expect(names(projects.children)).toEqual(['Noto', 'ideas']);
    const noto = projects.children[0];
    expect(noto.path).toBe('Projects/Noto');
    expect(noto.depth).toBe(1);
    expect(noto.children[0]).toMatchObject({ path: 'Projects/Noto/roadmap.md', name: 'roadmap', depth: 2, kind: 'file', markdown: true });
  });

  it('keeps explicit empty folders and shows non-markdown files with their full name', () => {
    const tree = buildTree(['image.png', 'Note.md'], ['Daily']);
    expect(tree.map((n) => [n.name, n.kind, n.markdown])).toEqual([
      ['Daily', 'folder', false],
      ['image.png', 'file', false],
      ['Note', 'file', true],
    ]);
    expect(tree[0].children).toEqual([]);
  });

  it('collects every node by path', () => {
    const tree = buildTree(['a/b/c.md', 'd.md'], []);
    expect([...collectNodes(tree).keys()].sort()).toEqual(['a', 'a/b', 'a/b/c.md', 'd.md']);
  });
});

describe('flattenTree', () => {
  const tree = buildTree(['a/b/c.md', 'a/x.md', 'root.md'], []);

  it('shows only the children of expanded folders', () => {
    expect(flattenTree(tree, new Set()).map((n) => n.path)).toEqual(['a', 'root.md']);
    expect(flattenTree(tree, new Set(['a'])).map((n) => n.path)).toEqual(['a', 'a/b', 'a/x.md', 'root.md']);
    expect(flattenTree(tree, new Set(['a', 'a/b'])).map((n) => n.path)).toEqual(['a', 'a/b', 'a/b/c.md', 'a/x.md', 'root.md']);
  });

  it('ignores expanded descendants of a collapsed folder', () => {
    expect(flattenTree(tree, new Set(['a/b'])).map((n) => n.path)).toEqual(['a', 'root.md']);
  });
});

describe('expandAncestors', () => {
  it('adds missing ancestors and returns the same set when nothing changes', () => {
    const start: ReadonlySet<string> = new Set(['other']);
    const next = expandAncestors(start, 'a/b/c.md');
    expect([...next].sort()).toEqual(['a', 'a/b', 'other']);
    expect(expandAncestors(next, 'a/b/c.md')).toBe(next);
    expect(expandAncestors(start, 'root.md')).toBe(start);
  });
});

describe('uniqueFolderPath', () => {
  it('appends a counter until the name is free', () => {
    const existing = new Set(['New folder', 'New folder 1', 'sub/New folder']);
    const exists = (p: string) => existing.has(p);
    expect(uniqueFolderPath('', exists)).toBe('New folder 2');
    expect(uniqueFolderPath('sub', exists)).toBe('sub/New folder 1');
    expect(uniqueFolderPath('empty', exists)).toBe('empty/New folder');
  });
});

describe('canMoveTo / moveDestination', () => {
  it('refuses moving a folder into itself or a descendant', () => {
    expect(canMoveTo({ path: 'a', kind: 'folder' }, 'a')).toBe(false);
    expect(canMoveTo({ path: 'a', kind: 'folder' }, 'a/b')).toBe(false);
    expect(canMoveTo({ path: 'a', kind: 'folder' }, 'ab')).toBe(true);
  });

  it('refuses dropping onto the current parent', () => {
    expect(canMoveTo({ path: 'a/x.md', kind: 'file' }, 'a')).toBe(false);
    expect(canMoveTo({ path: 'x.md', kind: 'file' }, '')).toBe(false);
    expect(canMoveTo({ path: 'a/b', kind: 'folder' }, 'a')).toBe(false);
  });

  it('allows other moves, including to the root', () => {
    expect(canMoveTo({ path: 'a/x.md', kind: 'file' }, '')).toBe(true);
    expect(canMoveTo({ path: 'a/x.md', kind: 'file' }, 'b')).toBe(true);
    expect(canMoveTo({ path: 'a/b', kind: 'folder' }, '')).toBe(true);
    expect(moveDestination('a/x.md', 'b/c')).toBe('b/c/x.md');
    expect(moveDestination('a/b', '')).toBe('b');
  });
});

describe('rename helpers', () => {
  it('prefills the title for notes and the name for folders', () => {
    expect(renamePrefill({ path: 'a/Note.md', kind: 'file' })).toBe('Note');
    expect(renamePrefill({ path: 'a/image.png', kind: 'file' })).toBe('image');
    expect(renamePrefill({ path: 'a/b', kind: 'folder' })).toBe('b');
  });

  it('keeps the original extension and folder', () => {
    expect(renameTarget({ path: 'a/Note.md', kind: 'file' }, 'Renamed')).toBe('a/Renamed.md');
    expect(renameTarget({ path: 'a/Note.md', kind: 'file' }, ' Renamed.md ')).toBe('a/Renamed.md');
    expect(renameTarget({ path: 'image.png', kind: 'file' }, 'photo')).toBe('photo.png');
    expect(renameTarget({ path: 'a/b', kind: 'folder' }, 'c')).toBe('a/c');
  });
});

describe('navigate', () => {
  const tree = buildTree(['a/b/c.md', 'a/x.md', 'root.md'], []);
  const expanded = new Set(['a']);
  const rows = flattenTree(tree, expanded); // a, a/b, a/x.md, root.md

  it('moves up and down, clamping at the ends', () => {
    expect(navigate(rows, expanded, null, 'ArrowDown').focus).toBe('a');
    expect(navigate(rows, expanded, 'a', 'ArrowDown').focus).toBe('a/b');
    expect(navigate(rows, expanded, 'root.md', 'ArrowDown').focus).toBe('root.md');
    expect(navigate(rows, expanded, 'a', 'ArrowUp').focus).toBe('a');
    expect(navigate(rows, expanded, 'root.md', 'ArrowUp').focus).toBe('a/x.md');
  });

  it('expands a collapsed folder, then steps into it', () => {
    expect(navigate(rows, expanded, 'a/b', 'ArrowRight')).toEqual({ focus: 'a/b', expand: 'a/b' });
    expect(navigate(rows, expanded, 'a', 'ArrowRight')).toEqual({ focus: 'a/b' });
    expect(navigate(rows, expanded, 'root.md', 'ArrowRight')).toEqual({ focus: 'root.md' });
  });

  it('collapses an expanded folder, otherwise moves to the parent', () => {
    expect(navigate(rows, expanded, 'a', 'ArrowLeft')).toEqual({ focus: 'a', collapse: 'a' });
    expect(navigate(rows, expanded, 'a/x.md', 'ArrowLeft')).toEqual({ focus: 'a' });
    expect(navigate(rows, expanded, 'root.md', 'ArrowLeft')).toEqual({ focus: 'root.md' });
  });

  it('handles an empty tree and a missing current row', () => {
    expect(navigate([], expanded, null, 'ArrowDown')).toEqual({ focus: null });
    expect(navigate(rows, expanded, 'gone.md', 'ArrowUp').focus).toBe('a');
    expect(navigate(rows, expanded, null, 'ArrowLeft').focus).toBe('a');
  });
});
