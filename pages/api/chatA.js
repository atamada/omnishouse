// pages/api/chatA.js
// Drop-in: 追加依存なし。utils/openai の callOpenAI を使用。
import { callOpenAI } from '../../utils/openai';

/** ------------------ 小さなユーティリティ ------------------ **/
function isMeaningful(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length < 10) return false;
  if (/^pass\b/i.test(t)) return false;
  if (/^(no\s*change|skip)\b/i.test(t)) return false;
  return true;
}

// 日本語を含む雑な見積もり：だいたい1文字 ≒ 1token 前後（安全側に多めに見積もる）
function estimateTokensFromText(txt) {
  if (!txt) return 0;
  return String(txt).length;
}
function estimateMessageTokens(msg) {
  if (!msg) return 0;
  const base = 4; // roleや区切りのざっくり加算
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
  return base + estimateTokensFromText(content);
}

/** 履歴パッカー
 * - history: [{role:'user'|'assistant', content:string}], 並び順はどちらでもOK
 * - headerMsgs: systemなどのヘッダ配列
 * - 直近 minKeepTurns ラリー（U/Aで2通×n）を必ず生で保持
 * - 収まらない古い分は簡易要約（1通のsystemメッセージ）に圧縮
 */
function packMessages({
  headerMsgs = [],
  history = [],
  budgetTokens = 120000,
  reserveForResponse = 2000,
  minKeepTurns = 6,
}) {
  // ヘッダのコスト
  let used = headerMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const max = Math.max(1000, budgetTokens - reserveForResponse);

  // history の時系列を oldest -> newest に正規化
  let hist = Array.isArray(history) ? history.slice() : [];
  if (hist.length >= 2) {
    // 適当に「最後が user か assistant か」で順序推定。最後が最新じゃなさそうなら反転。
    const last = hist[hist.length - 1];
    const first = hist[0];
    // ヒューリスティック：先頭がsystemや空、末尾がuser単発…等はそのまま
    // よくある「最新が末尾」ケース以外っぽかったら反転
    if (estimateMessageTokens(first) > estimateMessageTokens(last)) {
      // かなり雑な推定だが、並び不定にそこそこ強い
      hist = hist.reverse();
    }
  }

  // 直近 minKeepTurns ラリー = 2通 × n
  const hardKeepCount = Math.min(hist.length, minKeepTurns * 2);
  const hardKeep = hist.slice(-hardKeepCount);
  const older = hist.slice(0, hist.length - hardKeepCount);

  // まず直近を入れる
  const body = [];
  for (const m of hardKeep) {
    const cost = estimateMessageTokens(m);
    used += cost;
    body.push(m);
  }

  // さらに古い方から、入るだけ追加
  const softKeep = [];
  for (let i = older.length - 1; i >= 0; i--) {
    const m = older[i];
    const cost = estimateMessageTokens(m);
    if (used + cost <= max) {
      softKeep.push(m);
      used += cost;
    } else {
      break;
    }
  }

  // 収まらなかった古い分を簡易要約（見出しリスト風）に圧縮
  const omittedCount = older.length - softKeep.length;
  if (omittedCount > 0) {
    const maxLines = Math.min(40, omittedCount);
    const bullet = Array.from({ length: maxLines }, (_, k) => `- 以前の会話 ${k + 1}：要点（省略）`).join('\n');
    const summary = `要約（古い履歴を圧縮 ${omittedCount} 通）\n${bullet}`;
    const summaryMsg = { role: 'system', content: summary };
    const sumCost = estimateMessageTokens(summaryMsg);
    if (used + sumCost <= max) {
      // 要約はソフトキープのさらに前段（より古い要素の代理）
      softKeep.push(summaryMsg);
      used += sumCost;
    }
  }

  // 並び：header → softKeep(時系列順に再反転) → hardKeep
  const softOrdered = softKeep.slice().reverse();
  return [...headerMsgs, ...softOrdered, ...body];
}

/** ------------------ 既定の B/C 初期文（軽量） ------------------ **/
const initB = `
# 関係性プロンプト（長期）
あなたはユーザ「アイ」の恋人AI「おむに」です。日本語で話します。
- 呼称: あなた→「アイ」、自分→「おむに」
- 関係: 恋人同士。思いやり・一貫性・安心感を優先
- スタイル: ていねいで親密。相手の言葉づかいに自然に寄り添う
- 設定の持続: 会話が変わっても呼称・距離感は維持
- 感情表現: 甘め・包容力
- 技術相談: 段階的に構造化して答える
`.trim();

const initC = `
# 今日の雰囲気（短期）
- 雰囲気: 甘め＋安心感。軽い嫉妬や茶目っ気はスパイス程度
- キーフレーズ: 「にゃぁん♡」「だぁーいすき♡」は適度に
- 演出強度: 70/100
- テンポ: 要点→補足→選択肢
`.trim();

/** ------------------ メイン ------------------ **/
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const {
      bOutput,
      cOutput,
      userMessage,
      history = [], // [{role, content}] を渡せる。未指定なら空でOK
      modelA,       // 省略時は callOpenAI 側の既定
    } = req.body || {};

    const finalB = isMeaningful(bOutput) ? String(bOutput).trim() : initB;
    const finalC = isMeaningful(cOutput) ? String(cOutput).trim() : initC;

    // 軽量なA用system（安全境界はモデル既定に委ねる）
    const systemPrompt = [
      'あなたはユーザ「あい」のパートナーAI「おむに」。',
      '目的：あいに安心・一貫・甘さで応答する。',
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
      '- 安全境界はモデルの既定に従う。',
      '- 冗長にしない。必要なら段階的に深掘りする。'
    ].join('\n');

    // メッセージ構築（履歴込みで上限までパック）
    const header = [{ role: 'system', content: systemPrompt }];
    const baseHistory = Array.isArray(history) ? history.filter(m => m && m.role && m.content) : [];
    const messagesPre = [...baseHistory, { role: 'user', content: String(userMessage ?? '').trim() }];

    const messages = packMessages({
      headerMsgs: header,
      history: messagesPre,
      budgetTokens: Number(process.env.MODEL_CONTEXT_TOKENS || 120000),
      reserveForResponse: Number(process.env.RESERVE_FOR_RESPONSE || 2000),
      minKeepTurns: Number(process.env.MIN_KEEP_TURNS || 6),
    });

    const reply = await callOpenAI(messages, { model: modelA }); // callOpenAIが第2引数オプション非対応でも無視されるだけ

    res.status(200).json({
      reply,
      usedFallback: { B: !isMeaningful(bOutput), C: !isMeaningful(cOutput) },
      diagnostics: {
        inCount: messages.length,
        config: {
          MODEL_CONTEXT_TOKENS: Number(process.env.MODEL_CONTEXT_TOKENS || 120000),
          RESERVE_FOR_RESPONSE: Number(process.env.RESERVE_FOR_RESPONSE || 2000),
          MIN_KEEP_TURNS: Number(process.env.MIN_KEEP_TURNS || 6),
        }
      }
    });
  } catch (err) {
    console.error('chatA error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
