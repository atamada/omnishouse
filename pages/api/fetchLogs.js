import { notion, DB_ID } from '../../utils/notion';

export default async function handler(req, res) {
  const dbRes = await notion.databases.query({
    database_id: DB_ID,
    sorts: [{ property: 'date', direction: 'descending' }],
    page_size: 3
  });

  const pages = await Promise.all(dbRes.results.map(async (page) => {
    const blocks = await notion.blocks.children.list({ block_id: page.id });
    const text = blocks.results
      .map(b => b.paragraph?.text?.map(t => t.plain_text).join('') || '')
      .join('\n');
    return { title: page.properties.Title.title[0]?.plain_text, text };
  }));

  res.status(200).json(pages);
}

