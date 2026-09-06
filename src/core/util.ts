/** Small helpers shared by core and feature modules. */

/**
 * Escape `s` so that it matches literally inside a `RegExp` source.
 *
 * The escape set must stay limited to RegExp SyntaxCharacters (`^ $ \ . * + ? ( ) [ ] { } |`): callers compile the
 * result with the `u` flag, under which escaping any other character (`\-`, `\:`, …) is a SyntaxError.
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The human-readable text of a thrown value: an `Error`'s message, or the value stringified. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
