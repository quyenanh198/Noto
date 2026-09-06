import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { app } from '../../app';
import { createNewNote } from '../../commands/coreCommands';
import { Icons } from '../../components/icons';
import { useVaultRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { ExplorerRow } from './ExplorerRow';
import {
  buildTree,
  canMoveTo,
  collectNodes,
  expandAncestors,
  flattenTree,
  moveDestination,
  navigate,
  rekeyExpanded,
  removeExpanded,
  renameTarget,
  uniqueFolderPath,
  type NavKey,
  type TreeNode,
} from './tree';
import './explorer.css';

const STORAGE_KEY = 'noto-explorer-expanded';
const NAV_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function loadExpanded(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Persists the expanded folders, keeping only those that still exist so renamed, moved or deleted ones do not linger. */
function saveExpanded(expanded: ReadonlySet<string>, folders: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders.filter((p) => expanded.has(p))));
  } catch {
    // Storage may be unavailable; expansion state is a convenience only.
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface MenuState {
  x: number;
  y: number;
  /** Null when the menu was opened on the empty area of the pane. */
  node: TreeNode | null;
}

export function FileExplorer() {
  const revision = useVaultRevision();
  const activeFile = useWorkspace((s) => s.activeFile);
  const tree = useMemo(() => buildTree(app.vault.getFiles().map((f) => f.path), app.vault.getFolders()), [revision]);
  const nodes = useMemo(() => collectNodes(tree), [tree]);
  const folderPaths = useMemo(() => [...nodes.values()].filter((n) => n.kind === 'folder').map((n) => n.path), [nodes]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(loadExpanded);
  const [focused, setFocused] = useState<string | null>(activeFile);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped when a file is opened from the tree while it owns the keyboard, so the tree takes focus back from the editor. */
  const [focusRequest, setFocusRequest] = useState(0);

  const treeRef = useRef<HTMLDivElement>(null);
  /** Row to scroll into view after the next render. */
  const revealRef = useRef<string | null>(null);
  const dragRef = useRef<TreeNode | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);
  const anyExpanded = folderPaths.some((p) => expanded.has(p));

  useEffect(() => saveExpanded(expanded, folderPaths), [expanded, folderPaths]);

  useEffect(() => {
    if (!activeFile) return;
    setFocused(activeFile);
    setExpanded((prev) => expandAncestors(prev, activeFile));
    revealRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    const path = revealRef.current;
    if (!path || !treeRef.current) return;
    const el = treeRef.current.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      revealRef.current = null;
    }
  });

  useEffect(() => {
    if (!focusRequest) return;
    // The editor focuses itself in its mount effect, which runs in the same effect pass as this one (the request is
    // batched with the file switch); take the focus back once the pass is over.
    const tree = treeRef.current;
    queueMicrotask(() => tree?.focus({ preventScroll: true }));
  }, [focusRequest]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3000);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // ----- actions -----

  const setFolderOpen = (path: string, open?: boolean) =>
    setExpanded((prev) => {
      const isOpen = prev.has(path);
      const want = open ?? !isOpen;
      if (want === isOpen) return prev;
      const next = new Set(prev);
      if (want) next.add(path);
      else next.delete(path);
      return next;
    });

  const reveal = (path: string) => {
    setFocused(path);
    setExpanded((prev) => expandAncestors(prev, path));
    revealRef.current = path;
  };

  const openNode = (node: TreeNode, newTab = false) => {
    if (node.kind === 'folder') {
      setFolderOpen(node.path);
      return;
    }
    // Opening from the tree keeps the keyboard here, like Obsidian, so arrows/F2/Delete keep working on the list.
    if (treeRef.current?.contains(document.activeElement)) setFocusRequest((n) => n + 1);
    useWorkspace.getState().openFile(node.path, { newTab });
  };

  const newNote = async (folder?: string) => {
    try {
      await createNewNote(folder);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const newFolder = async (parent: string) => {
    const path = uniqueFolderPath(parent, (p) => app.vault.folderExists(p));
    try {
      await app.vault.createFolder(path);
    } catch (e) {
      notify(errorMessage(e));
      return;
    }
    reveal(path);
    setRenaming(path);
  };

  const startRename = (node: TreeNode) => {
    setFocused(node.path);
    setRenaming(node.path);
  };

  const commitRename = async (node: TreeNode, name: string): Promise<string | null> => {
    const to = renameTarget(node, name);
    if (to === node.path) {
      setRenaming(null);
      return null;
    }
    try {
      if (node.kind === 'folder') {
        await app.vault.renameFolder(node.path, to);
        setExpanded((prev) => rekeyExpanded(prev, node.path, to));
      } else {
        await app.vault.rename(node.path, to);
      }
    } catch (e) {
      return errorMessage(e);
    }
    setRenaming(null);
    reveal(to);
    return null;
  };

  const cancelRename = (error?: string) => {
    setRenaming(null);
    if (error) notify(error);
  };

  const deleteNode = async (node: TreeNode) => {
    const question = node.kind === 'folder' ? `Delete folder "${node.path}" and everything inside it?` : `Delete "${node.path}"?`;
    if (!window.confirm(question)) return;
    try {
      if (node.kind === 'folder') {
        await app.vault.deleteFolder(node.path);
        setExpanded((prev) => removeExpanded(prev, node.path));
      } else {
        await app.vault.delete(node.path);
      }
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const copyLink = async (path: string) => {
    const text = `[[${app.vault.linkTextFor(path)}]]`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is not available.');
      await navigator.clipboard.writeText(text);
      notify(`Copied ${text}`);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const moveNode = async (node: TreeNode, targetFolder: string) => {
    const to = moveDestination(node.path, targetFolder);
    try {
      if (node.kind === 'folder') {
        await app.vault.renameFolder(node.path, to);
        setExpanded((prev) => rekeyExpanded(prev, node.path, to));
      } else {
        await app.vault.rename(node.path, to);
      }
      reveal(to);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const toggleAll = () => setExpanded(anyExpanded ? new Set() : new Set(folderPaths));

  // Commands read the latest handlers through a ref so they can be registered once.
  const handlers = useRef({ newFolder, toggleAll, reveal });
  handlers.current = { newFolder, toggleAll, reveal };

  useEffect(() => {
    const unregister = [
      app.commands.register({
        id: 'explorer:reveal-active-file',
        name: 'Reveal active file in file explorer',
        checkCallback: () => useWorkspace.getState().activeFile !== null,
        callback: () => {
          const ws = useWorkspace.getState();
          ws.setLeftTab('files');
          if (ws.activeFile) handlers.current.reveal(ws.activeFile);
        },
      }),
      app.commands.register({ id: 'explorer:new-folder', name: 'Create new folder', callback: () => void handlers.current.newFolder('') }),
      app.commands.register({ id: 'explorer:toggle-all', name: 'File explorer: collapse or expand all folders', callback: () => handlers.current.toggleAll() }),
    ];
    return () => unregister.forEach((u) => u());
  }, []);

  // ----- context menu -----

  const menuItems = (node: TreeNode | null): MenuItem[] => {
    if (!node) {
      return [
        { label: 'New note', onSelect: () => void newNote('') },
        { label: 'New folder', onSelect: () => void newFolder('') },
      ];
    }
    if (node.kind === 'folder') {
      return [
        { label: 'New note', onSelect: () => void newNote(node.path) },
        { label: 'New folder', onSelect: () => void newFolder(node.path) },
        { label: 'Rename', hint: 'F2', separatorBefore: true, onSelect: () => startRename(node) },
        { label: 'Delete', onSelect: () => void deleteNode(node) },
      ];
    }
    return [
      { label: 'Open in new tab', onSelect: () => openNode(node, true) },
      { label: 'Copy link', onSelect: () => void copyLink(node.path) },
      { label: 'Rename', hint: 'F2', separatorBefore: true, onSelect: () => startRename(node) },
      { label: 'Delete', onSelect: () => void deleteNode(node) },
    ];
  };

  const onRowContextMenu = (e: MouseEvent<HTMLDivElement>, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setFocused(node.path);
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const onTreeContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, node: null });
  };

  // ----- keyboard -----

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || menu) return;
    const node = focused ? nodes.get(focused) : undefined;
    if (NAV_KEYS.has(e.key)) {
      const result = navigate(rows, expanded, focused, e.key as NavKey);
      if (result.expand) setFolderOpen(result.expand, true);
      if (result.collapse) setFolderOpen(result.collapse, false);
      if (result.focus) {
        setFocused(result.focus);
        revealRef.current = result.focus;
      }
    } else if (e.key === 'Enter' && node) {
      openNode(node);
    } else if (e.key === 'F2' && node) {
      startRename(node);
    } else if (e.key === 'Delete' && node) {
      void deleteNode(node);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // ----- drag and drop -----

  /** Folder under the pointer: a folder row, `''` for the empty area, or null when not droppable. */
  const dropFolderAt = (e: DragEvent<HTMLDivElement>): string | null => {
    const row = (e.target as Element).closest<HTMLElement>('[data-testid="explorer-item"]');
    if (!row) return '';
    return row.dataset.kind === 'folder' ? (row.dataset.path ?? null) : null;
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>, node: TreeNode) => {
    dragRef.current = node;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.path);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const source = dragRef.current;
    if (!source) return;
    const target = dropFolderAt(e);
    if (target === null || !canMoveTo(source, target)) {
      setDropTarget(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!treeRef.current?.contains(e.relatedTarget as Node | null)) setDropTarget(null);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const source = dragRef.current;
    const target = dropFolderAt(e);
    dragRef.current = null;
    setDropTarget(null);
    if (!source || target === null || !canMoveTo(source, target)) return;
    e.preventDefault();
    void moveNode(source, target);
  };

  const onDragEnd = () => {
    dragRef.current = null;
    setDropTarget(null);
  };

  // ----- render -----

  return (
    <div className="file-explorer" data-testid="file-explorer">
      <div className="pane-header explorer-header">
        <div className="explorer-actions">
          <button className="clickable-icon" title="New note" aria-label="New note" data-testid="explorer-new-note" onClick={() => void newNote()}>
            <Icons.plus />
          </button>
          <button className="clickable-icon" title="New folder" aria-label="New folder" data-testid="explorer-new-folder" onClick={() => void newFolder('')}>
            <Icons.folderPlus />
          </button>
          <button
            className="clickable-icon"
            title={anyExpanded ? 'Collapse all' : 'Expand all'}
            aria-label={anyExpanded ? 'Collapse all' : 'Expand all'}
            data-testid="explorer-toggle-all"
            onClick={toggleAll}
          >
            <Icons.list />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="explorer-empty" data-testid="explorer-empty">
          <div>No notes yet</div>
          <button className="mod-cta" onClick={() => void newNote('')}>
            Create note
          </button>
        </div>
      ) : (
        <div
          ref={treeRef}
          className={`explorer-tree${dropTarget === '' ? ' is-drop-target' : ''}`}
          role="tree"
          aria-label="Files"
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          onContextMenu={onTreeContextMenu}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        >
          {rows.map((node) => (
            <ExplorerRow
              key={node.path}
              node={node}
              expanded={expanded.has(node.path)}
              active={node.path === activeFile}
              focused={node.path === focused}
              dropTarget={node.kind === 'folder' && node.path === dropTarget}
              renaming={node.path === renaming}
              onClick={(e, n) => {
                setFocused(n.path);
                openNode(n, e.ctrlKey || e.metaKey);
              }}
              onContextMenu={onRowContextMenu}
              onDragStart={onDragStart}
              onRenameCommit={commitRename}
              onRenameCancel={cancelRename}
            />
          ))}
        </div>
      )}

      {notice && (
        <div className="explorer-notice" role="status">
          {notice}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={closeMenu} />}
    </div>
  );
}
