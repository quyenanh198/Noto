import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  /** Pending scroll target for the editor after navigation. Consumed by the editor. */
  pendingNavigation: NavigationTarget | null;
  history: string[];
  historyIndex: number;
  fontSize: number;
  /** Set true once the vault has loaded. */
  ready: boolean;

  openFile: (path: string, options?: { heading?: string; line?: number; newTab?: boolean }) => void;
  closeTab: (path: string) => void;
  closeOtherTabs: (path: string) => void;
  setActiveTab: (path: string) => void;
  /** Called by the vault layer when a file is renamed so tabs follow it. */
  fileRenamed: (oldPath: string, newPath: string) => void;
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
  consumeNavigation: () => NavigationTarget | null;
  goBack: () => void;
  goForward: () => void;
  setFontSize: (px: number) => void;
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
      pendingNavigation: null,
      history: [],
      historyIndex: -1,
      fontSize: 16,
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

      fileDeleted: (path) => {
        get().closeTab(path);
        set((s) => {
          const viewModes = { ...s.viewModes };
          delete viewModes[path];
          return { viewModes };
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
        if (!s.activeFile) return;
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
      }),
    },
  ),
);
