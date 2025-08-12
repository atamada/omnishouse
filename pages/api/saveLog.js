import { notion, DB_ID } from '../../utils/notion';

export default async function handler(req, res) {
  try {
    const { title, text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });

    await notion.pages.create({
      parent: { database_id: DB_ID },
      properties: {
        Title: { title: [{ text: { content: title || `会話 ${new Date().toISOString()}` } }] },
        date: { date: { start: new Date().toISOString() } }
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: text } }] }
        }
      ]
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('saveLog error:', e);
    res.status(500).json({ error: 'Failed to save log' });
  }
}
