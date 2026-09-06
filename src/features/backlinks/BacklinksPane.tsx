import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { app } from '../../app';
import { Icons } from '../../components/icons';
import type { Backlink } from '../../core/index/MetadataIndex';
import { dirname, noteTitle } from '../../core/vault/path';
import { useIndexRevision, useVaultRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { findUnlinkedMentions, lineContaining, linkSnippets, wikilinkFor, type Snippet, type UnlinkedMention } from './mentions';
import './backlinks.css';

export interface BacklinksPaneProps {
  path: string;
}

type Activation = MouseEvent | KeyboardEvent;

function isNewTab(e: Activation): boolean {
  return e.ctrlKey || e.metaKey;
}

/**
 * Runs `fn` on click, and on Enter for keyboard users. Enter on a nested button is that button's own
 * activation; the key is swallowed so it cannot land in the editor that receives focus afterwards.
 */
function activate(fn: (e: Activation) => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
      e.preventDefault();
      fn(e);
    },
  };
}

function open(path: string, e: Activation, line?: number): void {
  useWorkspace.getState().openFile(path, { line, newTab: isNewTab(e) });
}

function noteAliases(path: string): string[] {
  const raw = app.index.getMetadata(path)?.frontmatter.aliases;
  if (Array.isArray(raw)) return raw.map(String);
  return typeof raw === 'string' ? raw.split(',') : [];
}

export function BacklinksPane({ path }: BacklinksPaneProps) {
  const indexRev = useIndexRevision();
  const vaultRev = useVaultRevision();
  const [showUnlinked, setShowUnlinked] = useState(false);

  const backlinks = useMemo(() => app.index.getBacklinks(path), [path, indexRev]);
  const linkedCount = backlinks.reduce((n, b) => n + b.links.length, 0);
  const unlinked = useMemo(() => {
    // Only the note itself is skipped: a note that already links here can still mention it in plain text.
    return findUnlinkedMentions(noteTitle(path), app.vault.getMarkdownFiles(), new Set([path]), noteAliases(path));
  }, [path, vaultRev]);
  const unlinkedBySource = useMemo(() => {
    const groups = new Map<string, UnlinkedMention[]>();
    for (const m of unlinked) groups.set(m.path, [...(groups.get(m.path) ?? []), m]);
    return [...groups];
  }, [unlinked]);

  return (
    <div className="backlinks-pane" data-testid="backlinks-pane">
      <div className="pane-header">
        <span>Linked mentions</span>
        <span className="pane-count">{linkedCount}</span>
      </div>
      {backlinks.length === 0 && <div className="pane-empty">No backlinks found.</div>}
      {backlinks.map((b) => (
        <LinkedGroup key={b.source} backlink={b} />
      ))}

      <div className="pane-header backlinks-toggle" aria-expanded={showUnlinked} {...activate(() => setShowUnlinked((v) => !v))}>
        <span className="backlinks-toggle-label">
          <span className="pane-chevron">{showUnlinked ? <Icons.chevronDown /> : <Icons.chevronRight />}</span>
          Unlinked mentions
        </span>
        <span className="pane-count">{unlinked.length}</span>
      </div>
      {showUnlinked && unlinked.length === 0 && <div className="pane-empty">No unlinked mentions found.</div>}
      {showUnlinked && unlinkedBySource.map(([source, mentions]) => <UnlinkedGroup key={source} target={path} source={source} mentions={mentions} />)}
    </div>
  );
}

function GroupTitle({ source, count, collapsed, onToggle }: { source: string; count: number; collapsed: boolean; onToggle: () => void }) {
  const folder = dirname(source);
  return (
    <div className="tree-item backlink-group-title" aria-label={noteTitle(source)} {...activate((e) => open(source, e))}>
      <button
        className="pane-chevron"
        aria-label={collapsed ? 'Expand' : 'Collapse'}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {collapsed ? <Icons.chevronRight /> : <Icons.chevronDown />}
      </button>
      <span className="backlink-title">{noteTitle(source)}</span>
      {folder && <span className="backlink-folder">{folder}</span>}
      <span className="pane-count">{count}</span>
    </div>
  );
}

function LinkedGroup({ backlink }: { backlink: Backlink }) {
  const [collapsed, setCollapsed] = useState(false);
  const content = app.vault.getFile(backlink.source)?.content ?? '';
  const snippets = useMemo(() => linkSnippets(content, backlink.links), [content, backlink.links]);
  return (
    <div className="backlink-group">
      <GroupTitle source={backlink.source} count={backlink.links.length} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      {!collapsed &&
        snippets.map((s) => (
          <div key={s.line} className="backlink-item" data-testid="backlink-item" data-source={backlink.source} {...activate((e) => open(backlink.source, e, s.line))}>
            <SnippetText snippet={s} />
          </div>
        ))}
    </div>
  );
}

function UnlinkedGroup({ target, source, mentions }: { target: string; source: string; mentions: UnlinkedMention[] }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="backlink-group">
      <GroupTitle source={source} count={mentions.length} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      {!collapsed && mentions.map((m) => <UnlinkedItem key={m.start} target={target} mention={m} />)}
    </div>
  );
}

function UnlinkedItem({ target, mention }: { target: string; mention: UnlinkedMention }) {
  const content = app.vault.getFile(mention.path)?.content ?? '';
  const line = lineContaining(content, mention.start);
  const indent = line.text.length - line.text.trimStart().length;
  const snippet: Snippet = { line: mention.line, text: line.text.slice(indent), ranges: [[mention.start - line.start - indent, mention.end - line.start - indent]] };

  const link = async (e: MouseEvent) => {
    e.stopPropagation();
    const file = app.vault.getFile(mention.path);
    if (!file || file.content.slice(mention.start, mention.end) !== mention.text) return;
    const replacement = wikilinkFor(app.vault.linkTextFor(target), mention.text);
    await app.vault.modify(mention.path, file.content.slice(0, mention.start) + replacement + file.content.slice(mention.end));
  };

  return (
    <div className="backlink-item" data-testid="unlinked-mention" data-source={mention.path} {...activate((e) => open(mention.path, e, mention.line))}>
      <SnippetText snippet={snippet} />
      <button className="backlink-link-button" aria-label={`Link to ${noteTitle(target)}`} onClick={(e) => void link(e)}>
        Link
      </button>
    </div>
  );
}

function SnippetText({ snippet }: { snippet: Snippet }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  snippet.ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(snippet.text.slice(cursor, start));
    parts.push(
      <mark key={i} className="backlink-highlight">
        {snippet.text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < snippet.text.length) parts.push(snippet.text.slice(cursor));
  return <div className="backlink-snippet">{parts}</div>;
}
