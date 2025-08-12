// utils/notion.js
import { Client } from '@notionhq/client';

export const notion = new Client({ auth: process.env.NOTION_API_KEY });

// NotionのDB ID（環境変数優先）
export const DB_ID = process.env.NOTION_DB_ID;

// 文字列をNotionの段落ブロック配列に変換（シンプル版）
export function textToParagraphBlocks(text = '') {
  const lines = String(text).split('\n');
  return lines.map((line) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
    },
  }));
}
