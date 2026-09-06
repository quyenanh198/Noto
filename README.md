# Noto

A local-first markdown knowledge base in the spirit of Obsidian, running in the browser.

- Notes are plain markdown files. The vault lives in your browser (IndexedDB), or open a folder on disk with the File System Access API.
- `[[Wikilinks]]`, backlinks, tags, full-text search, quick switcher, command palette, graph view, outline.
- CodeMirror 6 editor with live-preview styling, plus a rendered reading view.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # vitest unit tests
npm run e2e        # playwright end-to-end tests (starts the dev server)
npm run build
```

## Architecture

```
src/
  app.ts                 singleton services: vault, metadata index, command registry; bootstrap()
  App.tsx                layout shell: ribbon, sidebars, tab bar, view header, status bar, modals
  core/
    types.ts             shared types (VaultFile, StorageAdapter, WikiLink, NoteMetadata, GraphData…)
    vault/Vault.ts       in-memory vault; every mutation goes through here and emits VaultEvents
    vault/storage.ts     MemoryAdapter (tests) and IndexedDBAdapter (browser persistence)
    vault/path.ts        path helpers (normalizePath, dirname, noteTitle, validateName…)
    markdown/links.ts    parsers: wikilinks, tags, headings, front matter -> NoteMetadata
    index/MetadataIndex.ts  links, backlinks, unresolved links, tags, graph; follows vault events
  state/store.ts         zustand workspace store (tabs, active file, view modes, sidebars, theme, modal)
  state/hooks.ts         useVaultRevision / useIndexRevision re-render hooks
  commands/registry.ts   CommandRegistry with hotkeys; commands/coreCommands.ts registers the built-ins
  features/<name>/       one folder per UI feature (explorer, editor, search, palette, graph, …)
```

Conventions:

- Read vault data through `app.vault` / `app.index`; subscribe to changes with `useVaultRevision()` / `useIndexRevision()`.
- Mutate only through `app.vault` methods (`create`, `modify`, `rename`, `delete`, folder ops). Never write to storage directly.
- Open notes through `useWorkspace().openFile(path)` or `openLink(target, fromPath)` from `commands/coreCommands.ts`.
- Register commands with `app.commands.register({...})` and return the unregister function from a `useEffect`.
- Feature CSS lives next to the component (`features/x/x.css`) and uses the tokens in `styles/theme.css`.

## Continuous integration and deployment

- `.github/workflows/ci.yml` runs on every push and pull request: typecheck, unit tests, production build, Playwright end-to-end tests. The built web app is attached to the run as the `noto-webapp` artifact.
- `.github/workflows/deploy.yml` builds the app on every push to `main` and publishes it to GitHub Pages at `https://quyenanh198.github.io/Noto/`. The workflow enables Pages on first run; if the deployment is rejected, set Settings → Pages → Source to "GitHub Actions" once.
- The app is served from a sub-path on Pages, so the build reads `VITE_BASE_PATH` (for example `/Noto/`); local builds default to `/`.
