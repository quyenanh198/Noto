import type { VaultSnapshot } from '../types';

const now = Date.now();

/** Notes seeded into a fresh vault so the app is not empty on first launch. */
export const SAMPLE_VAULT: VaultSnapshot = {
  folders: ['Daily'],
  files: [
    {
      path: 'Welcome.md',
      mtime: now,
      content: `# Welcome to Noto

Noto is a local-first, markdown knowledge base in the spirit of Obsidian. Your notes are plain markdown files.

## Get started

- Press **Ctrl/Cmd+Alt+N** to create a new note.
- Type \`[[\` to link to another note, for example [[Linking notes]].
- Press **Ctrl/Cmd+O** to quickly open any note, **Ctrl/Cmd+P** for the command palette.
- Press **Ctrl/Cmd+E** to switch between editing and reading view.
- Open the graph with **Ctrl/Cmd+G** to see how your notes connect.

## Explore

- [[Linking notes]] explains links, backlinks, and tags.
- [[Markdown syntax]] shows what you can write.
- [[Projects/Noto roadmap]] tracks what is planned.

#getting-started
`,
    },
    {
      path: 'Linking notes.md',
      mtime: now,
      content: `# Linking notes

Links are the heart of a knowledge base. Write \`[[Note name]]\` to link to a note. If the note does not exist yet, clicking the link creates it.

## Variants

- Alias: [[Welcome|the welcome page]]
- Heading: [[Markdown syntax#Code]]
- A link to a note that does not exist yet: [[Ideas inbox]]

## Backlinks

Open the right sidebar to see every note that links to the current one. [[Welcome]] links here, so it shows up in the backlinks of this note.

## Tags

Tags group notes without linking them. Click a tag to search for it: #getting-started #reference/links
`,
    },
    {
      path: 'Markdown syntax.md',
      mtime: now,
      content: `---
tags: [reference, markdown]
aliases: [Syntax]
---

# Markdown syntax

## Text

*Italic*, **bold**, ~~strikethrough~~, ==highlight==, and \`inline code\`.

## Lists

1. First
2. Second
   - Nested bullet
   - Another

- [ ] A task
- [x] A done task

## Code

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

## Quotes

> Knowledge is a network, not a list.

## Tables

| Feature | Status |
| ------- | ------ |
| Links   | Done   |
| Graph   | Done   |

See also [[Linking notes]] and [[Welcome]].
`,
    },
    {
      path: 'Projects/Noto roadmap.md',
      mtime: now,
      content: `# Noto roadmap

#project/noto

## Done

- [x] Vault stored in the browser
- [x] Wikilinks and backlinks
- [x] Graph view

## Next

- [ ] Open a folder from disk
- [ ] Canvas view

Related: [[Welcome]], [[Linking notes]]
`,
    },
  ],
};
