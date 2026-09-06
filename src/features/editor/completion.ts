import { type Completion, type CompletionSource, pickedCompletion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { MetadataIndex } from '../../core/index/MetadataIndex';
import { TAG_NAME_CHARS } from '../../core/markdown/links';
import { basename, stripExt } from '../../core/vault/path';
import type { Vault } from '../../core/vault/Vault';
import { headingLinkText } from './headingLink';

export interface CompletionDeps {
  vault: Vault;
  index: MetadataIndex;
  /** Path of the note being edited (for resolving `[[Note#heading]]` and same-note headings). */
  path: string;
}

const LINK_PREFIX = /\[\[([^[\]\n|#]*)$/;
const HEADING_PREFIX = /\[\[([^[\]\n|#]*)#([^[\]\n|#]*)$/;
const TAG_PREFIX = new RegExp(`[\\s(]#([${TAG_NAME_CHARS}]*)$`, 'u');
const LINK_TEXT = /^[^[\]\n|#]*$/;
const TAG_TEXT = new RegExp(`^[${TAG_NAME_CHARS}]*$`, 'u');
/** An `|alias]]` or `#heading]]` tail already closing the link right after the cursor. */
const LINK_TAIL = /^[|#][^\]\n]*\]\]/;

/** Closing brackets to append so a link ends with `]]`, given the text right after the cursor. */
export function closingBrackets(after: string): string {
  if (after.startsWith(']]')) return '';
  if (after.startsWith(']')) return ']';
  return ']]';
}

/**
 * Insert the label and make sure the link is closed without duplicating brackets that are already there.
 * When the link goes on with `|alias]]` or `#heading]]`, only the label is replaced and the cursor stays after it.
 */
function applyLinkText(view: EditorView, completion: Completion, from: number, to: number): void {
  const rest = view.state.sliceDoc(to, view.state.doc.lineAt(to).to);
  const continues = LINK_TAIL.test(rest);
  const insert = continues ? completion.label : completion.label + closingBrackets(rest);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + completion.label.length + (continues ? 0 : 2) },
    annotations: pickedCompletion.of(completion),
  });
}

/** Link text per note, following the same rule as `Vault.linkTextFor` but computed in one pass. */
export function noteCompletions(vault: Vault, index: MetadataIndex): Completion[] {
  const counts = new Map<string, number>();
  for (const f of vault.getFiles()) {
    const title = stripExt(basename(f.path));
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const options: Completion[] = vault.getMarkdownFiles().map((f) => {
    const title = stripExt(basename(f.path));
    return { label: (counts.get(title) ?? 0) > 1 ? stripExt(f.path) : title, detail: f.path, type: 'note', apply: applyLinkText };
  });
  for (const u of index.getUnresolvedLinks()) {
    options.push({ label: u.target, detail: 'new', type: 'unresolved', boost: -1, apply: applyLinkText });
  }
  return options;
}

/** Completion sources for `[[links]]`, `[[Note#headings]]` and `#tags`. */
export function createCompletionSources({ vault, index, path }: CompletionDeps): CompletionSource[] {
  const links: CompletionSource = (ctx) => {
    const m = ctx.matchBefore(LINK_PREFIX);
    if (!m) return null;
    return { from: m.from + 2, options: noteCompletions(vault, index), validFor: LINK_TEXT };
  };

  const headings: CompletionSource = (ctx) => {
    const m = ctx.matchBefore(HEADING_PREFIX);
    if (!m) return null;
    const target = m.text.slice(2, m.text.indexOf('#')).trim();
    const note = target ? vault.resolveLink(target, path) : path;
    if (!note) return null;
    // Headings are inserted in their link-safe form (`A | B` -> `A B`); the popup still shows the original text.
    const options: Completion[] = (index.getMetadata(note)?.headings ?? []).map((h) => {
      const label = headingLinkText(h.text);
      return { label, displayLabel: label === h.text ? undefined : h.text, detail: `H${h.level}`, type: 'heading', apply: applyLinkText };
    });
    return { from: m.from + m.text.indexOf('#') + 1, options, validFor: LINK_TEXT };
  };

  const tags: CompletionSource = (ctx) => {
    const m = ctx.matchBefore(TAG_PREFIX);
    if (!m) return null;
    const options: Completion[] = index.getTags().map((t) => ({ label: t.name, detail: `${t.count}`, type: 'tag' }));
    return { from: m.from + 2, options, validFor: TAG_TEXT };
  };

  return [headings, links, tags];
}
