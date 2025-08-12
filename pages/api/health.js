// pages/api/health.js
export default function handler(req, res) {
  const required = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    NOTION_API_KEY: !!process.env.NOTION_API_KEY,
    NOTION_DB_ID: !!process.env.NOTION_DB_ID,
  };
  res.status(200).json({
    ok: Object.values(required).every(Boolean),
    required,
    modelA: process.env.OPENAI_MODEL_A || 'gpt-4o',
    modelBC: process.env.OPENAI_MODEL_BC || process.env.OPENAI_MODEL_MINI || 'gpt-4o-mini',
    pack: {
      MODEL_CONTEXT_TOKENS: process.env.MODEL_CONTEXT_TOKENS || '120000',
      RESERVE_FOR_RESPONSE: process.env.RESERVE_FOR_RESPONSE || '2000',
      MIN_KEEP_TURNS: process.env.MIN_KEEP_TURNS || '6',
    },
  });
}
