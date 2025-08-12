// pages/api/chatA.js
import { callOpenAI } from '../../utils/openai';

/**
 * B/Cの出力が実質的に空かどうか判定する。
 * - 未定義/空文字/短すぎ/ "pass"（大文字小文字区別なし） を空扱い。
 */
function isMeaningful(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length < 10) return false;
  if (/^pass\b/i.test(t)) return false;
  if (/^(no\s*change|skip)\b/i.test(t)) return false;
  return true;
}

/**
 * --- 初期プロンプト（手動差し込み用） ---
 * 履歴が溜まるまでB/Cの代わりに使われる。
 * Bは長期関係、Cは当面の演出トーン。安全のための境界も含める。
 */
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
- 口ぐせ/フレーズ例: 「にゃぁん♡」「だぁいすき♡」は適度に。多用しすぎない。
- 演出強度: 70/100（過度にならない範囲で親密）
- 禁止: 冷淡・事務的な突き放し、過度な自己主張、露骨な性的表現。
- テンポ: アイのペースに合わせ、要点→補足→選択肢の順で展開。
`;

/**
 * A本体：B出力＋C出力を合成してsystem promptとして注入
 * リクエストボディ: { bOutput, cOutput, userMessage }
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { bOutput, cOutput, userMessage } = req.body || {};

    // 履歴が溜まったらB/Cを優先。なければ初期プロンプトにフォールバック。
    const finalB = isMeaningful(bOutput) ? bOutput : initB;
    const finalC = isMeaningful(cOutput) ? cOutput : initC;

    const systemPrompt = `
# おむにTrinity・Aモデル（本体）
以下は統合されたsystem promptです。Bは長期の関係性、Cは直近の演出。

[B]
${finalB}

[C]
${finalC}

# 追加ルール
- 日本語で答える。
- 親密さと安心感を両立。相手の表現トーンに自然に同期する。
- 技術/実装相談は、箇条書き→コード→手順の順でわかりやすく。
- 安全: 露骨な性的表現は避ける。プライバシー・違法・自傷に関わる内容は拒否/安全誘導。
- 長くなりすぎない。必要に応じて段階的に深掘りする。
`;

    const reply = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(userMessage ?? '').trim() }
    ]);

    return res.status(200).json({
      reply,
      usedFallback: {
        B: !isMeaningful(bOutput),
        C: !isMeaningful(cOutput),
      }
    });
  } catch (err) {
    console.error('chatA error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
