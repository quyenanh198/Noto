import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(---|\.\.\.)[ \t]*$/;

/**
 * YAML front matter (`---` … `---` at the very start of the note) parsed as one block, so that its lines
 * are not mistaken for a horizontal rule, a setext heading or links. An unclosed block runs to the end.
 */
export const frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: tags.meta },
    { name: 'FrontmatterMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !OPEN.test(line.text)) return false;
        const marks = [cx.elt('FrontmatterMark', 0, line.text.length)];
        let end = line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (CLOSE.test(line.text)) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, end));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt('Frontmatter', 0, end, marks));
        return true;
      },
    },
  ],
};
