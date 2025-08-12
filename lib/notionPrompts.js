// /lib/notionPrompts.js
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function fetchAllBlocks(blockId) {
  const blocks = [];
  let start_cursor = undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor,
      page_size: 100,
    });
    blocks.push(...res.results);
    start_cursor = res.has_more ? res.next_cursor : undefined;
  } while (start_cursor);
  return blocks;
}

function extractTextFromBlock(block) {
  const rich = block[block.type]?.rich_text || [];
  return rich.map((r) => r.plain_text).join('');
}

export async function readPageAsPlainText(pageId, { fallback = '' } = {}) {
  if (!pageId || !process.env.NOTION_API_KEY) return fallback;
  try {
    const blocks = await fetchAllBlocks(pageId);
    const lines = [];
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph':
        case 'heading_1':
        case 'heading_2':
        case 'heading_3':
        case 'quote':
        case 'callout':
        case 'bulleted_list_item':
        case 'numbered_list_item':
        case 'to_do':
        case 'toggle':
        case 'code':
        case 'equation':
          lines.push(extractTextFromBlock(b));
          break;
        case 'divider':
          lines.push('\n---\n');
          break;
        default:
          // 画像/ファイル/DB等は無視（必要なら拡張）
          break;
      }
    }
    const text = lines.join('\n').trim();
    return text || fallback;
  } catch (err) {
    console.warn('[notionPrompts.readPageAsPlainText] fallback:', err?.message);
    return fallback;
  }
}

export async function replacePageWithPlainText(pageId, text) {
  if (!pageId || !process.env.NOTION_API_KEY) return false;

  const lines = String(text ?? '').split(/\r?\n/);
  const newChildren = lines.map((line) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: line ? [{ type: 'text', text: { content: line } }] : [],
    },
  }));

  const blocks = await fetchAllBlocks(pageId);
  for (const b of blocks) {
    try {
      await notion.blocks.delete({ block_id: b.id });
    } catch {
      // 一部のブロックはdelete不可→無視
    }
  }

  for (let i = 0; i < newChildren.length; i += 100) {
    const chunk = newChildren.slice(i, i + 100);
    await notion.blocks.children.append({
      block_id: pageId,
      children: chunk,
    });
  }
  return true;
}

// お好みで：ダッシュ無し32桁→ダッシュ付きに整形（使わないなら削除OK）
export function normalizeNotionId(s) {
  const raw = String(s || '').replace(/-/g, '');
  if (raw.length !== 32) return s;
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}
