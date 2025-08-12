import { notion, DB_ID, textToParagraphBlocks } from '../../utils/notion';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!DB_ID) return res.status(500).json({ error: 'NOTION_DB_ID is missing' });

    const { title = `会話 ${new Date().toISOString()}`, text = '', sessionId = '' } = req.body || {};

    // レコード数チェック
    const dbCountRes = await notion.databases.query({
      database_id: DB_ID,
      page_size: 1
    });
    const totalCount = dbCountRes?.total ?? null;
    let alertMsg = null;
    if (totalCount && totalCount >= 1000) {
      alertMsg = `⚠️ このDBのレコード数が${totalCount}件を超えました。新しいDBを作成してください。`;
    }

    const properties = {
      Title: { title: [{ type: 'text', text: { content: String(title).slice(0, 200) } }] },
      date: { date: { start: new Date().toISOString() } }
    };

    if (sessionId) {
      properties['Session ID'] = {
        rich_text: [{ type: 'text', text: { content: sessionId } }]
      };
    }

    const createRes = await notion.pages.create({
      parent: { database_id: DB_ID },
      properties,
    });

    const blocks = textToParagraphBlocks(text);
    if (blocks.length) {
      await notion.blocks.children.append({
        block_id: createRes.id,
        children: blocks.slice(0, 100)
      });
    }

    res.status(200).json({ ok: true, id: createRes.id, alert: alertMsg });
  } catch (e) {
    console.error('saveLog error:', e);
    res.status(500).json({ error: 'Failed to save log' });
  }
}
