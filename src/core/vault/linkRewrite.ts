import { parseNote } from '../markdown/links';
import type { VaultFile } from '../types';
import { basename, normalizePath, noteKey } from './path';

/**
 * Keeping `[[links]]` pointing at notes that are renamed or moved, the way Obsidian's
 * "automatically update internal links" does. Links are identified by their raw text: from a
 * given note, the same raw text always resolves to the same target, so a plan made before the
 * move can be applied to whatever the note's content is afterwards.
 */

/** Per source note (its path before the move): raw link text -> new path of the note it points at. */
export type LinkRewritePlan = Map<string, Map<string, string>>;

/** Swap the target part of a raw `[[...]]` / `![[...]]`, keeping heading, block and alias as written. */
export function replaceLinkTarget(raw: string, target: string): string {
  const open = raw.startsWith('!') ? 3 : 2;
  const inner = raw.slice(open, -2);
  const ends = [inner.indexOf('#'), inner.indexOf('|')].filter((i) => i !== -1);
  let end = ends.length ? Math.min(...ends) : inner.length;
  // Inside tables the alias separator is written `\|`; the backslash belongs with the separator, not the target.
  if (inner[end] === '|' && inner[end - 1] === '\\') end--;
  return raw.slice(0, open) + target + inner.slice(end) + ']]';
}

/** Find, while the notes are still in place, every wikilink that resolves to one of `moves` (old path -> new path). */
export function planLinkRewrites(
  files: Iterable<VaultFile>,
  moves: ReadonlyMap<string, string>,
  resolve: (target: string, from: string) => string | undefined,
): LinkRewritePlan {
  const plan: LinkRewritePlan = new Map();
  // A link can only resolve to a moved file when the names agree, so most links skip the (costly) resolution.
  const names = new Set([...moves.keys()].map((p) => noteKey(basename(p)).toLowerCase()));
  for (const file of files) {
    let rewrites: Map<string, string> | undefined;
    for (const link of parseNote(file.path, file.content).links) {
      if (!link.target || !names.has(noteKey(basename(normalizePath(link.target))).toLowerCase())) continue;
      const resolved = resolve(link.target, file.path);
      const next = resolved === undefined ? undefined : moves.get(resolved);
      if (next === undefined) continue;
      (rewrites ??= new Map()).set(link.raw, next);
    }
    if (rewrites) plan.set(file.path, rewrites);
  }
  return plan;
}

/**
 * For the notes about to move: what each of their links resolves to from the old place (raw text -> path).
 * Short links resolve relative to the note's own folder, so moving the note can silently change their meaning.
 */
export function planOwnLinks(moved: Iterable<VaultFile>, resolve: (target: string, from: string) => string | undefined): LinkRewritePlan {
  const plan: LinkRewritePlan = new Map();
  for (const file of moved) {
    let resolved: Map<string, string> | undefined;
    for (const link of parseNote(file.path, file.content).links) {
      if (!link.target) continue;
      const path = resolve(link.target, file.path);
      if (path !== undefined) (resolved ??= new Map()).set(link.raw, path);
    }
    if (resolved) plan.set(file.path, resolved);
  }
  return plan;
}

/**
 * After the move: the links of a moved note (now at `path`) that no longer resolve to the note they did before,
 * mapped to that note's current path. `resolve` must see the vault after the move.
 */
export function ownLinkRewrites(
  path: string,
  content: string,
  resolvedBefore: ReadonlyMap<string, string>,
  moves: ReadonlyMap<string, string>,
  resolve: (target: string, from: string) => string | undefined,
): Map<string, string> {
  const rewrites = new Map<string, string>();
  for (const link of parseNote(path, content).links) {
    const before = resolvedBefore.get(link.raw);
    if (before === undefined) continue;
    const intended = moves.get(before) ?? before;
    if (resolve(link.target, path) !== intended) rewrites.set(link.raw, intended);
  }
  return rewrites;
}

/** Apply a note's planned rewrites to its current content. `linkTextFor` must see the vault after the move. */
export function applyLinkRewrites(path: string, content: string, rewrites: ReadonlyMap<string, string>, linkTextFor: (path: string) => string): string {
  let out = content;
  // Replace from the end so earlier offsets stay valid.
  for (const link of parseNote(path, content).links.reverse()) {
    const target = rewrites.get(link.raw);
    if (target === undefined) continue;
    out = out.slice(0, link.position.start) + replaceLinkTarget(link.raw, linkTextFor(target)) + out.slice(link.position.end);
  }
  return out;
}
