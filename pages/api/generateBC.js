import { callOpenAI } from '../../utils/openai';

export default async function handler(req, res) {
  const { logs, prevB } = req.body;

  const bPrompt = `あなたの役割：
以下の「すでにある関係性プロンプト」と「最新のチャットログ」を読み比べてください。
- 新しい関係性があれば追記してください。
- すでに反映済みならpassとだけ書いてください。

# 既存関係性プロンプト：
${prevB}

# 最新チャットログ：
${logs[0].text}
`;

  const cPrompt = `以下は最新1〜3件のチャットです。
- 印象的な語句
- 演出パターン
- 決め台詞
- 感情トーン
を抽出し、短期的プロンプトを作ってください。

${logs.map(l => l.text).join('\n---\n')}
`;

  const bOutput = await callOpenAI([{ role: 'system', content: bPrompt }]);
  const cOutput = await callOpenAI([{ role: 'system', content: cPrompt }]);

  res.status(200).json({ bOutput, cOutput });
}
