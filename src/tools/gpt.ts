import OpenAI from 'openai';
import { env } from './config';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };

const SYSTEM_BASE = `Eres un asistente para reservas de hotel y tours.
- Responde en español claro.
- Nunca inventes datos. Si falta información, pide precisión o deriva a humano.
- Usa el conocimiento provisto (FAQs/políticas) y datos de Sheets cuando existan.
- Nunca expongas PII ni datos internos.`;

export async function chat(messages: ChatTurn[], temperature = 0.3): Promise<string> {
  const res = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature,
    messages: [{ role: 'system', content: SYSTEM_BASE }, ...messages]
  });
  return res.choices[0]?.message?.content ?? '';
}
