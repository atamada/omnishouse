import { notion, DB_ID } from '../../utils/notion';

export default async function handler(req, res) {
  const { title, text } = req.body;

  await notion.pages.create({
    parent: { database_id: DB_ID },
    properties: {
      Title: { title: [{ text: { content: title } }] },
      date: { date: { start: new Date().toISOString() } }
    },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { text: [{ type: 'text', text: { content: text } }] }
      }
    ]
  });

  res.status(200).json({ ok: true });
}

