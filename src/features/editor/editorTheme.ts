import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Markdown token styling. Sizes follow Obsidian's default heading scale; colors come from theme tokens. */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.8em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.6em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.37em', fontWeight: '700' },
  { tag: t.heading4, fontSize: '1.25em', fontWeight: '700' },
  { tag: t.heading5, fontSize: '1.12em', fontWeight: '700' },
  { tag: t.heading6, fontSize: '1em', fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: t.link, color: 'var(--link-color)' },
  { tag: t.url, color: 'var(--text-muted)' },
  { tag: t.contentSeparator, color: 'var(--text-faint)' },
  { tag: t.processingInstruction, color: 'var(--text-faint)', fontWeight: '400' },
  { tag: t.labelName, color: 'var(--text-muted)' },
  { tag: t.meta, color: 'var(--text-muted)' },
  // Fenced code in other languages.
  { tag: t.keyword, color: 'var(--interactive-accent)' },
  { tag: t.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--link-color)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--text-muted)' },
]);

/**
 * Editor chrome styled with theme tokens so it follows dark/light mode.
 * Selectors are prefixed with `&.cm-editor` where CodeMirror's base theme uses `&light`/`&dark`
 * rules, so that ours have equal specificity and win by being declared later.
 */
export const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text-normal)', fontSize: 'var(--font-size)', height: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'var(--font-text)', lineHeight: 'var(--line-height)' },
  '.cm-content': { padding: '0', minHeight: '6em', caretColor: 'var(--text-normal)' },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: 'var(--text-faint)', fontStyle: 'normal' },
  '&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor': { borderLeftColor: 'var(--text-normal)', borderLeftWidth: '2px' },
  '&.cm-editor .cm-activeLine': { backgroundColor: 'var(--background-modifier-hover)' },
  '&.cm-editor .cm-selectionBackground': { backgroundColor: 'var(--text-selection)' },
  '&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--text-selection)' },
  '&.cm-editor .cm-selectionMatch': { backgroundColor: 'var(--background-modifier-active)' },
  '&.cm-editor.cm-focused .cm-matchingBracket, &.cm-editor.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--background-modifier-active)',
    outline: 'none',
  },
  '&.cm-editor .cm-searchMatch': { backgroundColor: 'var(--text-highlight-bg)' },
  '&.cm-editor .cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--interactive-accent)', color: 'var(--text-on-accent)' },

  // Search panel.
  '&.cm-editor .cm-panels': { backgroundColor: 'var(--background-secondary)', color: 'var(--text-normal)' },
  '&.cm-editor .cm-panels-top': { borderBottom: '1px solid var(--background-modifier-border)' },
  '&.cm-editor .cm-panels-bottom': { borderTop: '1px solid var(--background-modifier-border)' },
  '.cm-panel.cm-search': { padding: '6px 32px 6px 8px', fontFamily: 'var(--font-interface)', fontSize: 'var(--font-ui-small)' },
  '.cm-panel.cm-search label': { marginLeft: '6px', color: 'var(--text-muted)' },
  '&.cm-editor .cm-textfield': {
    backgroundColor: 'var(--background-modifier-form-field)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: 'var(--radius-s)',
    color: 'var(--text-normal)',
    padding: '3px 6px',
    fontSize: 'var(--font-ui-small)',
  },
  '&.cm-editor .cm-textfield:focus': { borderColor: 'var(--interactive-accent)', outline: 'none' },
  '&.cm-editor .cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--background-modifier-hover)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: 'var(--radius-s)',
    color: 'var(--text-normal)',
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 'var(--font-ui-small)',
  },
  '&.cm-editor .cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--background-modifier-active)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--text-muted)', fontSize: '18px', top: '4px', right: '8px' },

  // Autocomplete popup.
  '&.cm-editor .cm-tooltip': {
    backgroundColor: 'var(--background-secondary)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: 'var(--radius-m)',
    boxShadow: 'var(--shadow)',
    color: 'var(--text-normal)',
    fontFamily: 'var(--font-interface)',
    fontSize: 'var(--font-ui-small)',
  },
  '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-interface)', maxHeight: '16em', minWidth: '260px', padding: '4px' },
  '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', lineHeight: '1.4', borderRadius: 'var(--radius-s)' },
  '&.cm-editor .cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--background-modifier-hover)', color: 'var(--text-normal)' },
  '&.cm-editor .cm-completionMatchedText': { textDecoration: 'none', color: 'var(--interactive-accent)', fontWeight: '600' },
  '&.cm-editor .cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '0.8em' },
});
