import { useEffect } from 'react';
import { app, bootstrap } from './app';
import { registerCoreCommands } from './commands/coreCommands';
import { Icons } from './components/icons';
import { noteTitle } from './core/vault/path';
import { BacklinksPane } from './features/backlinks/BacklinksPane';
import { MarkdownEditor } from './features/editor/MarkdownEditor';
import { ReadingView } from './features/editor/ReadingView';
import { FileExplorer } from './features/explorer/FileExplorer';
import { GraphView } from './features/graph/GraphView';
import { OutlinePane } from './features/outline/OutlinePane';
import { CommandPalette } from './features/palette/CommandPalette';
import { QuickSwitcher } from './features/palette/QuickSwitcher';
import { SearchPane } from './features/search/SearchPane';
import { SettingsModal } from './features/settings/SettingsModal';
import { TagsPane } from './features/tags/TagsPane';
import { useIndexRevision, useVaultRevision } from './state/hooks';
import { useWorkspace, type LeftTab, type RightTab } from './state/store';
import './styles/theme.css';
import './styles/app.css';

let bootstrapped: Promise<void> | null = null;

export default function App() {
  const ready = useWorkspace((s) => s.ready);
  const theme = useWorkspace((s) => s.theme);
  const fontSize = useWorkspace((s) => s.fontSize);

  useEffect(() => {
    bootstrapped ??= bootstrap();
    return registerCoreCommands();
  }, []);

  useEffect(() => {
    document.body.className = `theme-${theme}`;
    document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
  }, [theme, fontSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      app.commands.handleKeydown(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="loading-screen">Loading vault…</div>;

  return (
    <div className="app" data-testid="app">
      <Ribbon />
      <LeftSidebar />
      <Workspace />
      <RightSidebar />
      <StatusBar />
      <CommandPalette />
      <QuickSwitcher />
      <SettingsModal />
    </div>
  );
}

function Ribbon() {
  const ws = useWorkspace();
  const toggleLeft = (tab: LeftTab) => {
    if (ws.leftSidebarOpen && ws.leftTab === tab) ws.toggleLeftSidebar();
    else ws.setLeftTab(tab);
  };
  return (
    <nav className="ribbon" aria-label="Ribbon">
      <button className={`clickable-icon ${ws.leftSidebarOpen && ws.leftTab === 'files' ? 'is-active' : ''}`} title="Files" aria-label="Files" onClick={() => toggleLeft('files')}>
        <Icons.files />
      </button>
      <button className={`clickable-icon ${ws.leftSidebarOpen && ws.leftTab === 'search' ? 'is-active' : ''}`} title="Search (Ctrl+Shift+F)" aria-label="Search" onClick={() => toggleLeft('search')}>
        <Icons.search />
      </button>
      <button className={`clickable-icon ${ws.leftSidebarOpen && ws.leftTab === 'tags' ? 'is-active' : ''}`} title="Tags" aria-label="Tags" onClick={() => toggleLeft('tags')}>
        <Icons.tag />
      </button>
      <button className={`clickable-icon ${ws.graphOpen ? 'is-active' : ''}`} title="Open graph view (Ctrl+G)" aria-label="Graph view" onClick={() => ws.setGraphOpen(!ws.graphOpen)}>
        <Icons.graph />
      </button>
      <button className="clickable-icon" title="Open today's daily note" aria-label="Daily note" onClick={() => void app.commands.execute('daily-note:open')}>
        <Icons.calendar />
      </button>
      <div className="spacer" />
      <button className="clickable-icon" title="Toggle theme" aria-label="Toggle theme" onClick={ws.toggleTheme}>
        {ws.theme === 'dark' ? <Icons.sun /> : <Icons.moon />}
      </button>
      <button className="clickable-icon" title="Settings" aria-label="Settings" onClick={() => ws.setModal('settings')}>
        <Icons.settings />
      </button>
    </nav>
  );
}

function LeftSidebar() {
  const open = useWorkspace((s) => s.leftSidebarOpen);
  const tab = useWorkspace((s) => s.leftTab);
  const setTab = useWorkspace((s) => s.setLeftTab);
  const tabs: Array<[LeftTab, string]> = [
    ['files', 'Files'],
    ['search', 'Search'],
    ['tags', 'Tags'],
  ];
  return (
    <aside className={`sidebar left ${open ? '' : 'is-collapsed'}`} data-testid="left-sidebar">
      <div className="sidebar-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`sidebar-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {tab === 'files' && <FileExplorer />}
        {tab === 'search' && <SearchPane />}
        {tab === 'tags' && <TagsPane />}
      </div>
    </aside>
  );
}

function RightSidebar() {
  const open = useWorkspace((s) => s.rightSidebarOpen);
  const tab = useWorkspace((s) => s.rightTab);
  const setTab = useWorkspace((s) => s.setRightTab);
  const activeFile = useWorkspace((s) => s.activeFile);
  const tabs: Array<[RightTab, string]> = [
    ['backlinks', 'Backlinks'],
    ['outline', 'Outline'],
    ['graph', 'Local graph'],
  ];
  return (
    <aside className={`sidebar right ${open ? '' : 'is-collapsed'}`} data-testid="right-sidebar">
      <div className="sidebar-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`sidebar-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {!activeFile && <div className="pane-empty">No file is open.</div>}
        {activeFile && tab === 'backlinks' && <BacklinksPane path={activeFile} />}
        {activeFile && tab === 'outline' && <OutlinePane path={activeFile} />}
        {activeFile && tab === 'graph' && <GraphView localTo={activeFile} />}
      </div>
    </aside>
  );
}

function Workspace() {
  const ws = useWorkspace();
  useVaultRevision();
  const active = ws.activeFile;
  const mode = ws.getViewMode(active);
  const file = active ? app.vault.getFile(active) : undefined;

  return (
    <main className="workspace">
      <TabBar />
      <div className="view-header">
        <div className="view-header-title" data-testid="view-title">
          {ws.graphOpen ? 'Graph view' : active ? active : ''}
        </div>
        <div className="view-header-actions">
          <button className="clickable-icon" title="Navigate back (Alt+Left)" aria-label="Navigate back" onClick={ws.goBack} disabled={ws.historyIndex <= 0}>
            <Icons.arrowLeft />
          </button>
          <button className="clickable-icon" title="Navigate forward (Alt+Right)" aria-label="Navigate forward" onClick={ws.goForward} disabled={ws.historyIndex >= ws.history.length - 1}>
            <Icons.arrowRight />
          </button>
          {active && !ws.graphOpen && (
            <button
              className="clickable-icon"
              title={mode === 'source' ? 'Switch to reading view (Ctrl+E)' : 'Switch to editing view (Ctrl+E)'}
              aria-label={mode === 'source' ? 'Reading view' : 'Editing view'}
              data-testid="toggle-view-mode"
              onClick={ws.toggleViewMode}
            >
              {mode === 'source' ? <Icons.book /> : <Icons.edit />}
            </button>
          )}
          <button className={`clickable-icon ${ws.rightSidebarOpen ? 'is-active' : ''}`} title="Toggle right sidebar" aria-label="Toggle right sidebar" onClick={ws.toggleRightSidebar}>
            <Icons.panelRight />
          </button>
        </div>
      </div>
      <div className="view-content" data-testid="view-content">
        {ws.graphOpen ? (
          <GraphView />
        ) : !active || !file ? (
          <EmptyState />
        ) : mode === 'source' ? (
          <MarkdownEditor key={active} path={active} />
        ) : (
          <ReadingView key={active} path={active} />
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-title">No file is open</div>
      <button onClick={() => void app.commands.execute('file:new')}>Create new note (Ctrl+N)</button>
      <button onClick={() => void app.commands.execute('switcher:open')}>Open quick switcher (Ctrl+O)</button>
      <button onClick={() => void app.commands.execute('graph:open')}>Open graph view (Ctrl+G)</button>
    </div>
  );
}

function TabBar() {
  const tabs = useWorkspace((s) => s.openTabs);
  const active = useWorkspace((s) => s.activeFile);
  const graphOpen = useWorkspace((s) => s.graphOpen);
  const setActiveTab = useWorkspace((s) => s.setActiveTab);
  const closeTab = useWorkspace((s) => s.closeTab);
  return (
    <div className="tab-bar" role="tablist" data-testid="tab-bar">
      {tabs.map((path) => (
        <div
          key={path}
          role="tab"
          aria-selected={!graphOpen && path === active}
          className={`tab ${!graphOpen && path === active ? 'is-active' : ''}`}
          title={path}
          onClick={() => setActiveTab(path)}
          onAuxClick={(e) => {
            if (e.button === 1) closeTab(path);
          }}
        >
          <span className="tab-title">{noteTitle(path)}</span>
          <button
            className="tab-close"
            aria-label={`Close ${noteTitle(path)}`}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(path);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="clickable-icon tab-new" title="New note (Ctrl+N)" aria-label="New note" onClick={() => void app.commands.execute('file:new')}>
        <Icons.plus />
      </button>
    </div>
  );
}

function StatusBar() {
  const active = useWorkspace((s) => s.activeFile);
  useIndexRevision();
  const meta = active ? app.index.getMetadata(active) : undefined;
  const backlinks = active ? app.index.getBacklinks(active).length : 0;
  return (
    <footer className="status-bar" data-testid="status-bar">
      {meta && <span>{backlinks} backlinks</span>}
      {meta && <span>{meta.wordCount} words</span>}
    </footer>
  );
}
