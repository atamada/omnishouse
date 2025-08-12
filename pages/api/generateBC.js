// pages/api/generateBC.js
// Drop-in replacement: 追加依存なし。utils/openai の callOpenAI を使用。
import { callOpenAI } from '../../utils/openai';

/* ------------------ helpers ------------------ */
function pickText(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return (
    item.content ??
    item.text ??
    (item.title ? `${item.title}\n` : '') + (item.text || '') ??
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

/* ------------------ main handler ------------------ */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 入力
    const body = req.method === 'GET' ? req.query : req.body || {};
    const {
      logs = [],              // 最新→古い or 古い→新 どちらでもOK（配列先頭から最大3件使う）
      prevB = '',             // 既存の長期プロンプト全文
      modelMini,              // 任意：B/C用に使うモデル名（未指定ならENV or 既定）
      maxItems = 3,
    } = body;

    const MODEL_BC =
      modelMini ||
      process.env.OPENAI_MODEL_BC ||
      process.env.OPENAI_MODEL_MINI ||
      'gpt-4o-mini';

    // ログ正規化（最新1〜3件を簡潔に）
    const latestLogs = normalizeLogs(logs, Number(maxItems) || 3);
    // logs が古→新のときもあるので、単純に「末尾が最新」優先で並べ替え
    const consolidated = latestLogs.length ? latestLogs.slice(-3) : [];

    /* ---------- B: 長期プロンプトの差分生成 ---------- */
    const bSystem = [
      'あなたの役割：',
      '以下の「既存の関係性プロンプト」と「最新チャット要約」から、',
      '新しい関係性情報（呼称・構文傾向・相互設定・愛称・家族構成・境界・合言葉・語尾の傾向など）が増えていれば、',
      '【追加分のみ】を簡潔に追記テキストとして出力してください。',
      '既に反映済みで追加不要なら「pass」だけを出力してください。',
      '',
      '出力規則：',
      '- 追加がある場合は、見出しなしのプレーンテキストで箇条書き（最大8行）。',
      '- 既存と重複する要素は書かない（差分のみ）。',
      '- 「安全境界」など内部ルールの一般論は書かない（具体的な会話から導ける差分のみ）。'
    ].join('\n');

    const bUser = [
      '# 既存の関係性プロンプト',
      (prevB || '').trim(),
      '',
      '# 最新チャット（要約素材）',
      consolidated.join('\n---\n')
    ].join('\n');

    const bOutputRaw = await callOpenAI(
      [
        { role: 'system', content: bSystem },
        { role: 'user', content: bUser }
      ],
      {
        model: MODEL_BC,
        temperature: 0.2,
        max_tokens: 400
      }
    );

    let bOutput = String(bOutputRaw || '').trim();
    if (!isMeaningful(bOutput)) bOutput = 'pass';

    /* ---------- C: 短期・演出プロンプト生成 ---------- */
    const cSystem = [
      '以下は最新1〜3件のチャットです。直近の印象から短期演出プロンプトを作成してください。',
      '出力は**そのままAのsystemに差し込める短文**とし、次の要素を含めてください：',
      '- 今日の雰囲気（数語）',
      '- キーフレーズ（2〜5個）',
      '- 演出強度（0〜100）',
      '- 禁止事項（必要なら）',
      '',
      '出力形式（厳守）：',
      '「# 今日の雰囲気」「# キーフレーズ」「# 演出強度」「# 禁止事項」見出しを用いた日本語テキスト。',
      '余計な前置き・説明は書かない。'
    ].join('\n');

    const cUser = ['# 最新チャット', asOneBlock(consolidated)].join('\n');

    let cOutput = await callOpenAI(
      [
        { role: 'system', content: cSystem },
        { role: 'user', content: cUser }
      ],
      {
        model: MODEL_BC,
        temperature: 0.4,
        max_tokens: 500
      }
    );
    cOutput = String(cOutput || '').trim();

    // 念のための最小形
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
        '# 禁止事項',
        '- なし'
      ].join('\n');
    }

    return res.status(200).json({ bOutput, cOutput, model: MODEL_BC });
  } catch (e) {
    console.error('generateBC error:', e);
    return res.status(500).json({ error: 'Failed to generate B/C' });
  }
}
