import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../vault/storage';
import { Vault } from '../vault/Vault';
import { MetadataIndex } from './MetadataIndex';

async function setup(files: Record<string, string>) {
  const vault = new Vault(new MemoryAdapter({ files: Object.entries(files).map(([path, content]) => ({ path, content, mtime: 1 })), folders: [] }));
  await vault.load();
  const index = new MetadataIndex(vault);
  index.attach();
  return { vault, index };
}

describe('MetadataIndex', () => {
  it('builds links, backlinks, unresolved and tags', async () => {
    const { index } = await setup({
      'A.md': 'Links to [[B]] and [[Missing]] #alpha #shared',
      'B.md': 'Back to [[A|alias]] and [[A#Heading]] #shared/nested',
      'dir/C.md': 'Only [[a]]',
    });
    expect(index.getOutgoingLinks('A.md')).toEqual(['B.md']);
    expect(index.getBacklinks('A.md').map((b) => b.source)).toEqual(['B.md', 'dir/C.md']);
    expect(index.getBacklinks('A.md')[0].links).toHaveLength(2);
    expect(index.getUnresolvedLinks()).toEqual([{ target: 'Missing', sources: ['A.md'] }]);
    expect(index.getUnresolvedLinksFrom('A.md')).toEqual(['Missing']);
    expect(index.getTags()).toEqual([
      { name: 'alpha', count: 1 },
      { name: 'shared', count: 1 },
      { name: 'shared/nested', count: 1 },
    ]);
    expect(index.getFilesWithTag('#shared')).toEqual(['A.md', 'B.md']);
    expect(index.getFilesWithTag('shared/nested')).toEqual(['B.md']);
  });

  it('updates on modify, create, delete and rename', async () => {
    const { vault, index } = await setup({ 'A.md': '[[B]]', 'B.md': '' });
    const rev = index.revision;
    await vault.modify('A.md', '[[C]] #new');
    expect(index.revision).toBeGreaterThan(rev);
    expect(index.getBacklinks('B.md')).toEqual([]);
    expect(index.getUnresolvedLinks()).toEqual([{ target: 'C', sources: ['A.md'] }]);
    expect(index.getTags()).toEqual([{ name: 'new', count: 1 }]);

    await vault.create('C.md', '[[A]]');
    expect(index.getUnresolvedLinks()).toEqual([]);
    expect(index.getBacklinks('C.md').map((b) => b.source)).toEqual(['A.md']);
    expect(index.getBacklinks('A.md').map((b) => b.source)).toEqual(['C.md']);

    await vault.rename('C.md', 'D.md');
    expect(index.getMetadata('C.md')).toBeUndefined();
    expect(index.getMetadata('D.md')?.title).toBe('D');
    expect(index.getUnresolvedLinks()).toEqual([{ target: 'C', sources: ['A.md'] }]);
    expect(index.getBacklinks('A.md').map((b) => b.source)).toEqual(['D.md']);

    await vault.delete('D.md');
    expect(index.getBacklinks('A.md')).toEqual([]);
    expect(index.getAllMetadata().map((m) => m.path).sort()).toEqual(['A.md', 'B.md']);
  });

  it('ignores non-markdown files', async () => {
    const { index } = await setup({ 'img.png': 'binary', 'A.md': '![[img.png]]' });
    expect(index.getAllMetadata().map((m) => m.path)).toEqual(['A.md']);
    expect(index.getUnresolvedLinks()).toEqual([]);
    expect(index.getOutgoingLinks('A.md')).toEqual(['img.png']);
    // Attachments are not graph nodes, so the edge to them is dropped.
    expect(index.getGraph().edges).toEqual([]);
  });

  it('builds a graph with unresolved ghosts and tag nodes', async () => {
    const { index } = await setup({ 'A.md': '[[B]] [[B]] [[Ghost]] #t', 'B.md': '[[A]]', 'Lonely.md': '' });
    const g = index.getGraph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'Lonely.md', 'unresolved:ghost']);
    expect(g.edges).toEqual([
      { source: 'A.md', target: 'B.md' },
      { source: 'B.md', target: 'A.md' },
      { source: 'A.md', target: 'unresolved:ghost' },
    ]);
    expect(g.nodes.find((n) => n.id === 'A.md')?.degree).toBe(3);
    expect(g.nodes.find((n) => n.id === 'Lonely.md')?.degree).toBe(0);
    const withTags = index.getGraph({ includeTags: true, includeUnresolved: false });
    expect(withTags.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'Lonely.md', 'tag:t']);
    expect(withTags.nodes.find((n) => n.kind === 'tag')?.label).toBe('#t');
  });

  it('builds local graphs by depth', async () => {
    const { index } = await setup({ 'A.md': '[[B]]', 'B.md': '[[C]]', 'C.md': '', 'D.md': '' });
    const d1 = index.getGraph({ localTo: 'A.md' });
    expect(d1.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md']);
    const d2 = index.getGraph({ localTo: 'A.md', depth: 2 });
    expect(d2.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md']);
    expect(d2.nodes.find((n) => n.id === 'B.md')?.degree).toBe(2);
  });

  it('detaches from the vault', async () => {
    const { vault, index } = await setup({ 'A.md': '' });
    index.detach();
    await vault.create('B.md', '');
    expect(index.getMetadata('B.md')).toBeUndefined();
  });
});
