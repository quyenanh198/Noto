import { useState, type ChangeEvent } from 'react';
import { app } from '../../app';
import { importSummary, planImport } from './vaultTransfer';

/**
 * "Import markdown files…" and "Import folder…" pickers. Files are created in the current
 * vault; paths that already exist are skipped and the outcome is reported below the buttons.
 */
export function ImportButton() {
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const plan = planImport(files, (path) => app.vault.exists(path));
      let imported = 0;
      for (const { file, path } of plan.create) {
        await app.vault.create(path, await file.text());
        imported++;
      }
      setStatus({ text: importSummary(imported, plan.skipped) });
    } catch (error) {
      setStatus({ text: `Import failed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setBusy(false);
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void importFiles(files);
  };

  return (
    <div className="settings-import">
      <div className="settings-actions">
        <label className={`settings-button settings-file-button ${busy ? 'is-disabled' : ''}`}>
          Import markdown files…
          <input type="file" multiple accept=".md,.markdown,.txt" data-testid="settings-import" aria-label="Import markdown files" disabled={busy} onChange={onChange} />
        </label>
        <label className={`settings-button settings-file-button ${busy ? 'is-disabled' : ''}`}>
          Import folder…
          <input type="file" multiple data-testid="settings-import-folder" aria-label="Import folder" disabled={busy} onChange={onChange} {...{ webkitdirectory: '' }} />
        </label>
      </div>
      {status && (
        <div className={`settings-status ${status.error ? 'is-error' : ''}`} role="status" data-testid="settings-import-status">
          {status.text}
        </div>
      )}
    </div>
  );
}
