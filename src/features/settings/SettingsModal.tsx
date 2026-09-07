import { useEffect, useRef, useState, type ReactNode } from 'react';
import { app } from '../../app';
import { formatHotkey } from '../../commands/registry';
import { Icons } from '../../components/icons';
import { errorMessage } from '../../core/util';
import {
  BROWSER_VAULT_LABEL,
  SERVER_VAULT_LABEL,
  getPendingFolder,
  isFsaSupported,
  openFolderVault,
  reconnectFolder,
  switchToBrowserVault,
  switchToServerVault,
  isServerVaultAvailable,
  type PendingFolder,
} from '../../core/vault/vaultManager';
import { useCommands, useVaultRevision } from '../../state/hooks';
import { useWorkspace, type Theme, type ViewMode } from '../../state/store';
import { hotkeyReference } from './hotkeyReference';
import { ImportButton } from './ImportButton';
import { serializeVault } from './vaultTransfer';
import './settings.css';

type Section = 'editor' | 'appearance' | 'vault' | 'hotkeys' | 'about';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'vault', label: 'Vault' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'about', label: 'About' },
];

const READABLE_WIDTH = '760px';

/** Applies the "readable line length" setting to `--editor-max-width` app-wide. */
export function useReadableLineLength(): void {
  const enabled = useWorkspace((s) => s.readableLineLength);
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-max-width', enabled ? READABLE_WIDTH : '100%');
  }, [enabled]);
}

/** Settings dialog; mounted permanently so the readable-line-length effect stays active, renders only for modal === 'settings'. */
export function SettingsModal() {
  useReadableLineLength();
  const open = useWorkspace((s) => s.modal === 'settings');
  const setModal = useWorkspace((s) => s.setModal);
  const [section, setSection] = useState<Section>('editor');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;
  const close = () => setModal(null);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div
      className="modal-backdrop settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        data-testid="settings-modal"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-title">Options</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${s.id === section ? 'is-active' : ''}`}
              aria-current={s.id === section ? 'page' : undefined}
              data-testid={`settings-nav-${s.id}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div className="settings-header">
            <h2>{current.label}</h2>
            <button className="clickable-icon" title="Close" aria-label="Close settings" onClick={close}>
              <Icons.x />
            </button>
          </div>
          <div className="settings-body" data-testid={`settings-section-${section}`}>
            {section === 'editor' && <EditorSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'vault' && <VaultSection />}
            {section === 'hotkeys' && <HotkeysSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- building blocks -----

function SettingItem({ name, description, stacked, children }: { name: string; description?: ReactNode; stacked?: boolean; children?: ReactNode }) {
  return (
    <div className={`setting-item ${stacked ? 'mod-stacked' : ''}`}>
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        {description && <div className="setting-item-description">{description}</div>}
      </div>
      {children && <div className="setting-item-control">{children}</div>}
    </div>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={`checkbox-container ${checked ? 'is-enabled' : ''}`}>
      <input type="checkbox" role="switch" aria-label={label} aria-checked={checked} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, label, onChange }: { value: T; options: Array<{ value: T; label: string }>; label: string; onChange: (value: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'is-active' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ----- sections -----

function EditorSection() {
  const defaultViewMode = useWorkspace((s) => s.defaultViewMode);
  const setDefaultViewMode = useWorkspace((s) => s.setDefaultViewMode);
  const readable = useWorkspace((s) => s.readableLineLength);
  const setReadable = useWorkspace((s) => s.setReadableLineLength);
  const strictLineBreaks = useWorkspace((s) => s.strictLineBreaks);
  const setStrictLineBreaks = useWorkspace((s) => s.setStrictLineBreaks);
  const modes: Array<{ value: ViewMode; label: string }> = [
    { value: 'source', label: 'Source' },
    { value: 'preview', label: 'Reading' },
  ];
  return (
    <>
      <SettingItem name="Default view for new tabs" description={`${app.commands.withHotkey('Notes open in this view unless you switch it for a specific note', 'view:toggle-mode')}.`}>
        <Segmented value={defaultViewMode} options={modes} label="Default view mode" onChange={setDefaultViewMode} />
      </SettingItem>
      <SettingItem name="Readable line length" description="Limit the maximum line width so long paragraphs stay easy to read.">
        <Toggle checked={readable} label="Readable line length" onChange={setReadable} />
      </SettingItem>
      <SettingItem name="Strict line breaks" description="In reading view, ignore single newlines and start a new line only after a blank line, as in standard markdown.">
        <Toggle checked={strictLineBreaks} label="Strict line breaks" onChange={setStrictLineBreaks} />
      </SettingItem>
    </>
  );
}

function AppearanceSection() {
  const theme = useWorkspace((s) => s.theme);
  const setTheme = useWorkspace((s) => s.setTheme);
  const fontSize = useWorkspace((s) => s.fontSize);
  const setFontSize = useWorkspace((s) => s.setFontSize);
  const themes: Array<{ value: Theme; label: string }> = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];
  return (
    <>
      <SettingItem name="Base color scheme" description="Choose the color scheme of the interface.">
        <Segmented value={theme} options={themes} label="Theme" onChange={setTheme} />
      </SettingItem>
      <SettingItem name="Font size" description="Text size of the editor and reading view, in pixels.">
        <div className="settings-range">
          <input type="range" min={12} max={24} step={1} value={fontSize} aria-label="Font size" onChange={(e) => setFontSize(Number(e.target.value))} />
          <span className="settings-value" data-testid="settings-font-size">
            {fontSize}px
          </span>
        </div>
      </SettingItem>
    </>
  );
}

function VaultSection() {
  useVaultRevision();
  const vaultLabel = useWorkspace((s) => s.vaultLabel);
  const [pending, setPending] = useState<PendingFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const supported = isFsaSupported();
  const kind = app.vault.adapter.kind;
  const fileCount = app.vault.getFiles().length;
  const [hasServer, setHasServer] = useState(false);
  useEffect(() => {
    isServerVaultAvailable().then(setHasServer, () => setHasServer(false));
  }, []);
  const currentDescription =
    kind === 'server'
      ? `${fileCount} files, stored as markdown on the server (${SERVER_VAULT_LABEL}). Every device you sign in from sees the same notes.`
      : kind === 'fsa'
        ? `${fileCount} files, read from and written to a folder on your disk.`
        : `${fileCount} files, stored in this browser (IndexedDB). Clearing site data removes them.`;

  const refreshPending = () => {
    getPendingFolder().then(setPending, () => setPending(null));
  };
  useEffect(refreshPending, []);

  const run = async (label: string, action: () => Promise<boolean | void>) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await action();
      if (result !== false) setStatus({ text: `${label}: now using "${useWorkspace.getState().vaultLabel}".` });
    } catch (error) {
      setStatus({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
      refreshPending();
    }
  };

  const exportVault = () => {
    const json = serializeVault({ files: app.vault.getFiles(), folders: app.vault.getFolders() });
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vaultLabel === BROWSER_VAULT_LABEL ? 'noto-vault' : vaultLabel}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <SettingItem
        name="Current vault"
        description={currentDescription}
      >
        <div className="settings-vault-name" data-testid="settings-vault-label">
          {vaultLabel}
        </div>
      </SettingItem>
      <SettingItem
        name="Vault location"
        stacked
        description={
          hasServer
            ? 'Keep the notes on the server (any device sees them), open a folder on this computer, or keep them inside this browser.'
            : supported
              ? 'Open a folder on disk to work directly with its markdown files, or keep the notes inside the browser.'
              : 'Your browser does not support opening folders (Chrome/Edge do). Notes stay in browser storage.'
        }
      >
        <div className="settings-actions">
          {hasServer && (
            <button
              className="settings-button"
              data-testid="settings-use-server-vault"
              disabled={busy || kind === 'server'}
              onClick={() => void run('Switched', () => switchToServerVault(app))}
            >
              Use server storage
            </button>
          )}
          {supported && (
            <button className="settings-button" data-testid="settings-open-folder" disabled={busy} onClick={() => void run('Opened folder', () => openFolderVault(app))}>
              Open folder…
            </button>
          )}
          {pending && (
            <button className="settings-button" data-testid="settings-reconnect-folder" disabled={busy} onClick={() => void run('Reconnected', () => reconnectFolder(app, pending))}>
              Reconnect folder {pending.name}
            </button>
          )}
          <button className="settings-button" data-testid="settings-use-browser-vault" disabled={busy} onClick={() => void run('Switched', () => switchToBrowserVault(app))}>
            Use browser storage
          </button>
        </div>
        {status && (
          <div className={`settings-status ${status.error ? 'is-error' : ''}`} role="status" data-testid="settings-vault-status">
            {status.text}
          </div>
        )}
      </SettingItem>
      <SettingItem name="Import" stacked description="Add markdown files or a whole folder to the current vault. Existing paths are skipped.">
        <ImportButton />
      </SettingItem>
      <SettingItem name="Export" stacked description="Download every file and folder of the vault as a single JSON file.">
        <div className="settings-actions">
          <button className="settings-button" data-testid="settings-export" onClick={exportVault}>
            Export vault (JSON)
          </button>
        </div>
      </SettingItem>
    </>
  );
}

function HotkeysSection() {
  const commands = useCommands();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  // A reference table, not the palette: every command is listed whether or not it applies to the current view.
  const rows = hotkeyReference(commands).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.hotkey ?? '').toLowerCase().includes(q));
  return (
    <>
      <input className="text-input settings-filter" type="search" placeholder="Filter commands…" value={filter} aria-label="Filter commands" data-testid="settings-hotkey-filter" onChange={(e) => setFilter(e.target.value)} />
      <table className="hotkeys-table" data-testid="settings-hotkeys">
        <thead>
          <tr>
            <th>Command</th>
            <th>Hotkey</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} data-command={c.id}>
              <td>{c.name}</td>
              <td>{c.hotkey ? <kbd className="hotkey-key">{formatHotkey(c.hotkey)}</kbd> : <span className="hotkey-blank">Blank</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="hotkey-empty">
                No commands match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function AboutSection() {
  return (
    <div className="settings-about">
      <div className="settings-about-name">Noto</div>
      <p>A local-first markdown knowledge base in the spirit of Obsidian. Your notes are plain markdown files kept in this browser or in a folder you open on disk.</p>
      <div className="setting-item-name">Tips</div>
      <ul>
        <li>
          Link notes with <code>[[Wikilinks]]</code>; backlinks and the graph view follow automatically.
        </li>
        <li>
          Tag notes inline with <code>#tags</code> or in YAML front matter.
        </li>
        <li>
          {app.commands.withHotkey('Use the quick switcher', 'switcher:open')} to jump between notes and {app.commands.withHotkey('the command palette', 'palette:open')} for everything
          else.
        </li>
        <li>Open a folder from the Vault section to keep your notes on disk as regular files.</li>
      </ul>
    </div>
  );
}
