// mvp_AGENTS/src/tools/notifier.ts
import { Telegram } from 'telegraf';

function parseAdmins(): string[] {
  const raw =
    process.env.ADMIN_USER_IDS?.trim() ||
    process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || // fallback (uno solo)
    '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const tg = telegramToken ? new Telegram(telegramToken) : null;

export async function notifyAdmins(text: string) {
  try {
    if (!tg) return;
    const admins = parseAdmins();
    if (!admins.length) return;
    await Promise.allSettled(admins.map(id => tg.sendMessage(id, text)));
  } catch {
    // no romper el flujo por errores de notificación
  }
}
