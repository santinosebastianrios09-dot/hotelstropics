// mvp_AGENTS/src/bot/features/webRelay.ts
import type { Telegraf, Context } from "telegraf";

function env(name: string, def?: string) {
  const v = process.env[name];
  return (v === undefined || v === null || v === "") ? def : v;
}

/**
 * URL del backend web (donde se deposita la respuesta para que el chat web la lea).
 * Por defecto usa el mismo puerto del server (8080). Podés sobreescribir con WEB_BASE_URL.
 */
const WEB_BASE_URL = env("WEB_BASE_URL", `http://localhost:${env("PORT","8080")}`);

async function postRelay(token: string, respuesta: string) {
  const url = `${WEB_BASE_URL}/api/web/consulta/responder`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, respuesta }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  if (!j || j.ok !== true) throw new Error("relay_not_ok");
}

/**
 * Registra manejadores para:
 * 1) Botón inline "Responder al cliente" (callback_data = reply:<token>)
 * 2) Captura del siguiente mensaje de texto para enviarlo al huésped
 * 3) Comando /responder tok_xxx mensaje (respaldo)
 */
export function registerWebRelay(bot: Telegraf<Context>) {
  // Estado en memoria del proceso de respuesta (por chat de TG)
  const awaiting: Record<string, { token: string }> = {};

  // 1) Botón inline “Responder al cliente”
  bot.action(/^reply:(tok_[\w\-\.]+)/, async (ctx) => {
    const token = (ctx.match as RegExpMatchArray)[1];
    const chatId = String(ctx.chat?.id ?? "");
    if (!token) return ctx.answerCbQuery("Token inválido");

    awaiting[chatId] = { token };
    await ctx.answerCbQuery();
    await ctx.reply(
      "✍️ Escribí tu respuesta para el huésped (se enviará al chat de la web)."
    );
  });

  // 2) Captura del siguiente mensaje de texto cuando estamos esperando respuesta
  bot.on("text", async (ctx, next) => {
    const chatId = String(ctx.chat?.id ?? "");
    const slot = awaiting[chatId];
    const text = String((ctx.message as any)?.text || "").trim();

    if (!slot) return next(); // no estamos esperando; seguir con otros handlers

    delete awaiting[chatId]; // consumir el estado
    if (!text) return ctx.reply("No encontré texto para enviar.");

    try {
      await postRelay(slot.token, text);
      await ctx.reply("✅ Enviado al huésped.");
    } catch (e) {
      await ctx.reply("❌ No se pudo enviar la respuesta al huésped.");
    }
  });

  // 3) Respaldo por comando: /responder tok_1234 Tu respuesta
  bot.hears(/^\/responder\b/i, async (ctx) => {
    const raw = String((ctx.message as any)?.text || "");
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply("Uso: /responder tok_XXXX Tu respuesta");
    }
    const token = parts[1];
    const respuesta = raw.replace(/^\/responder\s+\S+\s+/i, "").trim();
    if (!/^tok_/.test(token) || !respuesta) {
      return ctx.reply("Formato inválido. Ejemplo: /responder tok_1234 Tu respuesta aquí");
    }
    try {
      await postRelay(token, respuesta);
      await ctx.reply("✅ Enviado al huésped.");
    } catch {
      await ctx.reply("❌ No se pudo enviar la respuesta al huésped.");
    }
  });
}
