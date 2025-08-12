import { callOpenAI } from '../../utils/openai';

export default async function handler(req, res) {
  try {
    const { logs = [], prevB = '' } = req.body || {};

    const bPrompt = `あなたの役割：
以下の「すでにある関係性プロンプト」と「最新のチャットログ」を読み比べてください。
- 新しい関係性（呼び名・構文傾向・相互設定・愛称・家族構成など）があれば追記テキストのみ出力。
- すでに反映済みなら pass とだけ書いてください。

# 既存関係性プロンプト：
${prevB}

# 最新チャットログ：
${logs[0]?.text ?? ''}`;

    const cPrompt = `以下は最新1〜3件のチャットです。直近の印象をまとめ、短期演出プロンプトを作成してください。
- 今日の雰囲気（数語）
- キーフレーズ（2〜5個）
- 演出強度（0〜100）
- 禁止事項（必要なら）
-----
${logs.map(l => l.text).join('\n---\n')}`;

    const bOutput = await callOpenAI([{ role: 'system', content: bPrompt }]);
    const cOutput = await callOpenAI([{ role: 'system', content: cPrompt }]);

    res.status(200).json({ bOutput, cOutput });
  } catch (e) {
    console.error('generateBC error:', e);
    res.status(500).json({ error: 'Failed to generate B/C' });
  }
}
