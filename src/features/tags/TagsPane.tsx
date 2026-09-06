import { useMemo, useState } from 'react';
import { app } from '../../app';
import { Icons } from '../../components/icons';
import { useIndexRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { buildTagTree, sortTagTree, type TagNode, type TagSort } from './tagTree';
import './tags.css';

function countNodes(nodes: TagNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

export function TagsPane() {
  const rev = useIndexRevision();
  const [sort, setSort] = useState<TagSort>('name');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const tags = useMemo(() => app.index.getTags(), [rev]);
  const tree = useMemo(() => sortTagTree(buildTagTree(tags, (tag) => app.index.getFilesWithTag(tag).length), sort), [tags, sort]);
  // The tree folds case variants and includes implicit parents, so count what is actually listed.
  const tagCount = useMemo(() => countNodes(tree), [tree]);

  const toggle = (tag: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const nextSort: TagSort = sort === 'name' ? 'count' : 'name';
  const sortLabel = nextSort === 'count' ? 'Sort by count' : 'Sort by name';

  return (
    <div className="tags-pane" data-testid="tags-pane">
      <div className="pane-header">
        <span className="tags-header-label">
          Tags
          <span className="pane-count">{tagCount}</span>
        </span>
        <button className={`clickable-icon tags-sort ${sort === 'count' ? 'is-active' : ''}`} title={sortLabel} aria-label={sortLabel} onClick={() => setSort(nextSort)}>
          <SortIcon />
        </button>
      </div>
      {tree.length === 0 && <div className="pane-empty">No tags yet.</div>}
      {tree.map((node) => (
        <TagItem key={node.tag} node={node} depth={0} collapsed={collapsed} onToggle={toggle} />
      ))}
    </div>
  );
}

interface TagItemProps {
  node: TagNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (tag: string) => void;
}

function TagItem({ node, depth, collapsed, onToggle }: TagItemProps) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.tag);
  const search = () => useWorkspace.getState().searchTag(node.tag);
  return (
    <>
      <div
        className="tree-item tag-item"
        data-testid="tag-item"
        data-tag={node.tag}
        role="button"
        tabIndex={0}
        aria-label={'#' + node.tag}
        style={{ paddingLeft: 4 + depth * 16 }}
        title={'#' + node.tag}
        onClick={search}
        onKeyDown={(e) => {
          // Enter on the nested chevron is the button's own activation, not the row's.
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
          e.preventDefault();
          search();
        }}
      >
        {hasChildren ? (
          <button
            className="pane-chevron"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.tag);
            }}
          >
            {isCollapsed ? <Icons.chevronRight /> : <Icons.chevronDown />}
          </button>
        ) : (
          <span className="pane-chevron is-spacer" />
        )}
        <span className="tag-item-name">{hasChildren ? node.name : '#' + node.name}</span>
        <span className="tag-item-count">{node.count}</span>
      </div>
      {hasChildren && !isCollapsed && node.children.map((child) => <TagItem key={child.tag} node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />)}
    </>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h10M4 18h5" />
    </svg>
  );
}
