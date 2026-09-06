import { useMemo, useState } from 'react';
import { app } from '../../app';
import { Icons } from '../../components/icons';
import { useIndexRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { buildOutlineTree, type OutlineNode } from './outlineTree';
import './outline.css';

export interface OutlinePaneProps {
  path: string;
}

const NONE: ReadonlySet<string> = new Set();

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

export function OutlinePane({ path }: OutlinePaneProps) {
  const rev = useIndexRevision();
  // Collapse state belongs to one note: another note starts fully expanded.
  const [collapsedIn, setCollapsedIn] = useState<{ path: string; keys: ReadonlySet<string> }>({ path, keys: NONE });
  const collapsed = collapsedIn.path === path ? collapsedIn.keys : NONE;
  const tree = useMemo(() => buildOutlineTree(app.index.getMetadata(path)?.headings ?? []), [path, rev]);

  const toggle = (key: string) =>
    setCollapsedIn((prev) => {
      const next = new Set(prev.path === path ? prev.keys : NONE);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { path, keys: next };
    });

  return (
    <div className="outline-pane" data-testid="outline-pane">
      <div className="pane-header">
        <span>Outline</span>
        <span className="outline-count">{countNodes(tree)}</span>
      </div>
      {tree.length === 0 && <div className="pane-empty">No headings in this note.</div>}
      {tree.map((node) => (
        <OutlineItem key={node.key} node={node} depth={0} path={path} collapsed={collapsed} onToggle={toggle} />
      ))}
    </div>
  );
}

interface OutlineItemProps {
  node: OutlineNode;
  depth: number;
  path: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

function OutlineItem({ node, depth, path, collapsed, onToggle }: OutlineItemProps) {
  const isCollapsed = collapsed.has(node.key);
  const hasChildren = node.children.length > 0;
  // Navigate by position: headings with the same text must each reach their own line.
  const navigate = () => useWorkspace.getState().openFile(path, { line: node.line });
  return (
    <>
      <div
        className="tree-item outline-item"
        data-testid="outline-item"
        data-level={node.level}
        data-line={node.line}
        role="button"
        tabIndex={0}
        aria-label={node.display}
        style={{ paddingLeft: 4 + depth * 16 }}
        title={node.display}
        onClick={navigate}
        onKeyDown={(e) => {
          // Enter on the nested chevron is the button's own activation, not the row's.
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
          e.preventDefault();
          navigate();
        }}
      >
        {hasChildren ? (
          <button
            className="outline-chevron"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.key);
            }}
          >
            {isCollapsed ? <Icons.chevronRight /> : <Icons.chevronDown />}
          </button>
        ) : (
          <span className="outline-chevron outline-chevron-spacer" />
        )}
        <span className="outline-text">{node.display}</span>
      </div>
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => <OutlineItem key={child.key} node={child} depth={depth + 1} path={path} collapsed={collapsed} onToggle={onToggle} />)}
    </>
  );
}
