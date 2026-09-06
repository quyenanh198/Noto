import { parseNote } from '../markdown/links';
import type { VaultFile } from '../types';
import { basename, normalizePath, stripExt } from './path';

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
  const end = ends.length ? Math.min(...ends) : inner.length;
  return raw.slice(0, open) + target + inner.slice(end) + ']]';
}

/** Find, while the notes are still in place, every wikilink that resolves to one of `moves` (old path -> new path). */
export function planLinkRewrites(
  files: Iterable<VaultFile>,
  moves: ReadonlyMap<string, string>,
  resolve: (target: string, from: string) => string | undefined,
): LinkRewritePlan {
  const plan: LinkRewritePlan = new Map();
  // A link can only resolve to a moved note when the basenames agree, so most links skip the (costly) resolution.
  const names = new Set([...moves.keys()].map((p) => stripExt(basename(p)).toLowerCase()));
  for (const file of files) {
    let rewrites: Map<string, string> | undefined;
    for (const link of parseNote(file.path, file.content).links) {
      if (!link.target || !names.has(stripExt(basename(normalizePath(link.target))).toLowerCase())) continue;
      const resolved = resolve(link.target, file.path);
      const next = resolved === undefined ? undefined : moves.get(resolved);
      if (next === undefined) continue;
      (rewrites ??= new Map()).set(link.raw, next);
    }
    if (rewrites) plan.set(file.path, rewrites);
  }
  return plan;
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
