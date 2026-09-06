import { fuzzyFilter } from '../../core/search/fuzzy';
import { dirname, noteTitle, validateNotePath, withMdExt } from '../../core/vault/path';

export type SwitcherItem =
  | { kind: 'note'; path: string; title: string }
  /** A wikilink target that no note resolves to yet. */
  | { kind: 'unresolved'; target: string; title: string }
  /** Offer to create a note named after the query. */
  | { kind: 'create'; name: string; path: string };

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

  const candidates: Candidate[] = [...notes, ...unresolved];
  // A root-level note's path is just its title plus ".md", so only folder paths add anything to match on.
  const fields = (item: Candidate): string[] => (item.kind === 'note' && dirname(item.path) ? [item.title, item.path] : [item.title]);
  const rows: SwitcherRow[] = fuzzyFilter(q, candidates, fields).map((r) => ({
    item: r.item,
    indices: r.indices,
    field: r.field,
  }));
  const lower = q.toLowerCase();
  const taken = candidates.some((c) => c.title.toLowerCase() === lower);
  if (!taken && validateNotePath(q) === null) rows.push({ item: { kind: 'create', name: q, path: withMdExt(q) }, indices: [], field: 0 });
  return rows;
}
