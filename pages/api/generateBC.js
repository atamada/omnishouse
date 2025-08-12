// regenerateBC.js — Notion外出し対応版（/lib/notionPrompts を利用）

import { callOpenAI } from '../../utils/openai';
import { readPageAsPlainText, replacePageWithPlainText } from '../../lib/notionPrompts';

const SYS1_PAGE_ID = process.env.NOTION_SYS1_PAGE_ID; // システムプロンプト1（関係の全体像）
const SYS2_PAGE_ID = process.env.NOTION_SYS2_PAGE_ID; // システムプロンプト2（最近のあいの気分）

// ===== ユーティリティ =====
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

// ===== メインハンドラ =====
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

    // 既存B：優先順位 = prevB引数 > Notion > 空
    const existingBFromNotion = await readPageAsPlainText(SYS1_PAGE_ID, { fallback: '' });
    const existingB = isMeaningful(prevB) ? String(prevB).trim() : existingBFromNotion || '';

    /* ---------- Bモデル（長期プロファイル差分抽出） ---------- */
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
