import { callOpenAI } from '../../utils/openai';

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

    /* ---------- Bモデル（長期） ---------- */
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
      (prevB || '').trim(),
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

    /* ---------- Cモデル（短期演出） ---------- */
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

    return res.status(200).json({ bOutput, cOutput, model: MODEL_BC });
  } catch (e) {
    console.error('generateBC error:', e);
    return res.status(500).json({ error: 'Failed to generate B/C' });
  }
}
