// src/dev/print-env.ts
import { env } from '../tools/config.js';

function mask(s?: string) {
  if (!s) return '(empty)';
  const n = s.length;
  if (n <= 8) return '*'.repeat(n);
  return s.slice(0, 4) + '...' + s.slice(-4);
}

console.log('ENV FLAGS =>');
console.log({
  TELEGRAM_ENABLED: env.TELEGRAM_ENABLED,
  ALLOW_GROUP_CHATS: env.ALLOW_GROUP_CHATS,
  SHEETS_ENABLED: env.SHEETS_ENABLED,
  CHARTS_ENABLED: env.CHARTS_ENABLED
});
console.log('TOKEN   =>', mask(process.env.TELEGRAM_BOT_TOKEN));
console.log('ADMINID =>', process.env.TELEGRAM_ADMIN_CHAT_ID || '(empty)');
