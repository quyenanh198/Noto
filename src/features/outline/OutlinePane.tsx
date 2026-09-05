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

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

export function OutlinePane({ path }: OutlinePaneProps) {
  const rev = useIndexRevision();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildOutlineTree(app.index.getMetadata(path)?.headings ?? []), [path, rev]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="outline-pane" data-testid="outline-pane">
      <div className="pane-header">
        <span>Outline</span>
        <span className="outline-count">{countNodes(tree)}</span>
      </div>
      {tree.length === 0 && <div className="pane-empty">No headings in this note.</div>}
      {tree.map((node) => (
        <OutlineItem key={`${node.level}:${node.text}`} node={node} depth={0} path={path} collapsed={collapsed} onToggle={toggle} />
      ))}
    </div>
  );
}

interface OutlineItemProps {
  node: OutlineNode;
  depth: number;
  path: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}

function OutlineItem({ node, depth, path, collapsed, onToggle }: OutlineItemProps) {
  const key = `${node.level}:${node.text}`;
  const isCollapsed = collapsed.has(key);
  const hasChildren = node.children.length > 0;
  const navigate = () => useWorkspace.getState().openFile(path, { heading: node.text });
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
          if (e.key === 'Enter') navigate();
        }}
      >
        {hasChildren ? (
          <button
            className="outline-chevron"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(key);
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
        node.children.map((child) => (
          <OutlineItem key={`${child.level}:${child.text}`} node={child} depth={depth + 1} path={path} collapsed={collapsed} onToggle={onToggle} />
        ))}
    </>
  );
}
