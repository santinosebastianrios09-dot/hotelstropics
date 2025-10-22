// src/tools/permissions.ts
import type { Context, MiddlewareFn } from 'telegraf';

export const requireAdmin: MiddlewareFn<Context> = async (ctx, next) => {
  const admins = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const userId = String(ctx.from?.id || '');
  if (!admins.includes(userId)) {
    await ctx.reply('⛔ Esta acción es solo para administradores.');
    return;
  }
  return next();
};
