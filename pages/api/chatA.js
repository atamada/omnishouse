import { callOpenAI } from '../../utils/openai';
import { packMessages } from '../../utils/packer'; // あなたの環境でpackerのパスを合わせてね

function isMeaningful(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length < 10) return false;
  if (/^(pass|no\s*change|skip)\b/i.test(t)) return false;
  return true;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const {
      bOutput,
      cOutput,
      userMessage,
      history = [],
      modelA,
    } = req.body || {};

    const finalB = isMeaningful(bOutput) ? String(bOutput).trim() : '(B未設定)';
    const finalC = isMeaningful(cOutput) ? String(cOutput).trim() : '(C未設定)';

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
      usedFallback: { B: !isMeaningful(bOutput), C: !isMeaningful(cOutput) }
    });
  } catch (err) {
    console.error('chatA error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
