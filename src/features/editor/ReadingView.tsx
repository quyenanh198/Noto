import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react';
import { app } from '../../app';
import { openLink } from '../../commands/coreCommands';
import { renderMarkdown, slugify, toggleTaskLine } from '../../core/markdown/render';
import { isWithin, noteTitle } from '../../core/vault/path';
import { useVaultRevision } from '../../state/hooks';
import { useWorkspace, type NavigationTarget } from '../../state/store';
import { headingsMatch } from './headingLink';
import { rememberLine, takeLine } from './viewMemory';
import './reading.css';

export interface ReadingViewProps {
  path: string;
}

/** Rendered (preview) view of a note, with clickable links, tags and task checkboxes. */
export function ReadingView({ path }: ReadingViewProps) {
  const revision = useVaultRevision();
  const pending = useWorkspace((s) => s.pendingNavigation);
  const strictLineBreaks = useWorkspace((s) => s.strictLineBreaks);
  const contentRef = useRef<HTMLDivElement>(null);
  /** The note's current path; follows renames of the note and of the folders above it, like the editor's. */
  const pathRef = useRef(path);

  const html = useMemo(() => {
    const content = app.vault.getFile(path)?.content ?? '';
    return renderMarkdown(content, {
      path,
      resolveLink: (target) => app.vault.resolveLink(target, path),
      getEmbedContent: (p) => app.vault.getFile(p)?.content,
      strictLineBreaks,
    });
  }, [path, revision, strictLineBreaks]);

  useEffect(() => {
    if (!pending || pending.path !== path) return;
    const nav = useWorkspace.getState().consumeNavigation();
    const root = contentRef.current;
    if (!nav || !root) return;
    findNavigationTarget(root, nav)?.scrollIntoView({ block: 'start' });
  }, [pending, path]);

  // Start where the editor (or this view, before a tab switch) was, unless a navigation target is pending;
  // on the way out record the top line for the next view. Layout timing: the DOM must still be measurable.
  useLayoutEffect(() => {
    const root = contentRef.current;
    pathRef.current = path;
    // A rename swaps this view for one under the new path, which is where that view looks for the line.
    const offVault = app.vault.on((event) => {
      const current = pathRef.current;
      if (event.type === 'rename' && event.oldPath === current) pathRef.current = event.newPath;
      if (event.type === 'folder-rename' && isWithin(current, event.oldPath)) pathRef.current = event.newPath + current.slice(event.oldPath.length);
    });
    const line = takeLine(path);
    if (root && line && useWorkspace.getState().pendingNavigation?.path !== path) {
      findNavigationTarget(root, { path, line: line.line })?.scrollIntoView({ block: 'start' });
    }
    return () => {
      offVault();
      const current = pathRef.current;
      if (root && useWorkspace.getState().openTabs.includes(current)) rememberLine(current, topVisibleLine(root), 'reading');
    };
  }, [path]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const newTab = e.metaKey || e.ctrlKey;

    const link = target.closest<HTMLElement>('a.internal-link');
    if (link) {
      e.preventDefault();
      void openLink(link.dataset.href || path, path, { heading: link.dataset.heading, newTab });
      return;
    }
    const tag = target.closest<HTMLElement>('a.tag');
    if (tag) {
      e.preventDefault();
      useWorkspace.getState().searchTag(tag.dataset.tag ?? '');
      return;
    }
    const checkbox = target.closest<HTMLInputElement>('input.task-list-item-checkbox');
    if (checkbox) {
      toggleTask(checkbox, path);
      return;
    }
    const embedTitle = target.closest<HTMLElement>('.markdown-embed-title');
    const embed = embedTitle?.closest<HTMLElement>('.markdown-embed');
    if (embed) {
      void openLink(embed.dataset.href || path, path, { heading: embed.dataset.heading, newTab });
      return;
    }
    // Any other anchor (e.g. a link markdown-it rejected) must not navigate the browser away from the app.
    if (target.closest('a') && !target.closest('a.external-link')) e.preventDefault();
  };

  /** Middle-click opens internal links in a new tab of the app; the browser would open `href="#"` in a new window. */
  const onAuxClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    const target = e.target as HTMLElement;
    const anchor = target.closest<HTMLElement>('a');
    if (anchor?.classList.contains('external-link')) return;
    const embed = target.closest<HTMLElement>('.markdown-embed-title')?.closest<HTMLElement>('.markdown-embed');
    if (!anchor && !embed) return;
    e.preventDefault();
    const link = anchor?.classList.contains('internal-link') ? anchor : embed;
    if (link) void openLink(link.dataset.href || path, path, { heading: link.dataset.heading, newTab: true });
  };

  return (
    <div className="markdown-reading-view" data-testid="reading-view" onClick={onClick} onAuxClick={onAuxClick}>
      <div className="markdown-preview">
        <h1 className="inline-title" data-testid="inline-title">
          {noteTitle(path)}
        </h1>
        <div className="markdown-preview-content" ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

/** Flip the task on the checkbox's source line, in the embedded note when the checkbox sits inside an embed. */
function toggleTask(checkbox: HTMLInputElement, hostPath: string): void {
  const line = Number(checkbox.dataset.line);
  if (!Number.isInteger(line)) return;
  const embed = checkbox.closest<HTMLElement>('.markdown-embed');
  const filePath = embed ? app.vault.resolveLink(embed.dataset.href ?? '', hostPath) : hostPath;
  const file = filePath !== undefined ? app.vault.getFile(filePath) : undefined;
  if (!file) return;
  void app.vault.modify(file.path, toggleTaskLine(file.content, line));
}

/** Inside an embedded note. The embed block itself belongs to the host note (it carries the source line). */
const isEmbedded = (el: Element) => el.parentElement?.closest('.markdown-embed') != null;

/** Source line of the last block starting at or above the scroll container's top edge (0 when scrolled to the top). */
function topVisibleLine(root: HTMLElement): number {
  const scroller = root.closest('.markdown-reading-view') ?? root;
  const edge = scroller.getBoundingClientRect().top + 1;
  let best = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = Number(el.dataset.line);
    if (line > best && !isEmbedded(el) && el.getBoundingClientRect().top <= edge) best = line;
  }
  return best;
}

/** Element to scroll to for a heading or line target; elements inside embeds are ignored. */
export function findNavigationTarget(root: HTMLElement, nav: NavigationTarget): Element | null {
  if (nav.heading !== undefined) {
    const want = nav.heading;
    const headings = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].filter((h) => !isEmbedded(h));
    // Matched by link text, so `[[Note#A B]]` finds `## A | B`.
    const byText = headings.find((h) => headingsMatch(h.dataset.heading ?? '', want));
    if (byText) return byText;
    const slug = slugify(nav.heading);
    // The sanitizer drops ids that clash with document properties (`title`, `links`, ...), so also slugify the heading text.
    return headings.find((h) => h.id === slug || slugify(h.dataset.heading ?? '') === slug) ?? null;
  }
  if (nav.line !== undefined) {
    let best: HTMLElement | null = null;
    let bestLine = -1;
    for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
      const line = Number(el.dataset.line);
      if (line <= nav.line && line > bestLine && !isEmbedded(el)) {
        best = el;
        bestLine = line;
      }
    }
    return best;
  }
  return null;
}
