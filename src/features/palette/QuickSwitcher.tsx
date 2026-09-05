import { useMemo, useState } from 'react';
import { app } from '../../app';
import { openLink } from '../../commands/coreCommands';
import { dirname } from '../../core/vault/path';
import { useIndexRevision, useVaultRevision } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { closeModal, Highlighted, Modal } from './Modal';
import { switcherRows, type SwitcherItem, type SwitcherRow } from './switcherItems';

const HINT = '↑↓ to navigate · ↵ to open · shift ↵ to open in new tab · esc to dismiss';

export function QuickSwitcher() {
  const open = useWorkspace((s) => s.modal === 'switcher');
  return open ? <SwitcherDialog /> : null;
}

function SwitcherDialog() {
  const [query, setQuery] = useState('');
  const vaultRev = useVaultRevision();
  const indexRev = useIndexRevision();
  const history = useWorkspace((s) => s.history);
  const rows = useMemo(
    () =>
      switcherRows(query, {
        notePaths: app.vault.getMarkdownFiles().map((f) => f.path),
        unresolvedTargets: app.index.getUnresolvedLinks().map((u) => u.target),
        history,
      }),
    // The revisions are listed so the list follows vault and index changes.
    [query, history, vaultRev, indexRev],
  );

  const select = (row: SwitcherRow, newTab: boolean) => {
    closeModal();
    void openItem(row.item, newTab);
  };

  return (
    <Modal
      label="Quick switcher"
      testId="quick-switcher"
      inputTestId="quick-switcher-input"
      itemTestId="quick-switcher-item"
      placeholder="Find or create a note…"
      query={query}
      onQueryChange={setQuery}
      items={rows}
      itemKey={rowKey}
      itemAttrs={(row) => ({ 'data-path': itemPath(row.item) })}
      itemClassName={(row) => `is-${row.item.kind}`}
      renderItem={(row) => <SwitcherRowView row={row} />}
      onSelect={select}
      emptyText="No notes found."
      hint={HINT}
    />
  );
}

async function openItem(item: SwitcherItem, newTab: boolean): Promise<void> {
  const ws = useWorkspace.getState();
  if (item.kind === 'note') {
    ws.openFile(item.path, { newTab });
  } else if (item.kind === 'unresolved') {
    await openLink(item.target, ws.activeFile, { newTab });
  } else {
    const file = await app.vault.createUnique(item.name);
    useWorkspace.getState().openFile(file.path, { newTab });
  }
}

function itemPath(item: SwitcherItem): string {
  return item.kind === 'unresolved' ? item.target : item.path;
}

function rowKey(row: SwitcherRow): string {
  return `${row.item.kind}:${itemPath(row.item)}`;
}

function SwitcherRowView({ row }: { row: SwitcherRow }) {
  const { item, indices, field } = row;
  if (item.kind === 'create') {
    return (
      <div className="palette-item-main">
        <div className="palette-item-title">
          <span className="palette-create-prefix" aria-hidden="true">
            +
          </span>
          Create &quot;{item.name}&quot;
        </div>
      </div>
    );
  }
  const showPath = item.kind === 'note' && dirname(item.path) !== '';
  return (
    <>
      <div className="palette-item-main">
        <div className="palette-item-title">
          <Highlighted text={item.title} indices={field === 0 ? indices : []} />
        </div>
        {showPath && (
          <div className="palette-item-path">
            <Highlighted text={item.path} indices={field === 1 ? indices : []} />
          </div>
        )}
      </div>
      {item.kind === 'unresolved' && <span className="palette-item-note">Not created yet</span>}
    </>
  );
}
