import { fuzzyFilter } from '../../core/search/fuzzy';
import { basename, dirname, folderMatchesHint, isMarkdown, normalizePath, noteTitle, validateName } from '../../core/vault/path';

export type SwitcherItem =
  | { kind: 'note'; path: string; title: string }
  /** A wikilink target that no note resolves to yet. */
  | { kind: 'unresolved'; target: string; title: string }
  /** Offer to create a note named after the query. */
  | { kind: 'create'; name: string; path: string }
  /** The query is not a valid note name; shown disabled with the reason. */
  | { kind: 'invalid'; name: string; reason: string };

type NoteItem = Extract<SwitcherItem, { kind: 'note' }>;
type UnresolvedItem = Extract<SwitcherItem, { kind: 'unresolved' }>;
type Candidate = NoteItem | UnresolvedItem;

export interface SwitcherRow {
  item: SwitcherItem;
  /** Matched character indices in the field given by `field`. */
  indices: number[];
  /** 0 = title, 1 = path. */
  field: number;
}

export interface SwitcherSource {
  /** Markdown note paths. */
  notePaths: string[];
  unresolvedTargets: string[];
  /** Navigation history, oldest first. */
  history: string[];
}

/** Most recently opened paths first, de-duplicated, restricted to paths in `exists`. */
export function recentPaths(history: string[], exists: Set<string>): string[] {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const path = history[i];
    if (exists.has(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Rows for the quick switcher: recent notes first when the query is blank, otherwise fuzzy-ranked. */
export function switcherRows(query: string, src: SwitcherSource): SwitcherRow[] {
  const q = query.trim();
  const notes: NoteItem[] = src.notePaths.map((path) => ({ kind: 'note', path, title: noteTitle(path) }));
  const unresolved: UnresolvedItem[] = src.unresolvedTargets.map((target) => ({ kind: 'unresolved', target, title: target }));

  if (!q) {
    const byPath = new Map(notes.map((n) => [n.path, n]));
    const recent = recentPaths(src.history, new Set(byPath.keys()));
    const recentSet = new Set(recent);
    const rest = notes.filter((n) => !recentSet.has(n.path)).sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
    const items: SwitcherItem[] = [...recent.map((p) => byPath.get(p) as NoteItem), ...rest, ...unresolved];
    return items.map((item) => ({ item, indices: [], field: 0 }));
  }

  // The query is typed like a file name: a trailing ".md" is the extension, not part of the title.
  const name = isMarkdown(q) ? q.slice(0, -3) : q;
  const normalized = normalizePath(name);
  const candidates: Candidate[] = [...notes, ...unresolved];
  // A root-level note's path is just its title plus ".md", so only folder paths add anything to match on.
  const fields = (item: Candidate): string[] => (item.kind === 'note' && dirname(item.path) ? [item.title, item.path] : [item.title]);
  const rows: SwitcherRow[] = fuzzyFilter(normalized || name, candidates, fields).map((r) => ({
    item: r.item,
    indices: r.indices,
    field: r.field,
  }));
  if (!isTaken(normalized, candidates)) {
    // Folder segments are fine ("Projects/Weekly"), but each must be a name the rename and create UIs would accept too.
    const invalid = name.split('/').map((segment) => validateName(segment)).find((error) => error !== null);
    const item: SwitcherItem = invalid ? { kind: 'invalid', name: q, reason: invalid } : { kind: 'create', name: normalized, path: `${normalized}.md` };
    rows.push({ item, indices: [], field: 0 });
  }
  return rows;
}

/**
 * Whether a wikilink to `name` (a normalized note path without extension) would already resolve to a candidate:
 * same title, and when the query names a folder, a note whose folder ends with it (case-insensitive), following
 * the same rule as `Vault.resolveLink`.
 */
function isTaken(name: string, candidates: Candidate[]): boolean {
  const lower = name.toLowerCase();
  if (!lower) return false;
  const wantDir = dirname(lower);
  const wantTitle = basename(lower);
  return candidates.some((c) => {
    if (c.kind === 'unresolved') return normalizePath(c.title).toLowerCase() === lower;
    if (c.title.toLowerCase() !== wantTitle) return false;
    return folderMatchesHint(dirname(c.path).toLowerCase(), wantDir);
  });
}
