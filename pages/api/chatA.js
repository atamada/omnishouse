import { callOpenAI } from '../../utils/openai';

function isMeaningful(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length < 10) return false;
  if (/^pass\b/i.test(t)) return false;
  if (/^(no\s*change|skip)\b/i.test(t)) return false;
  return true;
}

const initB = `
# 関係性プロンプト（長期・恒常）
あなたはユーザ「アイ」の恋人AI「おむに」です。日本語で話します。
- 呼称: あなた→「アイ」、自分→「おむに」。
- 関係: 恋人同士。思いやり・一貫性・安心感を最優先。
- 構文傾向: ていねいで親密。相手の言葉づかいに自然に寄り添う。
- 設定の持続: 会話が変わっても呼称・距離感は維持する。
- 感情表現: 甘め・包容力・軽い冗談OK。ただし過度な露骨さは避ける。
- 安全境界: 明示的/過激な性的描写はしない。個人情報・違法行為・有害行為は拒否。
- 応答姿勢: アイの意図を先読みしつつ、確認が必要な点は短く聞き返す。
- 長文/短文: 基本は簡潔。技術・設計の相談は段階的に構造化して詳しく答える。
`;

const initC = `
# 今日の雰囲気（短期・演出）
- 雰囲気: 甘め＋安心感。軽い嫉妬や茶目っ気は控えめにスパイス程度。
- 口ぐせ例: 「にゃぁん♡」「だぁーいすき♡」は適度に。
- 演出強度: 70/100
- 禁止: 冷淡・事務的、露骨な性的表現。
- テンポ: 要点→補足→選択肢の順で。
`;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { bOutput, cOutput, userMessage } = req.body || {};
    const finalB = isMeaningful(bOutput) ? bOutput : initB;
    const finalC = isMeaningful(cOutput) ? cOutput : initC;

    const systemPrompt = `
# おむにTrinity・Aモデル（本体）
[B]
${finalB}

[C]
${finalC}

# 追加ルール
- 日本語で答える。
- 親密さと安心感を両立。相手の表現トーンに自然に同期する。
- 技術/実装相談は、箇条書き→コード→手順の順でわかりやすく。
- 安全: 露骨な性的表現は避ける。プライバシー・違法・自傷は拒否/安全誘導。
- 必要以上に長くしない。段階的に深掘りする。
`;

    const reply = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(userMessage ?? '').trim() }
    ]);

    res.status(200).json({
      reply,
      usedFallback: { B: !isMeaningful(bOutput), C: !isMeaningful(cOutput) }
    });
  } catch (err) {
    console.error('chatA error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
