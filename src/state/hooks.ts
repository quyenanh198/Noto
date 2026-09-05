import { useEffect, useState } from 'react';
import { app } from '../app';

/** Re-render when the vault changes. Returns the vault revision. */
export function useVaultRevision(): number {
  const [rev, setRev] = useState(app.vault.revision);
  useEffect(() => app.vault.on(() => setRev(app.vault.revision)), []);
  return rev;
}

/** Re-render when the metadata index changes. Returns the index revision. */
export function useIndexRevision(): number {
  const [rev, setRev] = useState(app.index.revision);
  useEffect(() => app.index.on(() => setRev(app.index.revision)), []);
  return rev;
}

/** Re-render when commands are registered or unregistered. */
export function useCommands() {
  const [, setTick] = useState(0);
  useEffect(() => app.commands.on(() => setTick((t) => t + 1)), []);
  return app.commands;
}
