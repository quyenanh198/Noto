import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from 'react';
import { Icons } from '../../components/icons';
import { validateName } from '../../core/vault/path';
import { renamePrefill, type TreeNode } from './tree';

interface RowProps {
  node: TreeNode;
  expanded: boolean;
  active: boolean;
  focused: boolean;
  dropTarget: boolean;
  renaming: boolean;
  onClick: (e: MouseEvent<HTMLDivElement>, node: TreeNode) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>, node: TreeNode) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, node: TreeNode) => void;
  /** Resolves to null on success or an error message to show under the input. */
  onRenameCommit: (node: TreeNode, name: string) => Promise<string | null>;
  onRenameCancel: (error?: string) => void;
}

export function ExplorerRow({ node, expanded, active, focused, dropTarget, renaming, onClick, onContextMenu, onDragStart, onRenameCommit, onRenameCancel }: RowProps) {
  const folder = node.kind === 'folder';
  const classes = ['tree-item', 'explorer-row', folder ? 'is-folder' : 'is-file'];
  if (active) classes.push('is-active');
  if (focused) classes.push('is-focused');
  if (dropTarget) classes.push('is-drop-target');
  if (renaming) classes.push('is-renaming');

  return (
    <div
      role="treeitem"
      className={classes.join(' ')}
      data-testid="explorer-item"
      data-path={node.path}
      data-kind={node.kind}
      aria-level={node.depth + 1}
      aria-expanded={folder ? expanded : undefined}
      aria-selected={focused}
      title={node.path}
      style={{ '--depth': node.depth } as CSSProperties}
      draggable={!renaming}
      onClick={(e) => onClick(e, node)}
      onContextMenu={(e) => onContextMenu(e, node)}
      onDragStart={(e) => onDragStart(e, node)}
    >
      <span className="explorer-chevron" aria-hidden="true">
        {folder && (expanded ? <Icons.chevronDown /> : <Icons.chevronRight />)}
      </span>
      {renaming ? (
        <RenameInput initial={renamePrefill(node)} onCommit={(name) => onRenameCommit(node, name)} onCancel={onRenameCancel} />
      ) : (
        <span className={`explorer-name${!folder && !node.markdown ? ' is-muted' : ''}`}>{node.name}</span>
      )}
    </div>
  );
}

interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => Promise<string | null>;
  onCancel: (error?: string) => void;
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const cancel = (message?: string) => {
    if (done.current) return;
    done.current = true;
    onCancel(message);
  };

  /** Enter keeps the input open and shows problems inline; blur gives up on invalid or failed names. */
  const submit = async (viaBlur: boolean) => {
    if (done.current) return;
    const name = value.trim();
    const invalid = validateName(name);
    if (invalid) {
      if (viaBlur) cancel(invalid);
      else setError(invalid);
      return;
    }
    if (name === initial.trim()) {
      cancel();
      return;
    }
    done.current = true;
    const failure = await onCommit(name);
    if (failure === null) return;
    if (viaBlur) {
      onCancel(failure);
      return;
    }
    done.current = false;
    setError(failure);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <div className="rename-box" onClick={stop} onDoubleClick={stop} onKeyDown={stop} onContextMenu={stop}>
      <input
        ref={inputRef}
        className="rename-input"
        data-testid="explorer-rename-input"
        aria-label="New name"
        aria-invalid={error !== null}
        spellCheck={false}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => void submit(true)}
      />
      {error && (
        <div className="rename-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
