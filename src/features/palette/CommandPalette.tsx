import { useState } from 'react';
import { app } from '../../app';
import { formatHotkey } from '../../commands/registry';
import { useCommands } from '../../state/hooks';
import { useWorkspace } from '../../state/store';
import { closeModal, Highlighted, Modal } from './Modal';
import { commandRows, loadRecentCommands, pushRecentCommand, type CommandRow } from './commandItems';

const HINT = '↑↓ to navigate · ↵ to use · esc to dismiss';

export function CommandPalette() {
  const open = useWorkspace((s) => s.modal === 'commands');
  return open ? <CommandDialog /> : null;
}

function CommandDialog() {
  const [query, setQuery] = useState('');
  const [recent] = useState(loadRecentCommands);
  const commands = useCommands();
  const rows = commandRows(query, commands.list(), recent);

  const dividerBefore = (row: CommandRow, i: number): string | null => {
    if (row.recent && i === 0) return 'Recently used';
    if (!row.recent && i > 0 && rows[i - 1].recent) return 'Other commands';
    return null;
  };

  const run = (row: CommandRow) => {
    const id = row.command.id;
    pushRecentCommand(id);
    closeModal();
    // Execute once the palette has closed so commands that open another modal work.
    queueMicrotask(() => void app.commands.execute(id));
  };

  return (
    <Modal
      label="Command palette"
      testId="command-palette"
      inputTestId="command-palette-input"
      itemTestId="command-palette-item"
      placeholder="Select a command…"
      query={query}
      onQueryChange={setQuery}
      items={rows}
      itemKey={(row) => row.command.id}
      itemAttrs={(row) => ({ 'data-command-id': row.command.id })}
      dividerBefore={dividerBefore}
      renderItem={(row) => <CommandRowView row={row} />}
      onSelect={run}
      emptyText="No matching commands."
      hint={HINT}
    />
  );
}

function CommandRowView({ row }: { row: CommandRow }) {
  const { command, indices } = row;
  return (
    <>
      <div className="palette-item-main">
        <div className="palette-item-title">
          <Highlighted text={command.name} indices={indices} />
        </div>
      </div>
      {command.hotkey && <span className="hotkey">{formatHotkey(command.hotkey)}</span>}
    </>
  );
}
