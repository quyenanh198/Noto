import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isWithin } from '../core/vault/path';

export type ViewMode = 'source' | 'preview';
export type LeftTab = 'files' | 'search' | 'tags';
export type RightTab = 'backlinks' | 'outline' | 'graph';
export type Theme = 'dark' | 'light';
export type Modal = null | 'commands' | 'switcher' | 'settings';

export interface NavigationTarget {
  path: string;
  /** Jump to this heading after opening. */
  heading?: string;
  /** Jump to this line (0-based) after opening. */
  line?: number;
}

export interface WorkspaceState {
  activeFile: string | null;
  openTabs: string[];
  /** Per-file view mode; files not listed use `defaultViewMode`. */
  viewModes: Record<string, ViewMode>;
  defaultViewMode: ViewMode;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftTab: LeftTab;
  rightTab: RightTab;
  graphOpen: boolean;
  theme: Theme;
  modal: Modal;
  searchQuery: string;
  /** Bumped by `focusSearch`; the search pane focuses its input whenever it changes. */
  searchFocusRequest: number;
  /** Pending scroll target for the editor after navigation. Consumed by the editor. */
  pendingNavigation: NavigationTarget | null;
  history: string[];
  historyIndex: number;
  fontSize: number;
  /** Cap the editor/reading width (`--editor-max-width`); when false, content spans the full pane. */
  readableLineLength: boolean;
  /** Human-readable name of the current vault ('Browser storage' or the folder name). */
  vaultLabel: string;
  /** Set true once the vault has loaded. */
  ready: boolean;

  openFile: (path: string, options?: { heading?: string; line?: number; newTab?: boolean }) => void;
  closeTab: (path: string) => void;
  /** Close every tab and clear navigation history (used when switching vaults). */
  closeAllTabs: () => void;
  closeOtherTabs: (path: string) => void;
  setActiveTab: (path: string) => void;
  /** Called by the vault layer when a file is renamed so tabs follow it. */
  fileRenamed: (oldPath: string, newPath: string) => void;
  /** Called by the vault layer when a folder is renamed or moved so the tabs inside it follow. */
  folderRenamed: (oldPath: string, newPath: string) => void;
  fileDeleted: (path: string) => void;
  getViewMode: (path: string | null) => ViewMode;
  setViewMode: (path: string, mode: ViewMode) => void;
  toggleViewMode: () => void;
  setDefaultViewMode: (mode: ViewMode) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: RightTab) => void;
  setGraphOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setModal: (modal: Modal) => void;
  setSearchQuery: (q: string) => void;
  /** Show the search pane and put the keyboard focus in its input, even when the pane is already showing. */
  focusSearch: () => void;
  consumeNavigation: () => NavigationTarget | null;
  goBack: () => void;
  goForward: () => void;
  setFontSize: (px: number) => void;
  setReadableLineLength: (enabled: boolean) => void;
  setVaultLabel: (label: string) => void;
  setReady: (ready: boolean) => void;
}

const MAX_HISTORY = 100;

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      activeFile: null,
      openTabs: [],
      viewModes: {},
      defaultViewMode: 'source',
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      leftTab: 'files',
      rightTab: 'backlinks',
      graphOpen: false,
      theme: 'dark',
      modal: null,
      searchQuery: '',
      searchFocusRequest: 0,
      pendingNavigation: null,
      history: [],
      historyIndex: -1,
      fontSize: 16,
      readableLineLength: true,
      vaultLabel: 'Browser storage',
      ready: false,

      openFile: (path, options = {}) =>
        set((s) => {
          let tabs = s.openTabs;
          if (!tabs.includes(path)) {
            // Replace the active tab unless asked for a new one or the active tab is missing.
            if (options.newTab || s.activeFile === null || !tabs.includes(s.activeFile)) tabs = [...tabs, path];
            else tabs = tabs.map((t) => (t === s.activeFile ? path : t));
          }
          let history = s.history;
          let historyIndex = s.historyIndex;
          if (history[historyIndex] !== path) {
            history = [...history.slice(0, historyIndex + 1), path].slice(-MAX_HISTORY);
            historyIndex = history.length - 1;
          }
          const nav = options.heading !== undefined || options.line !== undefined ? { path, heading: options.heading, line: options.line } : null;
          return { activeFile: path, openTabs: tabs, graphOpen: false, history, historyIndex, pendingNavigation: nav };
        }),

      closeTab: (path) =>
        set((s) => {
          const i = s.openTabs.indexOf(path);
          if (i === -1) return {};
          const tabs = s.openTabs.filter((t) => t !== path);
          let active = s.activeFile;
          if (active === path) active = tabs[Math.min(i, tabs.length - 1)] ?? null;
          return { openTabs: tabs, activeFile: active };
        }),

      closeAllTabs: () => set({ openTabs: [], activeFile: null, history: [], historyIndex: -1, viewModes: {}, graphOpen: false, pendingNavigation: null }),

      closeOtherTabs: (path) => set({ openTabs: [path], activeFile: path }),

      setActiveTab: (path) => set((s) => (s.openTabs.includes(path) ? { activeFile: path, graphOpen: false } : {})),

      fileRenamed: (oldPath, newPath) =>
        set((s) => {
          const viewModes = { ...s.viewModes };
          if (viewModes[oldPath]) {
            viewModes[newPath] = viewModes[oldPath];
            delete viewModes[oldPath];
          }
          return {
            openTabs: s.openTabs.map((t) => (t === oldPath ? newPath : t)),
            activeFile: s.activeFile === oldPath ? newPath : s.activeFile,
            history: s.history.map((h) => (h === oldPath ? newPath : h)),
            viewModes,
          };
        }),

      folderRenamed: (oldPath, newPath) =>
        set((s) => {
          const move = (p: string) => (isWithin(p, oldPath) ? newPath + p.slice(oldPath.length) : p);
          const viewModes: Record<string, ViewMode> = {};
          for (const [p, mode] of Object.entries(s.viewModes)) viewModes[move(p)] = mode;
          return {
            openTabs: s.openTabs.map(move),
            activeFile: s.activeFile === null ? null : move(s.activeFile),
            history: s.history.map(move),
            viewModes,
          };
        }),

      fileDeleted: (path) => {
        get().closeTab(path);
        set((s) => {
          const viewModes = { ...s.viewModes };
          delete viewModes[path];
          // Drop the file from history too (collapsing runs of the same note), so back/forward cannot bring it back.
          // Removing the current entry leaves the index just past the previous one, so Back still returns there.
          const history: string[] = [];
          let historyIndex = s.historyIndex;
          s.history.forEach((h, i) => {
            if (h === path || h === history[history.length - 1]) {
              if (i < s.historyIndex) historyIndex--;
              return;
            }
            history.push(h);
          });
          return { viewModes, history, historyIndex: Math.min(historyIndex, history.length) };
        });
      },

      getViewMode: (path) => {
        const s = get();
        if (!path) return s.defaultViewMode;
        return s.viewModes[path] ?? s.defaultViewMode;
      },

      setViewMode: (path, mode) => set((s) => ({ viewModes: { ...s.viewModes, [path]: mode } })),

      toggleViewMode: () => {
        const s = get();
        // With the graph showing there is no note view to toggle; flipping the hidden note's mode would only surprise later.
        if (!s.activeFile || s.graphOpen) return;
        const next: ViewMode = s.getViewMode(s.activeFile) === 'source' ? 'preview' : 'source';
        s.setViewMode(s.activeFile, next);
      },

      setDefaultViewMode: (mode) => set({ defaultViewMode: mode }),
      toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
      toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
      setLeftTab: (tab) => set({ leftTab: tab, leftSidebarOpen: true }),
      setRightTab: (tab) => set({ rightTab: tab, rightSidebarOpen: true }),
      setGraphOpen: (open) => set({ graphOpen: open }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setModal: (modal) => set({ modal }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      focusSearch: () => set((s) => ({ leftTab: 'search', leftSidebarOpen: true, searchFocusRequest: s.searchFocusRequest + 1 })),

      consumeNavigation: () => {
        const nav = get().pendingNavigation;
        if (nav) set({ pendingNavigation: null });
        return nav;
      },

      goBack: () =>
        set((s) => {
          if (s.historyIndex <= 0) return {};
          const i = s.historyIndex - 1;
          const path = s.history[i];
          const tabs = s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path];
          return { historyIndex: i, activeFile: path, openTabs: tabs, graphOpen: false };
        }),

      goForward: () =>
        set((s) => {
          if (s.historyIndex >= s.history.length - 1) return {};
          const i = s.historyIndex + 1;
          const path = s.history[i];
          const tabs = s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path];
          return { historyIndex: i, activeFile: path, openTabs: tabs, graphOpen: false };
        }),

      setFontSize: (fontSize) => set({ fontSize: Math.max(10, Math.min(32, fontSize)) }),
      setReadableLineLength: (readableLineLength) => set({ readableLineLength }),
      setVaultLabel: (vaultLabel) => set({ vaultLabel }),
      setReady: (ready) => set({ ready }),
    }),
    {
      name: 'noto-workspace',
      partialize: (s) => ({
        activeFile: s.activeFile,
        openTabs: s.openTabs,
        viewModes: s.viewModes,
        defaultViewMode: s.defaultViewMode,
        leftSidebarOpen: s.leftSidebarOpen,
        rightSidebarOpen: s.rightSidebarOpen,
        leftTab: s.leftTab,
        rightTab: s.rightTab,
        theme: s.theme,
        fontSize: s.fontSize,
        readableLineLength: s.readableLineLength,
      }),
    },
  ),
);
