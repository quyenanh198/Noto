export const SAVE_DELAY_MS = 300;

/**
 * Debounces editor content into the vault. `lastSaved` is the content we last handed to `write`,
 * which lets the editor tell its own vault events apart from external modifications.
 */
export class Saver {
  lastSaved: string;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initial: string,
    private write: (content: string) => void,
    private delay = SAVE_DELAY_MS,
  ) {
    this.lastSaved = initial;
  }

  /** Remember the latest content and (re)start the save timer. */
  schedule(content: string): void {
    this.pending = content;
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
    if (content === null || content === this.lastSaved) return;
    this.lastSaved = content;
    this.write(content);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
