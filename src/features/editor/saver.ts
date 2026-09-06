export const SAVE_DELAY_MS = 300;

/** Synchronous scratch copy of unsaved content, so an unload that cuts the real write short loses nothing. */
export interface DraftJournal {
  /** Remember `content` before the debounced write happens. */
  write(content: string): void;
  /** Forget `content` once it is safely stored; must be a no-op when the journal holds something newer. */
  clear(content: string): void;
}

/**
 * Debounces editor content into the vault. `lastSaved` is the content we last handed to `write`,
 * which lets the editor tell its own vault events apart from external modifications.
 * With a `journal`, every scheduled content is journaled synchronously and cleared once `write` has resolved.
 */
export class Saver {
  lastSaved: string;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initial: string,
    private write: (content: string) => unknown,
    private delay = SAVE_DELAY_MS,
    private journal?: DraftJournal,
  ) {
    this.lastSaved = initial;
  }

  /** Remember the latest content and (re)start the save timer. */
  schedule(content: string): void {
    this.pending = content;
    this.journal?.write(content);
    this.clearTimer();
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /** Drop any unsaved content (used when an external change replaces the document). */
  cancel(): void {
    this.pending = null;
    this.clearTimer();
  }

  /** Write pending content now, if it differs from what was last saved. */
  flush(): void {
    this.clearTimer();
    const content = this.pending;
    this.pending = null;
    if (content === null) return;
    if (content === this.lastSaved) {
      this.journal?.clear(content);
      return;
    }
    this.lastSaved = content;
    const done = this.write(content);
    if (!this.journal) return;
    // The journal outlives a failed write so the content can be recovered on the next start.
    void Promise.resolve(done).then(
      () => this.journal?.clear(content),
      (err: unknown) => console.error(err),
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
