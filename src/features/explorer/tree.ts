import { ancestors, basename, dirname, extname, isMarkdown, isWithin, joinPath, noteTitle, stripExt } from '../../core/vault/path';

export type NodeKind = 'folder' | 'file';

export interface TreeNode {
  kind: NodeKind;
  /** Vault-relative path. */
  path: string;
  /** Label shown in the tree: note title without `.md`, otherwise the full file or folder name. */
  name: string;
  /** Nesting depth; root items are 0. */
  depth: number;
  /** True for `.md` notes. */
  markdown: boolean;
  /** Sorted children (folders first). Always empty for files. */
  children: TreeNode[];
}

/** Natural, case-insensitive order: `note 2` sorts before `note 10`. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || a.localeCompare(b);
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return compareNames(a.name, b.name);
}

function sortDeep(nodes: TreeNode[]): void {
  nodes.sort(compareNodes);
  for (const n of nodes) if (n.children.length) sortDeep(n.children);
}

/**
 * Build the explorer tree from the vault's file and folder paths.
 * Folders come first at every level, then files, both in natural alphabetical order.
 * Folders implied by file paths are included even when missing from `folderPaths`.
 */
export function buildTree(filePaths: readonly string[], folderPaths: readonly string[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();
  const folderOf = (path: string): TreeNode => {
    let node = folders.get(path);
    if (!node) {
      node = { kind: 'folder', path, name: basename(path), depth: ancestors(path).length, markdown: false, children: [] };
      folders.set(path, node);
    }
    return node;
  };
  const childrenOf = (dir: string): TreeNode[] => (dir === '' ? roots : folderOf(dir).children);

  const allFolders = new Set<string>();
  for (const folder of folderPaths) {
    for (const a of ancestors(folder)) allFolders.add(a);
    if (folder) allFolders.add(folder);
  }
  for (const file of filePaths) for (const a of ancestors(file)) allFolders.add(a);
  for (const path of allFolders) childrenOf(dirname(path)).push(folderOf(path));

  for (const path of filePaths) {
    const markdown = isMarkdown(path);
    childrenOf(dirname(path)).push({
      kind: 'file',
      path,
      name: markdown ? noteTitle(path) : basename(path),
      depth: ancestors(path).length,
      markdown,
      children: [],
    });
  }
  sortDeep(roots);
  return roots;
}

/** Every node in the tree, keyed by path. */
export function collectNodes(nodes: readonly TreeNode[]): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  const visit = (list: readonly TreeNode[]) => {
    for (const n of list) {
      out.set(n.path, n);
      visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

/** The rows currently visible, in display order, given which folders are expanded. */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const visit = (list: readonly TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.kind === 'folder' && expanded.has(n.path)) visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

/** Returns `expanded` with every ancestor folder of `path` added, or the same set when nothing changes. */
export function expandAncestors(expanded: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const missing = ancestors(path).filter((a) => !expanded.has(a));
  if (missing.length === 0) return expanded;
  return new Set([...expanded, ...missing]);
}

/**
 * Returns `expanded` after the folder `from` was renamed or moved to `to`: it and every expanded folder inside it
 * are re-keyed under the new path and the old paths dropped. Returns the same set when nothing changes.
 */
export function rekeyExpanded(expanded: ReadonlySet<string>, from: string, to: string): ReadonlySet<string> {
  const affected = [...expanded].filter((p) => isWithin(p, from));
  if (affected.length === 0) return expanded;
  const next = new Set(expanded);
  for (const p of affected) {
    next.delete(p);
    next.add(to + p.slice(from.length));
  }
  return next;
}

/** Returns `expanded` without `folder` and every folder inside it, or the same set when nothing changes. */
export function removeExpanded(expanded: ReadonlySet<string>, folder: string): ReadonlySet<string> {
  const kept = [...expanded].filter((p) => !isWithin(p, folder));
  return kept.length === expanded.size ? expanded : new Set(kept);
}

/** `New folder`, then `New folder 1`, `New folder 2`… inside `parent` (`''` for root), skipping paths that exist. */
export function uniqueFolderPath(parent: string, exists: (path: string) => boolean, base = 'New folder'): string {
  let candidate = joinPath(parent, base);
  for (let i = 1; exists(candidate); i++) candidate = joinPath(parent, `${base} ${i}`);
  return candidate;
}

/** Whether `source` may be moved into `targetFolder` (`''` for root): not into itself/descendants, not to its current parent. */
export function canMoveTo(source: { path: string; kind: NodeKind }, targetFolder: string): boolean {
  if (source.kind === 'folder' && isWithin(targetFolder, source.path)) return false;
  return dirname(source.path) !== targetFolder;
}

/** Path of `path` after moving it into `targetFolder`. */
export function moveDestination(path: string, targetFolder: string): string {
  return joinPath(targetFolder, basename(path));
}

/** Text to prefill when renaming: folder name, or file name without its extension. */
export function renamePrefill(node: { path: string; kind: NodeKind }): string {
  return node.kind === 'folder' ? basename(node.path) : stripExt(basename(node.path));
}

/** New path for a rename to `name` (a bare name, no extension): files keep their original extension. */
export function renameTarget(node: { path: string; kind: NodeKind }, name: string): string {
  const trimmed = name.trim();
  const ext = node.kind === 'file' ? extname(node.path) : '';
  const keepsExt = ext !== '' && trimmed.toLowerCase().endsWith(ext.toLowerCase()) && trimmed.length > ext.length;
  return joinPath(dirname(node.path), keepsExt ? trimmed : trimmed + ext);
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export interface NavResult {
  /** Row to highlight afterwards. */
  focus: string | null;
  expand?: string;
  collapse?: string;
}

/** Keyboard navigation over the visible rows. `current` is the highlighted row (may be missing). */
export function navigate(rows: readonly TreeNode[], expanded: ReadonlySet<string>, current: string | null, key: NavKey): NavResult {
  if (rows.length === 0) return { focus: null };
  const index = current === null ? -1 : rows.findIndex((r) => r.path === current);
  const node = index >= 0 ? rows[index] : undefined;
  switch (key) {
    case 'ArrowDown':
      return { focus: rows[Math.min(index + 1, rows.length - 1)].path };
    case 'ArrowUp':
      return { focus: rows[Math.max(index - 1, 0)].path };
    case 'ArrowRight': {
      if (!node) return { focus: rows[0].path };
      if (node.kind !== 'folder') return { focus: node.path };
      if (!expanded.has(node.path)) return { focus: node.path, expand: node.path };
      return { focus: node.children.length ? node.children[0].path : node.path };
    }
    case 'ArrowLeft': {
      if (!node) return { focus: rows[0].path };
      if (node.kind === 'folder' && expanded.has(node.path)) return { focus: node.path, collapse: node.path };
      const parent = dirname(node.path);
      return { focus: parent || node.path };
    }
  }
}
