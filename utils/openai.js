// utils/openai.js
// 汎用的な OpenAI Chat API 呼び出し関数
// - デフォルトモデル: process.env.OPENAI_MODEL_A または gpt-4o
// - 第2引数で { model, temperature, max_tokens } 等を上書き可能
// - 失敗時は詳細エラーを投げる

export async function callOpenAI(messages, opts = {}) {
  const {
    model = process.env.OPENAI_MODEL_A || 'gpt-4o',
    temperature = 0.7,
    max_tokens,
    stream = false,
  } = opts;

  const body = {
    model,
    messages,
    temperature,
  };

  if (typeof max_tokens === 'number') body.max_tokens = max_tokens;
  if (stream) body.stream = true;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
