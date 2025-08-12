import { notion, DB_ID } from '../../utils/notion';

function plainTextFromBlocks(blocks = []) {
  return blocks
    .map(b => {
      const t = b[b.type]?.rich_text ?? [];
      return Array.isArray(t) ? t.map(x => x.plain_text).join('') : '';
    })
    .filter(Boolean)
    .join('\n');
}

export default async function handler(req, res) {
  try {
    const dbRes = await notion.databases.query({
      database_id: DB_ID,
      sorts: [{ property: 'date', direction: 'descending' }],
      page_size: 3
    });

    const pages = await Promise.all(
      dbRes.results.map(async (page) => {
        const blocks = await notion.blocks.children.list({ block_id: page.id });
        const text = plainTextFromBlocks(blocks.results);
        const title = page.properties?.Title?.title?.[0]?.plain_text ?? '';
        return { title, text };
      })
    );

    res.status(200).json(pages);
  } catch (e) {
    console.error('fetchLogs error:', e);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}
