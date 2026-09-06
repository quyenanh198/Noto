import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { app } from '../../app';
import { openLink } from '../../commands/coreCommands';
import { parseHeadings } from '../../core/markdown/links';
import { dirname, extname, isWithin, joinPath, noteTitle, validateName } from '../../core/vault/path';
import { type NavigationTarget, useWorkspace } from '../../state/store';
import { clearDraft, vaultDraftId, writeDraft } from './draftJournal';
import { EDITOR_COMMANDS, registerEditorCommands } from './editorCommands';
import { createEditorExtensions, mountExtensions } from './extensions';
import { headingsMatch } from './headingLink';
import { refreshPreview } from './livePreview';
import { SAVE_DELAY_MS, Saver } from './saver';
import { rememberEditor, rememberLine, takeEditor, takeLine } from './viewMemory';
import './editor.css';

export interface MarkdownEditorProps {
  path: string;
}

export function MarkdownEditor({ path }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saverRef = useRef<Saver | null>(null);
  const navRef = useRef<NavigationTarget | null>(null);
  /** The note's current path; follows renames of the note and of the folders above it. */
  const pathRef = useRef(path);
  /** Line the editor was asked to scroll to and may not have reached yet: CodeMirror scrolls in its next measure cycle. */
  const scrollTargetRef = useRef<number | null>(null);
  const [title, setTitle] = useState(() => noteTitle(path));
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = app.vault.getFile(path)?.content ?? '';
    // Follows renames so that a pending save lands in the right file.
    let currentPath = path;
    pathRef.current = path;
    // Content the saver could not write because the note was mid-rename; written once the new path is known.
    let orphaned: string | null = null;
    // Unsaved content is mirrored synchronously to localStorage: an IndexedDB or file write started while the page
    // unloads may never commit, and the mirror is replayed by `bootstrap()` on the next start.
    const journal = {
      write: (content: string) => writeDraft({ vault: vaultDraftId(app.vault.adapter), path: currentPath, content }),
      clear: clearDraft,
    };
    const saver = new Saver(
      initial,
      (content) => {
        if (app.vault.exists(currentPath)) return app.vault.modify(currentPath, content);
        orphaned = content;
        return undefined;
      },
      SAVE_DELAY_MS,
      journal,
    );
    saverRef.current = saver;

    const handlers = {
      completion: { vault: app.vault, index: app.index, path },
      preview: {
        isResolved: (target: string) => app.vault.resolveLink(target, currentPath) !== undefined,
        openLink: (target: string, heading?: string, newTab?: boolean) => {
          if (target) void openLink(target, currentPath, { heading, newTab });
          else useWorkspace.getState().openFile(currentPath, { heading, newTab });
        },
        openTag: (name: string) => {
          const ws = useWorkspace.getState();
          ws.setSearchQuery(`tag:#${name}`);
          ws.setLeftTab('search');
        },
      },
      onDocChanged: (doc: string) => saver.schedule(doc),
    };
    // Pick up where an earlier mount of this note left off (selection, undo history) unless the note changed meanwhile.
    const kept = takeEditor(path);
    const reuse = kept !== undefined && kept.state.doc.toString() === initial;
    const dynamic = reuse ? kept.dynamic : new Compartment();
    const view = new EditorView({
      parent: host,
      state: reuse ? kept.state : EditorState.create({ doc: initial, extensions: createEditorExtensions({ reservedHotkeys: reservedHotkeys(), ...handlers, dynamic }) }),
    });
    if (reuse) view.dispatch({ effects: dynamic.reconfigure(mountExtensions(handlers)) });
    else view.dispatch({ selection: { anchor: initial.trim() === '' ? view.state.doc.length : 0 } });
    viewRef.current = view;
    view.focus();
    const scroller = host.closest('.markdown-editor');
    const onScroll = () => {
      scrollTargetRef.current = null;
    };
    scroller?.addEventListener('scroll', onScroll);

    const offVault = app.vault.on((event) => {
      if (event.type === 'rename' && event.oldPath === currentPath) currentPath = event.newPath;
      if (event.type === 'folder-rename' && isWithin(currentPath, event.oldPath)) currentPath = event.newPath + currentPath.slice(event.oldPath.length);
      pathRef.current = currentPath;
      if (orphaned !== null && app.vault.exists(currentPath)) {
        const content = orphaned;
        orphaned = null;
        void app.vault.modify(currentPath, content).catch((err: unknown) => console.error(err));
      }
      if ((event.type === 'modify' && event.path === currentPath) || event.type === 'reload') {
        const content = app.vault.getFile(currentPath)?.content;
        // Our own saves come back with the content we just wrote; anything else is an external change.
        if (content === undefined || content === saver.lastSaved) return;
        saver.cancel();
        saver.lastSaved = content;
        if (content !== view.state.doc.toString()) replaceDoc(view, content);
        return;
      }
      view.dispatch({ effects: refreshPreview.of(null) });
    });
    // Flush when the window loses focus and when the page is about to go away: `beforeunload` runs on reload and
    // navigation, `pagehide` on tab close, and a hidden document is the last thing a backgrounded mobile tab sees.
    const flush = () => saver.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') saver.flush();
    };
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    // Leaving the editor (for the explorer, the title, a sidebar) saves right away, so a rename or move that
    // follows never races the debounced save.
    view.contentDOM.addEventListener('blur', flush);
    const unregister = registerEditorCommands(() => viewRef.current);

    // Jump to the heading/line requested for this note. The target is consumed from the store once, so it is
    // kept in a ref and replayed when the view is re-created (React StrictMode re-runs this effect in dev).
    // Otherwise start at the line the previous view of this note (reading view, or this editor) was showing.
    const line = takeLine(path);
    if (navRef.current) scrollTargetRef.current = navigateTo(view, path, navRef.current);
    else if (line && reuse) scrollTargetRef.current = scrollToLine(view, line.line);
    else if (line) scrollTargetRef.current = navigateTo(view, path, { path, line: line.line });
    const consumeNavigation = () => {
      const ws = useWorkspace.getState();
      if (ws.pendingNavigation?.path !== path) return;
      const nav = ws.consumeNavigation();
      if (!nav) return;
      navRef.current = nav;
      scrollTargetRef.current = navigateTo(view, path, nav);
    };
    consumeNavigation();
    const unsubscribe = useWorkspace.subscribe((state, prev) => {
      if (state.pendingNavigation !== prev.pendingNavigation) consumeNavigation();
    });

    return () => {
      saver.flush();
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      scroller?.removeEventListener('scroll', onScroll);
      scrollTargetRef.current = null;
      offVault();
      unregister();
      unsubscribe();
      // Keep the state for the next mount while the tab stays open (tab switch, reading view toggle).
      if (useWorkspace.getState().openTabs.includes(currentPath)) rememberEditor(currentPath, { state: view.state, dynamic });
      view.destroy();
      viewRef.current = null;
      saverRef.current = null;
    };
  }, [path]);

  // Record the top visible line before the DOM goes away; a passive cleanup runs too late to measure it.
  useLayoutEffect(
    () => () => {
      const view = viewRef.current;
      const scroller = hostRef.current?.closest('.markdown-editor');
      const current = pathRef.current;
      if (!view || !scroller || !useWorkspace.getState().openTabs.includes(current)) return;
      rememberLine(current, scrollTargetRef.current ?? topVisibleLine(view, scroller), 'editor');
    },
    [path],
  );

  const resetTitle = () => setTitle(noteTitle(path));

  const commitTitle = async (value: string) => {
    const current = noteTitle(path);
    const next = value.trim();
    if (next === current) {
      resetTitle();
      setTitleError(null);
      return;
    }
    const error = validateName(next);
    if (error) {
      resetTitle();
      setTitleError(error);
      return;
    }
    saverRef.current?.flush();
    try {
      await app.vault.rename(path, renamedNotePath(path, next));
    } catch (err) {
      resetTitle();
      setTitleError(err instanceof Error ? err.message : String(err));
    }
  };

  const onTitleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const unchanged = e.currentTarget.value.trim() === noteTitle(path);
      e.currentTarget.blur();
      if (unchanged) viewRef.current?.focus();
    } else if (e.key === 'Escape') {
      // Reset the field itself as well, so the blur that follows commits the old name rather than the typed one.
      e.currentTarget.value = noteTitle(path);
      resetTitle();
      e.currentTarget.blur();
    }
  };

  /** Clicking the empty area around the text puts the cursor at the end, like Obsidian. */
  const onWrapperMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.target !== sizerRef.current) return;
    const view = viewRef.current;
    if (!view) return;
    e.preventDefault();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  };

  return (
    <div className="markdown-editor" data-testid="editor" onMouseDown={onWrapperMouseDown}>
      <div className="editor-sizer" ref={sizerRef}>
        {/* The wrapper mirrors the title text so the textarea can grow to as many lines as the title wraps onto. */}
        <div className="inline-title-wrap" data-value={title}>
          <textarea
            className="inline-title"
            data-testid="inline-title"
            aria-label="Note title"
            rows={1}
            value={title}
            spellCheck={false}
            onChange={(e) => setTitle(e.currentTarget.value.replace(/[\r\n]+/g, ' '))}
            onFocus={() => setTitleError(null)}
            onBlur={(e) => void commitTitle(e.currentTarget.value)}
            onKeyDown={onTitleKeyDown}
          />
        </div>
        {titleError && (
          <div className="inline-title-error" role="alert">
            {titleError}
          </div>
        )}
        <div className="editor-host" ref={hostRef} />
      </div>
    </div>
  );
}

/** Path of `path` renamed to `title`, staying in its folder and keeping its extension (`.md` for extension-less files). */
export function renamedNotePath(path: string, title: string): string {
  return joinPath(dirname(path), title + (extname(path) || '.md'));
}

/** Hotkeys owned by app commands; CodeMirror's keymaps must leave these to the shell's keydown handler. */
function reservedHotkeys(): string[] {
  const hotkeys = [...app.commands.list().map((c) => c.hotkey), ...EDITOR_COMMANDS.map((c) => c.hotkey)];
  return hotkeys.filter((h): h is string => h !== undefined);
}

function replaceDoc(view: EditorView, content: string): void {
  const anchor = Math.min(view.state.selection.main.head, content.length);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, selection: { anchor } });
}

/**
 * 0-based line of the heading, from the index or (for unsaved edits) the document itself.
 * Headings are matched by their link text, so `[[Note#A B]]` finds `## A | B`.
 */
export function findHeadingLine(view: EditorView, path: string, heading: string): number | undefined {
  const indexed = app.index.getMetadata(path)?.headings.find((h) => headingsMatch(h.text, heading));
  if (indexed) return indexed.position.line;
  return parseHeadings(view.state.doc.toString()).find((h) => headingsMatch(h.text, heading))?.position.line;
}

/** Put the cursor on the target and scroll it to the top. Returns the 0-based line, or null when there is none. */
function navigateTo(view: EditorView, path: string, nav: NavigationTarget): number | null {
  const line = nav.heading !== undefined ? findHeadingLine(view, path, nav.heading) : nav.line;
  if (line === undefined) return null;
  const target = view.state.doc.line(Math.min(Math.max(line, 0) + 1, view.state.doc.lines));
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 24 }) });
  view.focus();
  return target.number - 1;
}

/** Scroll so the 0-based line sits at the top, leaving the selection alone. Returns the line. */
function scrollToLine(view: EditorView, line: number): number {
  const target = view.state.doc.line(Math.min(Math.max(line, 0) + 1, view.state.doc.lines));
  view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 24 }) });
  return target.number - 1;
}

/** 0-based source line at the top edge of the scroll container. */
function topVisibleLine(view: EditorView, scroller: Element): number {
  const top = scroller.getBoundingClientRect().top - view.documentTop;
  return view.state.doc.lineAt(view.lineBlockAtHeight(top).from).number - 1;
}
