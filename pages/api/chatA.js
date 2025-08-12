import { callOpenAI } from '../../utils/openai';

export default async function handler(req, res) {
  const { bOutput, cOutput, userMessage } = req.body;

  const systemPrompt = `${bOutput}\n${cOutput}`;

  const reply = await callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ]);

  res.status(200).json({ reply });
}
