import { syntaxTree } from '@codemirror/language';
import { StateEffect, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { activeLines, collectPreviewSpecs, isRevealed, tagAt, wikilinkAt } from './previewSpecs';

export interface LivePreviewHandlers {
  /** Whether a wikilink target resolves to an existing note. */
  isResolved(target: string): boolean;
  openLink(target: string, heading: string | undefined, newTab: boolean): void;
  openTag(name: string): void;
}

/** Dispatch this effect to recompute decorations (e.g. after the vault changed and links may resolve differently). */
export const refreshPreview = StateEffect.define<null>();

const HIDE = Decoration.replace({});

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-task-checkbox';
    input.checked = this.checked;
    input.setAttribute('aria-label', 'Toggle task');
    // Keep the editor selection where it is; the click only edits the marker.
    input.addEventListener('mousedown', (e) => e.preventDefault());
    input.addEventListener('click', () => toggleTaskAt(view, view.posAtDOM(input)));
    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-hr';
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Flip the `[ ]` / `[x]` marker that starts at `pos`. Returns false when there is no marker there. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const m = /^\[( |x|X)\]/.exec(view.state.sliceDoc(pos, pos + 3));
  if (!m) return false;
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: m[1] === ' ' ? 'x' : ' ' } });
  return true;
}

function buildDecorations(view: EditorView, handlers: LivePreviewHandlers): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const marks: Range<Decoration>[] = [];
  const replaces: Range<Decoration>[] = [];

  for (const range of view.visibleRanges) {
    const from = state.doc.lineAt(range.from).from;
    const to = state.doc.lineAt(range.to).to;
    for (const spec of collectPreviewSpecs(state, from, to)) {
      const revealed = 'to' in spec && isRevealed(state, active, spec.from);
      switch (spec.kind) {
        case 'hide':
          if (!revealed && spec.from < spec.to) replaces.push(HIDE.range(spec.from, spec.to));
          break;
        case 'mark':
          if (spec.from < spec.to) marks.push(Decoration.mark({ class: spec.cls }).range(spec.from, spec.to));
          break;
        case 'wikilink': {
          const resolved = spec.target === '' || handlers.isResolved(spec.target);
          marks.push(Decoration.mark({ class: resolved ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-unresolved' }).range(spec.from, spec.to));
          break;
        }
        case 'tag':
          marks.push(Decoration.mark({ class: 'cm-hashtag' }).range(spec.from, spec.to));
          break;
        case 'task':
          if (!revealed) replaces.push(Decoration.replace({ widget: new CheckboxWidget(spec.checked) }).range(spec.from, spec.to));
          break;
        case 'hr':
          if (!revealed) replaces.push(Decoration.replace({ widget: new RuleWidget() }).range(spec.from, spec.to));
          break;
        case 'line':
          marks.push(Decoration.line({ class: spec.cls }).range(spec.from));
          break;
      }
    }
  }
  return Decoration.set([...marks, ...withoutOverlaps(replaces)], true);
}

/** Replace decorations may not overlap each other; keep the earliest of any overlapping pair. */
function withoutOverlaps(ranges: Range<Decoration>[]): Range<Decoration>[] {
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Range<Decoration>[] = [];
  let lastTo = -1;
  for (const r of ranges) {
    if (r.from < lastTo) continue;
    out.push(r);
    lastTo = r.to;
  }
  return out;
}

function handleMouseDown(event: MouseEvent, view: EditorView, handlers: LivePreviewHandlers): boolean {
  if (event.button !== 0) return false;
  const target = event.target instanceof Element ? event.target.closest('.cm-wikilink, .cm-hashtag') : null;
  if (!target) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return false;
  const mod = event.ctrlKey || event.metaKey;
  // On the line being edited a plain click just places the cursor.
  if (!mod && isRevealed(view.state, activeLines(view.state), pos)) return false;

  if (target.classList.contains('cm-wikilink')) {
    const link = wikilinkAt(view.state, pos);
    if (!link) return false;
    event.preventDefault();
    handlers.openLink(link.target, link.heading, event.shiftKey);
    return true;
  }
  const tag = tagAt(view.state, pos);
  if (!tag) return false;
  event.preventDefault();
  handlers.openTag(tag.name);
  return true;
}

/** Obsidian-style live preview: hides markup on inactive lines, renders links, tags, tasks and rules. */
export function livePreview(handlers: LivePreviewHandlers): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, handlers);
      }

      update(update: ViewUpdate): void {
        const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
        const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPreview)));
        if (update.docChanged || update.selectionSet || update.viewportChanged || treeChanged || refresh) {
          this.decorations = buildDecorations(update.view, handlers);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(event, view) {
          return handleMouseDown(event, view, handlers);
        },
      },
    },
  );
}
