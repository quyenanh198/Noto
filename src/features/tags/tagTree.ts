export interface TagNode {
  /** Last path segment, e.g. `noto` for `project/noto`. */
  name: string;
  /** Full tag name without `#`, e.g. `project/noto`. */
  tag: string;
  /** Notes carrying this tag or any tag nested under it. */
  count: number;
  children: TagNode[];
}

export type TagSort = 'name' | 'count';

/**
 * Build a nested tree from flat `a/b/c` tag names. A parent's count is the number of notes carrying
 * it or any descendant: `countFor(tag)` when given (accurate), otherwise the sum of the own count
 * and the children's counts.
 */
export function buildTagTree(tags: Array<{ name: string; count: number }>, countFor?: (tag: string) => number): TagNode[] {
  const roots: TagNode[] = [];
  const byTag = new Map<string, TagNode>();
  const ensure = (tag: string): TagNode => {
    const existing = byTag.get(tag);
    if (existing) return existing;
    const slash = tag.lastIndexOf('/');
    const node: TagNode = { name: slash === -1 ? tag : tag.slice(slash + 1), tag, count: 0, children: [] };
    byTag.set(tag, node);
    (slash === -1 ? roots : ensure(tag.slice(0, slash)).children).push(node);
    return node;
  };
  for (const t of tags) {
    const tag = t.name.split('/').filter(Boolean).join('/');
    if (tag) ensure(tag).count += t.count;
  }
  for (const root of roots) rollUp(root, countFor);
  return roots;
}

function rollUp(node: TagNode, countFor?: (tag: string) => number): void {
  for (const child of node.children) rollUp(child, countFor);
  node.count = countFor ? countFor(node.tag) : node.count + node.children.reduce((n, c) => n + c.count, 0);
}

/** A copy of the tree sorted recursively by name, or by count (descending, ties by name). */
export function sortTagTree(nodes: TagNode[], by: TagSort): TagNode[] {
  const byName = (a: TagNode, b: TagNode) => a.name.localeCompare(b.name);
  const cmp = by === 'count' ? (a: TagNode, b: TagNode) => b.count - a.count || byName(a, b) : byName;
  return [...nodes].sort(cmp).map((n) => ({ ...n, children: sortTagTree(n.children, by) }));
}
