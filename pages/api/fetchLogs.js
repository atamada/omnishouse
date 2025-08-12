// pages/api/fetchLogs.js
// ✅ Drop-in：APIエンドポイント + サーバー内部用ユーティリティの両対応
import { notion, DB_ID } from '../../utils/notion';

/* ====================== 小ユーティリティ ====================== */

function joinRichText(rich = []) {
  if (!Array.isArray(rich)) return '';
  return rich.map(x => x?.plain_text ?? '').join('');
}

function plainTextFromBlocks(blocks = []) {
  return blocks
    .map(b => {
      const rich = b?.[b.type]?.rich_text ?? [];
      const t = Array.isArray(rich) ? joinRichText(rich) : '';
      return t || '';
    })
    .filter(Boolean)
    .join('\n');
}

async function getAllBlocks(blockId, maxBlocks = 5000) {
  // Notionのblocks.children.listはページングされるので全部集める
  let results = [];
  let cursor;
  do {
    const resp = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
    results = results.concat(resp.results || []);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor && results.length < maxBlocks);
  return results;
}

function pickFirstProperty(properties, keys = [], types = []) {
  for (const key of keys) {
    const p = properties?.[key];
    if (!p) continue;
    // 指定タイプ優先
    for (const t of types) {
      if (p[t]) return { type: t, value: p[t] };
    }
    // 型未指定ならタイトル/リッチテキスト/セレクトを順に探す
    if (p.title) return { type: 'title', value: p.title };
    if (p.rich_text) return { type: 'rich_text', value: p.rich_text };
    if (p.select) return { type: 'select', value: p.select };
  }
  return null;
}

function inferRole(page) {
  const props = page.properties || {};

  // よくあるカラム名でselect/rich_text/titleから推定
  const roleCandidate =
    pickFirstProperty(props, ['role', 'Role', 'speaker', 'Speaker'], ['select', 'rich_text']) ||
    null;

  if (roleCandidate) {
    if (roleCandidate.type === 'select') {
      const name = roleCandidate.value?.name?.toLowerCase?.();
      if (name === 'user' || name === 'assistant') return name;
    }
    if (roleCandidate.type === 'rich_text') {
      const txt = joinRichText(roleCandidate.value).toLowerCase();
      if (/assistant/.test(txt)) return 'assistant';
      if (/user|author|client|あい/.test(txt)) return 'user';
    }
  }

  // タイトル先頭「User:」「Assistant:」パターン
  const title = page.properties?.Title?.title ?? page.properties?.title?.title ?? [];
  const titleTxt = joinRichText(title);
  if (/^\s*assistant\b/i.test(titleTxt)) return 'assistant';
  if (/^\s*user\b/i.test(titleTxt)) return 'user';

  // 交互に並んでいる場合のヒューリスティックは避け、既定は 'user'
  return 'user';
}

function extractTextFromPageObject(page, fallbackBlocksText = '') {
  const props = page.properties || {};

  // よくある本文カラム名
  const contentProp =
    pickFirstProperty(
      props,
      ['Content', 'content', 'Body', 'body', 'Text', 'text', 'Message', 'message'],
      ['rich_text', 'title']
    ) || null;

  if (contentProp) {
    if (contentProp.type === 'rich_text') return joinRichText(contentProp.value);
    if (contentProp.type === 'title') return joinRichText(contentProp.value);
  }

  // なければブロックから
  return fallbackBlocksText;
}

/* ====================== DBクエリ（ページング対応） ====================== */

/**
 * Notion DBから最新順でページを取得し、必要件数まで集める
 */
async function queryDatabasePages({ limit = 50 }) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(limit)));
  let results = [];
  let cursor;

  while (results.length < limit) {
    const resp = await notion.databases.query({
      database_id: DB_ID,
      sorts: [{ property: 'date', direction: 'descending' }], // ← dateプロパティを想定
      page_size: pageSize,
      start_cursor: cursor,
    });
    results = results.concat(resp.results || []);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }

  // limitを超えたぶんは切り捨て
  return results.slice(0, limit);
}

/* ====================== 外部からも呼べる関数 ====================== */

/**
 * 直近ログを [{role, content, date, id}] で返す（古→新）
 * - role: 'user' | 'assistant'（推定）
 * - content: ページ本文（プロパティ or ブロック）
 * - date: dateプロパティ or Notionのlast_edited_time
 */
export async function getRecentLogs({ limit = 50 } = {}) {
  const pages = await queryDatabasePages({ limit });

  // pagesは新しい→古い。まず必要なテキストを集める
  const enriched = await Promise.all(
    pages.map(async (page) => {
      const blocks = await getAllBlocks(page.id);
      const blocksText = plainTextFromBlocks(blocks);
      const content = extractTextFromPageObject(page, blocksText);

      const role = inferRole(page);
      const dateProp =
        page.properties?.date?.date?.start ||
        page.properties?.Date?.date?.start ||
        page.created_time ||
        page.last_edited_time;

      return {
        id: page.id,
        role,
        content,
        date: dateProp,
        title:
          joinRichText(page.properties?.Title?.title || []) ||
          joinRichText(page.properties?.title?.title || ''),
      };
    })
  );

  // 古い→新しいに並び替え
  const chronological = enriched.slice().reverse();

  // chatAがそのまま使えるように {role, content} 形式も作る
  const messages = chronological
    .map((p) => ({
      role: p.role,
      content: (p.content || '').trim(),
      _meta: { id: p.id, date: p.date, title: p.title },
    }))
    .filter((m) => m.content);

  return messages;
}

/* ====================== APIハンドラ ====================== */
// GET /api/fetchLogs?limit=200 で呼べる
export default async function handler(req, res) {
  try {
    const limitParam =
      (req.method === 'GET' ? req.query?.limit : req.body?.limit) ?? 50;
    const limit = Number(limitParam) || 50;

    const messages = await getRecentLogs({ limit });
    // APIから返すときは最低限の情報にそぎ落とし（title等は_metaに保持）
    res.status(200).json({ items: messages });
  } catch (e) {
    console.error('fetchLogs error:', e);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}
