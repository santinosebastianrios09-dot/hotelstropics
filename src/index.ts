// mvp_AGENTS/src/index.ts
import 'dotenv/config';
import { makeBot, launchBot } from './adapters/telegram';
import { registerWebRelay } from './bot/features/webRelay';
import { registerCmsHandlers } from './bot/features/cms.handlers';

function mask(v?: string) {
  if (!v) return '(vacío)';
  if (v.length <= 8) return '****';
  return v.slice(0, 4) + '****' + v.slice(-4);
}

(async () => {
  try {
    // ─────────────────────────────────────────────────────────────
    // 1) Arranque del BOT de Telegram
    // ─────────────────────────────────────────────────────────────
    console.log('➡️  Arrancando bot (index.ts)…');
    const bot = await makeBot();

    // Features existentes
    registerWebRelay(bot);

    // ─────────────────────────────────────────────────────────────
    // 2) Habilitar CMS (borrador → previsualización → publicar)
    // ─────────────────────────────────────────────────────────────
    const previewEnabled = String(process.env.PREVIEW_ENABLED || 'true').toLowerCase() === 'true';
    if (previewEnabled) {
      registerCmsHandlers(bot);
      console.log('🧩 CMS (preview) habilitado en Telegram.');
    } else {
      console.log('🧩 CMS (preview) deshabilitado (PREVIEW_ENABLED=false).');
    }

    // ─────────────────────────────────────────────────────────────
    // 3) *** CLAVE ***: levantar el servidor web (Express)
    //    Esto sirve la ruta GET /preview/:hotelId?token=...
    //    para que el botón “Ver previsualización” funcione.
    //    (El server hace app.listen() al importarse)
    // ─────────────────────────────────────────────────────────────
    if (previewEnabled) {
      await import('./web/server');
      console.log('🌐 Servidor web iniciado (preview.route activo).');
      const base = process.env.PUBLIC_WEB_ORIGIN || process.env.BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
      console.log('🌐 Base URL:', base);
    }

    // ─────────────────────────────────────────────────────────────
    // 4) Lanzar el bot y mantener el proceso vivo
    // ─────────────────────────────────────────────────────────────
    await launchBot(bot);
    console.log('🤖 Telegram bot lanzado y escuchando mensajes...');

    // Señales
    process.once('SIGINT', () => {
      console.log('🔻 SIGINT recibido, deteniendo bot…');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      console.log('🔻 SIGTERM recibido, deteniendo bot…');
      bot.stop('SIGTERM');
    });

    // Errores globales
    process.on('unhandledRejection', (reason: any) => {
      console.error('⚠️  UnhandledRejection:', reason?.message || reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('⚠️  UncaughtException:', err?.message || err);
    });

  } catch (err: any) {
    console.error('❌ Error al lanzar el bot:', err?.message || err);
    process.exit(1);
  }
})();
