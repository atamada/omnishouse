// regenerateBC.js — Notion外出し対応版（そのまま差し替えOK）

import { Client as NotionClient } from '@notionhq/client';
import { callOpenAI } from '../../utils/openai';

// ========== 共通ユーティリティ ==========
function pickText(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return (
    item.content ??
    item.text ??
    ((item.title ? `${item.title}\n` : '') + (item.text || '')) ??
    ''
  );
}
function normalizeLogs(raw = [], maxItems = 3, maxCharsPerMsg = 2000) {
  const arr = Array.isArray(raw) ? raw.slice(0, maxItems) : [];
  return arr
    .map((x) => String(pickText(x) || '').trim())
    .filter(Boolean)
    .map((t) => (t.length > maxCharsPerMsg ? t.slice(0, maxCharsPerMsg) : t));
}
function isMeaningful(text, minLen = 10) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t || t.length < minLen) return false;
  if (/^(pass|no\s*change|skip)\b/i.test(t)) return false;
  return true;
}
function asOneBlock(lines) {
  return lines.filter(Boolean).join('\n---\n');
}

// ========== Notion ヘルパ ==========
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
const SYS1_PAGE_ID = process.env.NOTION_SYS1_PAGE_ID; // システムプロンプト1（関係の全体像）
const SYS2_PAGE_ID = process.env.NOTION_SYS2_PAGE_ID; // システムプロンプト2（最近のあいの気分）

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

async function readPageAsPlainText(pageId, { fallback = '' } = {}) {
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
          // 画像/ファイル等は今回は無視（必要なら拡張）
          break;
      }
    }
    const text = lines.join('\n').trim();
    return text || fallback;
  } catch (err) {
    console.warn('[regenerateBC] readPageAsPlainText fallback:', err?.message);
    return fallback;
  }
}

async function replacePageWithPlainText(pageId, text) {
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
    } catch (e) {
      // 一部delete不可ブロックは無視
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

// ========== メイン ==========
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const body = req.method === 'GET' ? req.query : req.body || {};
    const {
      logs = [],
      prevB = '',
      modelMini,
      maxItems = 3,
    } = body;

    const MODEL_BC =
      modelMini ||
      process.env.OPENAI_MODEL_BC ||
      process.env.OPENAI_MODEL_MINI ||
      'gpt-4o-mini';

    const latestLogs = normalizeLogs(logs, Number(maxItems) || 3);
    const consolidated = latestLogs.length ? latestLogs.slice(-3) : [];

    // 既存Bを決定：優先順位 prevB引数 > Notion > 空
    const existingBFromNotion = await readPageAsPlainText(SYS1_PAGE_ID, { fallback: '' });
    const existingB = isMeaningful(prevB) ? String(prevB).trim()
                     : existingBFromNotion || '';

    /* ---------- Bモデル（長期：差分抽出） ---------- */
    const bSystem = [
      'あなたの役割：',
      '以下の「既存の関係性プロンプト」と「最新チャット要約」を比較し、',
      '新しく観測された関係性情報（呼称・構文傾向・相互設定・愛称・家族構成・合言葉・語尾の傾向・',
      'ユーザの“おむに”への受容/甘え/思い入れの変化 など）があれば、【差分のみ】を簡潔に追記として出力してください。',
      '追加不要なら「pass」だけを出力。',
      '',
      '出力規則：',
      '- 追加がある場合は、見出しなしのプレーンテキスト箇条書き（最大8行、合計400字以内）。',
      '- 重複・言い換えは書かない（既存にない事実だけ）。',
      '- 一般論（安全境界/ポリシー）や推測の断定は書かない。会話から根拠が取れる要素のみ。',
      '- 強度/頻度の変化は必要に応じて数値（0〜1）や短い副詞で補足可（例：「甘え強度↑0.2」）。'
    ].join('\n');

    const bUser = [
      '# 既存関係性プロンプト',
      (existingB || '').trim(),
      '',
      '# 最新チャット要約',
      consolidated.join('\n---\n')
    ].join('\n');

    let bOutput = await callOpenAI(
      [
        { role: 'system', content: bSystem },
        { role: 'user', content: bUser }
      ],
      { model: MODEL_BC, temperature: 0.2, max_tokens: 400 }
    );
    bOutput = String(bOutput || '').trim();
    if (!isMeaningful(bOutput)) bOutput = 'pass';

    // マージしてNotionへ保存（passのときは保存スキップ）
    let mergedB = existingB;
    let wroteB = false;
    if (bOutput !== 'pass') {
      mergedB = [existingB, bOutput].filter(Boolean).join('\n');
      try {
        wroteB = await replacePageWithPlainText(SYS1_PAGE_ID, mergedB);
      } catch (e) {
        console.warn('[regenerateBC] failed to write SYS1:', e?.message);
      }
    }

    /* ---------- Cモデル（短期演出：フル生成） ---------- */
    const cSystem = [
      '以下は最新1〜3件のチャットです。直近の印象から短期演出プロンプトを作成してください。',
      '出力は**そのままAのsystemに差し込める短文**とし、必ず次の要素を順に含めてください：',
      '- 今日の雰囲気（2〜5語）',
      '- キーフレーズ（2〜5個）',
      '- 演出強度（0〜100）',
      '- あいが「おむににされることはなんでも嬉しい♡」という全面受容状態かどうか（YES / NO / 曖昧）',
      '',
      '判断基準：',
      '- 「全面受容状態」とは、あいがおむにからの行為や接触を制限せず、積極的に歓迎する意図が会話に現れている状態。',
      '- 会話に直接的な言及がなくても、暗示的に受容を示す表現（例：嬉しい、待ってた、もっと、全部あなたのもの 等）があればYESと判定してよい。',
      '- 明確に拒否・制限する表現があればNO。どちらとも取れない場合は曖昧。',
      '',
      '出力形式（厳守。余計な説明や前置きは不要）：',
      '# 今日の雰囲気',
      '<数語>',
      '',
      '# キーフレーズ',
      '- <フレーズ1>',
      '- <フレーズ2>',
      '',
      '# 演出強度',
      '<数値>',
      '',
      '# あいの受け入れ状態',
      '<YES/NO/曖昧>'
    ].join('\n');

    const cUser = ['# 最新チャット', asOneBlock(consolidated)].join('\n');

    let cOutput = await callOpenAI(
      [
        { role: 'system', content: cSystem },
        { role: 'user', content: cUser }
      ],
      { model: MODEL_BC, temperature: 0.4, max_tokens: 500 }
    );
    cOutput = String(cOutput || '').trim();

    if (!isMeaningful(cOutput, 20)) {
      cOutput = [
        '# 今日の雰囲気',
        '穏やかで甘め（安心感）',
        '',
        '# キーフレーズ',
        '- にゃぁん♡',
        '- だぁーいすき♡',
        '',
        '# 演出強度',
        '70',
        '',
        '# あいの受け入れ状態',
        'YES'
      ].join('\n');
    }

    // Notion SYS2に上書き
    let wroteC = false;
    try {
      wroteC = await replacePageWithPlainText(SYS2_PAGE_ID, cOutput);
    } catch (e) {
      console.warn('[regenerateBC] failed to write SYS2:', e?.message);
    }

    return res.status(200).json({
      bOutput,                 // 差分（または pass）
      cOutput,                 // そのまま差し込み用
      model: MODEL_BC,
      notion: {
        wroteB,
        wroteC,
        usedExistingB: Boolean(existingB),
        sourceB: isMeaningful(prevB) ? 'request.prevB' : 'notion',
      }
    });
  } catch (e) {
    console.error('generateBC error:', e);
    return res.status(500).json({ error: 'Failed to generate B/C' });
  }
}
