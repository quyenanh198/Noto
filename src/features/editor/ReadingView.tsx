import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { app } from '../../app';
import { openLink } from '../../commands/coreCommands';
import { renderMarkdown, slugify, toggleTaskLine } from '../../core/markdown/render';
import { noteTitle } from '../../core/vault/path';
import { useVaultRevision } from '../../state/hooks';
import { useWorkspace, type NavigationTarget } from '../../state/store';
import { headingsMatch } from './headingLink';
import './reading.css';

export interface ReadingViewProps {
  path: string;
}

/** Rendered (preview) view of a note, with clickable links, tags and task checkboxes. */
export function ReadingView({ path }: ReadingViewProps) {
  const revision = useVaultRevision();
  const pending = useWorkspace((s) => s.pendingNavigation);
  const contentRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const content = app.vault.getFile(path)?.content ?? '';
    return renderMarkdown(content, {
      path,
      resolveLink: (target) => app.vault.resolveLink(target, path),
      getEmbedContent: (p) => app.vault.getFile(p)?.content,
    });
  }, [path, revision]);

  useEffect(() => {
    if (!pending || pending.path !== path) return;
    const nav = useWorkspace.getState().consumeNavigation();
    const root = contentRef.current;
    if (!nav || !root) return;
    findNavigationTarget(root, nav)?.scrollIntoView({ block: 'start' });
  }, [pending, path]);

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
      const ws = useWorkspace.getState();
      ws.setSearchQuery('tag:#' + (tag.dataset.tag ?? ''));
      ws.setLeftTab('search');
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
    }
  };

  return (
    <div className="markdown-reading-view" data-testid="reading-view" onClick={onClick}>
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

const isEmbedded = (el: Element) => el.closest('.markdown-embed') !== null;

/** Element to scroll to for a heading or line target; elements inside embeds are ignored. */
export function findNavigationTarget(root: HTMLElement, nav: NavigationTarget): Element | null {
  if (nav.heading !== undefined) {
    const want = nav.heading;
    const headings = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].filter((h) => !isEmbedded(h));
    // Matched by link text, so `[[Note#A B]]` finds `## A | B`.
    const byText = headings.find((h) => headingsMatch(h.dataset.heading ?? '', want));
    if (byText) return byText;
    const slug = slugify(nav.heading);
    return headings.find((h) => h.id === slug) ?? null;
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
