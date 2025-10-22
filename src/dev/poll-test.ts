import 'dotenv/config';
import { Telegraf } from 'telegraf';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Falta TELEGRAM_BOT_TOKEN en .env');
  process.exit(1);
}

async function main() {
  console.log('[poll-test] getMe →', await new Telegraf(token).telegram.getMe().catch(e => e));

  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply('Bot OK (poll-test)'));
  bot.on('text', (ctx) => ctx.reply('Recibido (poll-test)'));

  // 🔧 Forzar modo polling: eliminar webhook en Telegram
  try {
    const res = await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('[poll-test] deleteWebhook →', res);
  } catch (e) {
    console.log('[poll-test] deleteWebhook error →', e);
  }

  console.log('[poll-test] launching polling…');
  await bot.launch();            // ← si hay red OK, debería resolver
  console.log('[poll-test] polling started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((e) => {
  console.error('[poll-test] fatal:', e);
  process.exit(1);
});
