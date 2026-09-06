import { describe, expect, it } from 'vitest';
import { extractSection, renderMarkdown, renderProperties, slugify, toggleTaskLine, uniqueSlug, type RenderContext } from './render';

const notes: Record<string, string> = {
  'Welcome.md': '# Welcome\n\nHello [[Other]]',
  'Other.md': 'Other body ![[Welcome]]',
  'Sections.md': '# Top\n\nintro\n\n## Part A\n\nalpha\n\n### Sub\n\nsub\n\n## Part B\n\nbeta',
};

const ctx: RenderContext = {
  path: 'Welcome.md',
  resolveLink: (t) => (notes[`${t}.md`] ? `${t}.md` : undefined),
  getEmbedContent: (p) => notes[p],
};

function render(markdown: string, overrides: Partial<RenderContext> = {}): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(markdown, { ...ctx, ...overrides });
  return div;
}

describe('wikilinks', () => {
  it('renders plain, alias and heading links', () => {
    const dom = render('See [[Other]], [[Other|an alias]] and [[Other#Heading]].');
    const links = [...dom.querySelectorAll('a.internal-link')];
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute('data-href')).toBe('Other');
    expect(links[0].getAttribute('href')).toBe('#');
    expect(links[0].textContent).toBe('Other');
    expect(links[1].textContent).toBe('an alias');
    expect(links[2].getAttribute('data-heading')).toBe('Heading');
    expect(links[2].textContent).toBe('Other > Heading');
    expect(links[0].hasAttribute('data-heading')).toBe(false);
    for (const l of links) expect(l.classList.contains('is-unresolved')).toBe(false);
  });

  it('marks unresolved links and handles same-note heading links', () => {
    const dom = render('[[Missing note]] and [[#Local]]');
    const [missing, local] = [...dom.querySelectorAll('a.internal-link')];
    expect(missing.classList.contains('is-unresolved')).toBe(true);
    expect(local.classList.contains('is-unresolved')).toBe(false);
    expect(local.getAttribute('data-href')).toBe('');
    expect(local.getAttribute('data-heading')).toBe('Local');
  });

  it('works inside lists, tables, headings and blockquotes', () => {
    const dom = render('# Title [[Other]]\n\n- item [[Other]]\n\n> quote [[Other]]\n\n| a | b |\n| - | - |\n| [[Other]] | x |');
    expect(dom.querySelector('h1 a.internal-link')).not.toBeNull();
    expect(dom.querySelector('li a.internal-link')).not.toBeNull();
    expect(dom.querySelector('blockquote a.internal-link')).not.toBeNull();
    expect(dom.querySelector('table.table td a.internal-link')).not.toBeNull();
  });

  it('does not convert links or tags inside code', () => {
    const dom = render('`[[Other]] #tag`\n\n```\n[[Other]] #tag\n```\n\nreal [[Other]] #real');
    expect(dom.querySelectorAll('a.internal-link')).toHaveLength(1);
    expect(dom.querySelectorAll('a.tag')).toHaveLength(1);
    expect(dom.querySelector('code')?.textContent).toBe('[[Other]] #tag');
  });
});

describe('tags', () => {
  it('renders tags with unicode and nesting, not inside words or numbers', () => {
    const dom = render('Hello #tag and #nested/child, #việt-nam. Not a#tag or #123 but #a1');
    const tags = [...dom.querySelectorAll('a.tag')];
    expect(tags.map((t) => t.getAttribute('data-tag'))).toEqual(['tag', 'nested/child', 'việt-nam', 'a1']);
    expect(tags[0].textContent).toBe('#tag');
    expect(tags[0].getAttribute('href')).toBe('#');
    expect(dom.textContent).toContain('#123');
  });

  it('does not turn heading markers into tags', () => {
    const dom = render('# Heading\n\n#real');
    expect(dom.querySelector('h1')?.textContent).toBe('Heading');
    expect(dom.querySelectorAll('a.tag')).toHaveLength(1);
  });
});

describe('inline formatting', () => {
  it('renders highlight and strikethrough', () => {
    const dom = render('a ==high **light**== b ~~gone~~ and x == y');
    expect(dom.querySelector('mark')?.innerHTML).toBe('high <strong>light</strong>');
    expect(dom.querySelector('s')?.textContent).toBe('gone');
    expect(dom.querySelectorAll('mark')).toHaveLength(1);
    expect(dom.textContent).toContain('x == y');
  });

  it('renders fenced code with a language class', () => {
    const dom = render('```ts\nconst a = 1;\n```');
    expect(dom.querySelector('pre > code.language-ts')?.textContent).toBe('const a = 1;\n');
  });
});

describe('task lists', () => {
  it('renders checkboxes with the source line and checked state', () => {
    const dom = render('intro\n\n- [ ] open\n- [x] done\n- plain');
    const items = [...dom.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0].classList.contains('task-list-item')).toBe(true);
    expect(items[0].getAttribute('data-line')).toBe('2');
    expect(items[0].textContent?.trim()).toBe('open');
    const boxes = [...dom.querySelectorAll('input.task-list-item-checkbox')];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].getAttribute('data-line')).toBe('2');
    expect(boxes[0].hasAttribute('checked')).toBe(false);
    expect(boxes[1].getAttribute('data-line')).toBe('3');
    expect(boxes[1].hasAttribute('checked')).toBe(true);
    expect(items[1].classList.contains('is-checked')).toBe(true);
    expect(items[2].classList.contains('task-list-item')).toBe(false);
  });

  it('offsets lines by the front matter', () => {
    const dom = render('---\ntitle: x\n---\n\n- [ ] task');
    expect(dom.querySelector('input.task-list-item-checkbox')?.getAttribute('data-line')).toBe('4');
  });

  it('toggleTaskLine flips the marker on that line only', () => {
    const src = '- [ ] a\n- [x] b\n  - [ ] c\n> - [ ] d\nplain';
    expect(toggleTaskLine(src, 0)).toBe('- [x] a\n- [x] b\n  - [ ] c\n> - [ ] d\nplain');
    expect(toggleTaskLine(src, 1)).toBe('- [ ] a\n- [ ] b\n  - [ ] c\n> - [ ] d\nplain');
    expect(toggleTaskLine(src, 2)).toContain('  - [x] c');
    expect(toggleTaskLine(src, 3)).toContain('> - [x] d');
    expect(toggleTaskLine(src, 4)).toBe(src);
    expect(toggleTaskLine(src, 99)).toBe(src);
  });
});

describe('headings', () => {
  it('slugifies text', () => {
    expect(slugify('  Hello World!  ')).toBe('hello-world');
    expect(slugify('Ünïcödé Tiếng Việt 123')).toBe('ünïcödé-tiếng-việt-123');
    expect(slugify('a_b-c (d)')).toBe('a_b-c-d');
  });

  it('gives headings unique ids and the original text', () => {
    const dom = render('# Intro\n\n## Intro\n\n### Code & Stuff\n\n# Intro');
    const hs = [...dom.querySelectorAll('h1, h2, h3')];
    expect(hs.map((h) => h.id)).toEqual(['intro', 'intro-1', 'code-stuff', 'intro-2']);
    expect(hs[2].getAttribute('data-heading')).toBe('Code & Stuff');
    expect(hs[0].getAttribute('data-line')).toBe('0');
    const seen = new Map<string, number>();
    expect([uniqueSlug('A', seen), uniqueSlug('a', seen), uniqueSlug('', seen)]).toEqual(['a', 'a-1', 'heading']);
  });
});

describe('front matter', () => {
  it('renders a properties block and strips it from the body', () => {
    const dom = render('---\ntitle: My note\ntags: [reference, markdown]\naliases:\n  - Syntax\n  - Md\ndone: true\n---\n\n# Body');
    const props = dom.querySelector('.properties');
    expect(props).not.toBeNull();
    expect(dom.firstElementChild?.classList.contains('properties')).toBe(true);
    expect([...dom.querySelectorAll('.property-key')].map((k) => k.textContent)).toEqual(['title', 'tags', 'aliases', 'done']);
    expect([...dom.querySelectorAll('.properties a.tag')].map((t) => t.getAttribute('data-tag'))).toEqual(['reference', 'markdown']);
    expect([...dom.querySelectorAll('.property-chip')].map((c) => c.textContent)).toEqual(['Syntax', 'Md']);
    expect(dom.textContent).not.toContain('---');
    expect(dom.querySelector('h1')?.textContent).toBe('Body');
  });

  it('skips the block when there is no front matter', () => {
    expect(render('# Just body').querySelector('.properties')).toBeNull();
    expect(renderProperties({})).toBe('');
  });
});

describe('embeds', () => {
  it('renders embedded notes recursively up to the depth limit', () => {
    // Welcome -> embeds Other -> embeds Welcome -> would embed Other (stops)
    const dom = render('Start ![[Other]]', { path: 'Welcome.md' });
    const outer = dom.querySelector('.markdown-embed');
    expect(outer?.getAttribute('data-href')).toBe('Other');
    expect(outer?.querySelector('.markdown-embed-title')?.textContent).toBe('Other');
    expect(outer?.querySelector('.markdown-embed-content')?.textContent).toContain('Other body');
    const inner = outer?.querySelector('.markdown-embed-content .markdown-embed');
    expect(inner?.getAttribute('data-href')).toBe('Welcome');
    expect(inner?.querySelector('h1')?.textContent).toBe('Welcome');
    // depth 2: rendered as a link instead of a third nested embed
    expect(inner?.querySelector('.markdown-embed')).toBeNull();
    expect(inner?.querySelector('a.internal-link[data-href="Other"]')).not.toBeNull();
  });

  it('embeds a single section for heading embeds', () => {
    const dom = render('![[Sections#Part A]]');
    const embed = dom.querySelector('.markdown-embed');
    expect(embed?.querySelector('.markdown-embed-title')?.textContent).toBe('Sections > Part A');
    expect(embed?.textContent).toContain('alpha');
    expect(embed?.textContent).toContain('sub');
    expect(embed?.textContent).not.toContain('beta');
    expect(embed?.querySelector('h2')?.getAttribute('data-line')).toBe('4');
    expect(extractSection(notes['Sections.md'], 'Nope')).toBeUndefined();
  });

  it('falls back to a link for unresolved embeds and a placeholder for images', () => {
    const dom = render('![[Nope]] ![[folder/pic.png]] ![[Other]]', { getEmbedContent: undefined });
    expect(dom.querySelector('a.internal-link.is-unresolved[data-href="Nope"]')).not.toBeNull();
    expect(dom.querySelector('.embed-missing')?.textContent).toBe('pic.png');
    expect(dom.querySelector('a.internal-link[data-href="Other"]:not(.is-unresolved)')).not.toBeNull();
    expect(dom.querySelector('.markdown-embed')).toBeNull();
  });
});

describe('links and sanitization', () => {
  it('opens external links in a new tab', () => {
    const dom = render('[site](https://example.com) and https://auto.example.org and <mailto:a@b.co>');
    const links = [...dom.querySelectorAll('a.external-link')];
    expect(links).toHaveLength(3);
    for (const l of links) {
      expect(l.getAttribute('target')).toBe('_blank');
      expect(l.getAttribute('rel')).toBe('noopener');
    }
    expect(links[1].getAttribute('href')).toBe('https://auto.example.org');
  });

  it('strips scripts, event handlers and javascript: urls', () => {
    const dom = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n\n<a href="javascript:alert(2)">y</a>\n\n[[Other|<img src=x onerror=alert(3)>]] #tag"><b>x</b>');
    expect(dom.querySelector('script')).toBeNull();
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.querySelector('b')).toBeNull();
    expect(dom.querySelector('[onerror]')).toBeNull();
    for (const a of dom.querySelectorAll('a')) expect(a.getAttribute('href')?.startsWith('javascript:')).toBe(false);
    expect(dom.querySelector('a.internal-link')?.textContent).toBe('<img src=x onerror=alert(3)>');
  });
});

describe('markdown links', () => {
  it('renders relative markdown links as internal links', () => {
    const dom = render('[rel](Other.md) [plain](Other) [deep](Sub/Deep.md#Heading) [enc](My%20Note.md) [missing](Nope.md "title")');
    const links = [...dom.querySelectorAll('a')];
    expect(links).toHaveLength(5);
    for (const l of links) {
      expect(l.classList.contains('internal-link')).toBe(true);
      expect(l.getAttribute('href')).toBe('#');
    }
    expect(links.map((l) => l.getAttribute('data-href'))).toEqual(['Other', 'Other', 'Sub/Deep', 'My Note', 'Nope']);
    expect(links[2].getAttribute('data-heading')).toBe('Heading');
    expect(links[0].hasAttribute('data-heading')).toBe(false);
    expect(links[0].classList.contains('is-unresolved')).toBe(false);
    expect(links[4].classList.contains('is-unresolved')).toBe(true);
    expect(links[4].textContent).toBe('missing');
  });

  it('turns fragment-only links into same-note heading links', () => {
    const link = render('# Title\n\n[back](#title)').querySelector('a');
    expect(link?.classList.contains('internal-link')).toBe(true);
    expect(link?.getAttribute('data-href')).toBe('');
    expect(link?.getAttribute('data-heading')).toBe('title');
    expect(link?.getAttribute('href')).toBe('#');
  });

  it('keeps links with a scheme external', () => {
    const dom = render('[a](ftp://host/file) [b](https://x.example) [c](//cdn.example.net/x)');
    expect(dom.querySelectorAll('a.internal-link')).toHaveLength(0);
    expect(dom.querySelectorAll('a.external-link[target="_blank"]')).toHaveLength(3);
  });

  it('does not auto-link file names or bare domains', () => {
    const dom = render('Open README.md and run main.py, build.sh, lib.rs. Domain example.com, www.example.com, a@b.co. Real https://auto.example.org');
    const links = [...dom.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://auto.example.org');
  });

  it('does not parse tags inside a link label', () => {
    const dom = render('[see #tag here](https://example.com) #real');
    const links = [...dom.querySelectorAll('a.external-link')];
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('see #tag here');
    expect([...dom.querySelectorAll('a.tag')].map((t) => t.getAttribute('data-tag'))).toEqual(['real']);
  });
});

describe('line breaks', () => {
  it('renders a single newline as a line break unless strict line breaks is on', () => {
    expect(render('line one\nline two').querySelectorAll('br')).toHaveLength(1);
    expect(render('para one\n\npara two').querySelectorAll('br')).toHaveLength(0);
    expect(render('line one\nline two', { strictLineBreaks: true }).querySelectorAll('br')).toHaveLength(0);
    expect(render('line one  \nline two', { strictLineBreaks: true }).querySelectorAll('br')).toHaveLength(1);
  });
});

describe('embed blocks', () => {
  it('renders an embed-only paragraph as a block without empty paragraphs', () => {
    const dom = render('intro\n\n![[Sections#Part A]]\n\nafter');
    const blocks = [...dom.children];
    expect(blocks.map((b) => b.tagName)).toEqual(['P', 'DIV', 'P']);
    expect(blocks[1].classList.contains('markdown-embed')).toBe(true);
    expect(blocks[1].getAttribute('data-line')).toBe('2');
    expect(blocks[2].getAttribute('data-line')).toBe('4');
    expect(blocks[2].textContent).toBe('after');
  });

  it('keeps a source line per embed line and wraps fallback links in a paragraph', () => {
    const dom = render('![[Sections#Part A]]\n![[Nope]]');
    const blocks = [...dom.children];
    expect(blocks.map((b) => b.tagName)).toEqual(['DIV', 'P']);
    expect(blocks[0].getAttribute('data-line')).toBe('0');
    expect(blocks[1].getAttribute('data-line')).toBe('1');
    expect(blocks[1].querySelector('a.internal-link.is-unresolved[data-href="Nope"]')).not.toBeNull();
    expect(dom.querySelectorAll('p:empty')).toHaveLength(0);
  });
});
