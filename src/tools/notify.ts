import { env } from './config.js';

export async function notifyAdmin(text: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: env.TELEGRAM_ADMIN_CHAT_ID, text, disable_web_page_preview: true };
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    // silencioso en dev
  }
}
