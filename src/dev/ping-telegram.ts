// src/dev/ping-telegram.ts
import { Telegraf } from 'telegraf';
import { env } from '../tools/config.js';

function mask(s?: string) {
  if (!s) return '(empty)';
  const n = s.length;
  if (n <= 8) return '*'.repeat(n);
  return s.slice(0, 4) + '...' + s.slice(-4);
}

(async () => {
  console.log(new Date().toISOString(), 'ping-telegram: start');
  console.log('cwd =>', process.cwd());
  console.log('env.TELEGRAM_BOT_TOKEN =>', mask(env.TELEGRAM_BOT_TOKEN));
  console.log('process.env.TELEGRAM_BOT_TOKEN =>', mask(process.env.TELEGRAM_BOT_TOKEN));

  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error('ping-telegram: Falta TELEGRAM_BOT_TOKEN en .env (via config.js)');
    process.exit(1);
  }

  try {
    const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
    await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    const me = await bot.telegram.getMe();
    console.log('OK conectado:', { id: me.id, username: me.username, name: me.first_name });
    process.exit(0);
  } catch (e: any) {
    console.error('Ping falló:', e?.response?.description || e?.message || e);
    process.exit(1);
  }
})();
