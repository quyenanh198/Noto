/** Characters that cannot appear in the heading part of a `[[Note#heading]]` link. */
const UNLINKABLE = /[|#^[\]]+/g;

/** The form of a heading that can be written inside `[[Note#heading]]`, like Obsidian's stripHeadingForLink. */
export function headingLinkText(text: string): string {
  return text.replace(UNLINKABLE, ' ').replace(/\s+/g, ' ').trim();
}

/** True when `heading` (from a note) is the target of `wanted` (from a link), comparing their link forms case-insensitively. */
export function headingsMatch(heading: string, wanted: string): boolean {
  return headingLinkText(heading).toLowerCase() === headingLinkText(wanted).toLowerCase();
}
