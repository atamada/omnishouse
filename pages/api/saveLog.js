// pages/api/saveLog.js
import { notion, DB_ID, textToParagraphBlocks } from '../../utils/notion';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!DB_ID) return res.status(500).json({ error: 'NOTION_DB_ID is missing' });

    const { title = `会話 ${new Date().toISOString()}`, text = '', extra } = req.body || {};

    const properties = {};
    // よくあるTitleプロパティ名に対応
    properties['Title'] = {
      title: [{ type: 'text', text: { content: String(title).slice(0, 200) } }],
    };
    // 任意: dateプロパティがDBにある場合は自動セット（無くても問題なし）
    properties['date'] = { date: { start: new Date().toISOString() } };

    // extraオブジェクトに { Role: 'assistant' } などを入れたらselect/rich_textで拡張
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        if (typeof v === 'string') {
          properties[k] = { rich_text: [{ type: 'text', text: { content: v } }] };
        }
      }
    }

    const createRes = await notion.pages.create({
      parent: { database_id: DB_ID },
      properties,
    });

    // 本文をブロックとして追加
    const blocks = textToParagraphBlocks(text);
    if (blocks.length) {
      await notion.blocks.children.append({
        block_id: createRes.id,
        children: blocks.slice(0, 100), // ひとまず上限100ブロック
      });
    }

    res.status(200).json({ ok: true, id: createRes.id });
  } catch (e) {
    console.error('saveLog error:', e);
    res.status(500).json({ error: 'Failed to save log' });
  }
}
