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
npm run e2e        # playwright end-to-end tests against the production build (see below)
npm run build
```

`npm run e2e` does not use the dev server: `playwright.config.ts` runs `npm run build` (`tsc -b && vite build`) and serves the bundle with `vite preview --port 5173 --strictPort`, so the tests exercise the same module graph as production. It refuses to reuse a running server (`reuseExistingServer: false`) and fails at once if anything is already listening on port 5173, so stop `npm run dev` before running it.

## Architecture

```
src/
  app.ts                 singleton services: vault, metadata index, command registry; bootstrap()
  App.tsx                layout shell: ribbon, sidebars, tab bar, view header, status bar, modals
  core/
    types.ts             shared types (VaultFile, StorageAdapter, WikiLink, NoteMetadata, GraphData…)
    vault/Vault.ts       in-memory vault; every mutation goes through here and emits VaultEvents
    vault/storage.ts     MemoryAdapter (tests) and IndexedDBAdapter (browser persistence); the folder adapter is in fsa.ts
    vault/fsa.ts         FileSystemAccessAdapter: a folder on disk through the File System Access API
    vault/vaultManager.ts  remembers the chosen vault (IndexedDB key-value store); switches between browser and folder vaults
    vault/linkRewrite.ts  plans and applies [[link]] rewrites when a note or folder is renamed or moved
    vault/sampleVault.ts  the notes bootstrap() seeds into a fresh browser vault
    vault/path.ts        path helpers (normalizePath, dirname, noteTitle, validateName…)
    markdown/links.ts    parsers: wikilinks, tags, headings, front matter -> NoteMetadata
    markdown/render.ts   reading-view renderer: markdown-it + DOMPurify, wikilinks, ![[embeds]], tasks, properties
    index/MetadataIndex.ts  links, backlinks, unresolved links, tags, graph; follows vault events
    search/search.ts     full-text search and its query language ("phrase", -not, tag:, path:, file:, /regex/)
    search/fuzzy.ts      fuzzy matching and match highlighting for the quick switcher and command palette
  state/store.ts         zustand workspace store (tabs, active file, view modes, sidebars, theme, modal)
  state/hooks.ts         useVaultRevision / useIndexRevision re-render hooks
  commands/registry.ts   CommandRegistry with hotkeys; commands/coreCommands.ts registers the built-ins
  features/<name>/       one folder per UI feature (explorer, editor, search, palette, graph, …)
  features/editor/draftJournal.ts  localStorage copy of the note being typed; bootstrap() replays it after a reload or crash
```

Conventions:

- Read vault data through `app.vault` / `app.index`; subscribe to changes with `useVaultRevision()` / `useIndexRevision()`.
- Mutate only through `app.vault` methods (`create`, `modify`, `rename`, `delete`, folder ops). Never write to storage directly.
- `rename` and `renameFolder` also rewrite `[[links]]` that pointed at the moved notes in every other note (via `vault/linkRewrite.ts`), so one rename can emit `modify` events for other files as well as the `rename` / `folder-rename` event.
- Open notes through `useWorkspace().openFile(path)` or `openLink(target, fromPath)` from `commands/coreCommands.ts`.
- Register commands with `app.commands.register({...})` and return the unregister function from a `useEffect`.
- Feature CSS lives next to the component (`features/x/x.css`) and uses the tokens in `styles/theme.css`.

## Continuous integration and deployment

- `.github/workflows/ci.yml` runs on every push and pull request: typecheck, unit tests, production build, Playwright end-to-end tests. The built web app is attached to the run as the `noto-webapp` artifact.
- `.github/workflows/deploy.yml` builds the app on every push to `main` and publishes it to GitHub Pages at `https://quyenanh198.github.io/Noto/`. The workflow enables Pages on first run; if the deployment is rejected, set Settings → Pages → Source to "GitHub Actions" once.
- The app is served from a sub-path on Pages, so the build reads `VITE_BASE_PATH` (for example `/Noto/`); local builds default to `/`.
