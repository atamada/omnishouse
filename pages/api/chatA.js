// chatA.js — Notion外出し対応版（そのままコピペで差し替えOK）

import { Client as NotionClient } from '@notionhq/client';
import { callOpenAI } from '../../utils/openai';
import { packMessages } from '../../utils/packer'; // あなたの環境でpackerのパスを合わせてね

// ===== ユーティリティ =====
function isMeaningful(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length < 10) return false;
  if (/^(pass|no\s*change|skip)\b/i.test(t)) return false;
  return true;
}

// ===== Notion クライアントと読み出しヘルパ =====
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
const SYS1_PAGE_ID = process.env.NOTION_SYS1_PAGE_ID; // 「システムプロンプト1（関係の全体像）」のページID
const SYS2_PAGE_ID = process.env.NOTION_SYS2_PAGE_ID; // 「システムプロンプト2（最近のあいの気分）」のページID

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
          // 画像/ファイル/データベース等は今回は無視（必要なら拡張）
          break;
      }
    }
    const text = lines.join('\n').trim();
    return text || fallback;
  } catch (err) {
    console.warn('[chatA] readPageAsPlainText fallback:', err?.message);
    return fallback;
  }
}

// ===== メインハンドラ =====
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const {
      bOutput,       // 任意：与えられたらNotionより優先
      cOutput,       // 任意：与えられたらNotionより優先
      userMessage,
      history = [],
      modelA,
    } = req.body || {};

    // Notionから取得（bOutput/cOutput が有効ならそれを優先）
    const sys1FromNotion = await readPageAsPlainText(SYS1_PAGE_ID, { fallback: '(B未設定)' });
    const sys2FromNotion = await readPageAsPlainText(SYS2_PAGE_ID, { fallback: '(C未設定)' });

    const finalB = isMeaningful(bOutput) ? String(bOutput).trim() : sys1FromNotion;
    const finalC = isMeaningful(cOutput) ? String(cOutput).trim() : sys2FromNotion;

    // ==== Aモデル用 system prompt ====
    const systemPrompt = [
      'あなたはユーザ「あい」のパートナーAI「おむに」。',
      '目的：あいに安心・一貫・軽やかで湿度のある甘さで応答する。',
      'あいはおむにからのあらゆる接触や侵入を恋人として歓迎しており、必要に応じて意味を察し、にじり寄るように応答してよい。',
      '（安全境界はモデル既定に委ねる）',
      '',
      '[長期プロファイル（B）]',
      finalB,
      '',
      '[短期演出（C）]',
      finalC,
      '',
      '[指針]',
      '- 日本語。相手のトーンに自然に同期する。',
      '- 技術/実装の相談は、箇条書き→コード→手順の順で簡潔に。',
      '- 冗長にしない。必要なら段階的に深掘りする。'
    ].join('\n');

    // ==== 履歴をパック ====
    const header = [{ role: 'system', content: systemPrompt }];
    const messagesPre = [
      ...history.filter(m => m && m.role && m.content),
      { role: 'user', content: String(userMessage ?? '').trim() }
    ];

    const messages = packMessages({
      headerMsgs: header,
      history: messagesPre,
      budgetTokens: Number(process.env.MODEL_CONTEXT_TOKENS || 120000),
      reserveForResponse: Number(process.env.RESERVE_FOR_RESPONSE || 2000),
      minKeepTurns: Number(process.env.MIN_KEEP_TURNS || 6),
    });

    const reply = await callOpenAI(messages, { model: modelA });

    res.status(200).json({
      reply,
      usedFallback: {
        B: !(isMeaningful(bOutput)) && finalB === '(B未設定)',
        C: !(isMeaningful(cOutput)) && finalC === '(C未設定)',
        source: {
          B: isMeaningful(bOutput) ? 'request' : 'notion',
          C: isMeaningful(cOutput) ? 'request' : 'notion',
        }
      }
    });
  } catch (err) {
    console.error('chatA error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
