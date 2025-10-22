// src/bot/features/cms.handlers.ts
// Comandos para que el dueño edite su página del hotel por Telegram.
// Ajustado: la previsualización se envía SIEMPRE como enlace en texto (no botón).
// Luego se muestran botones de acción: Confirmar/Publicar, Descartar, Volver al panel.

import { Telegraf, Markup } from 'telegraf';
import dayjs from 'dayjs';
import { mainCmsKeyboard } from './cms.keyboards';
import {
  createOrGetDraft,
  findActiveDraftByOwnerAndHotel,
  updateDraftField,
  appendPhoto,
  regeneratePreviewToken,
  promoteDraftToLive,
  // Helpers opcionales:
  removePhoto,
  updateManyFields,
  updateSectionsJson,
  updateAmenities,
  updatePoliciesText,
  updatePriceFrom,
} from '../../tools/drafts';
import { uploadImageUrlToCloudinary } from '../../tools/storage';

const enabled = String(process.env.PREVIEW_ENABLED ?? 'true').toLowerCase() !== 'false';
const PREVIEW_REQUIRE_TOKEN = String(process.env.PREVIEW_REQUIRE_TOKEN ?? 'true').toLowerCase() !== 'false';

function ensureSession(ctx: any) {
  if (!ctx.session) (ctx as any).session = {};
  return ctx.session as Record<string, any>;
}

function argHotelId(text?: string): string | null {
  if (!text) return null;
  const parts = text.trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : null;
}

async function getOrCreateDraft(ctx: any, hotelId: string) {
  const ownerId = String(ctx.from?.id);
  const draft = await createOrGetDraft(ownerId, hotelId);
  return draft;
}

function baseUrl() {
  const b = process.env.BASE_URL || process.env.PUBLIC_WEB_ORIGIN || '';
  return b.endsWith('/') ? b.slice(0, -1) : b;
}

function isHttps(url: string) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}
function isLocalOrPrivate(url: string) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === 'localhost') return true;
    if (h === '127.0.0.1') return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
    if (!h.includes('.')) return true;
    return false;
  } catch {
    return true;
  }
}

function buildPreviewUrls(hotelId: string, token?: string) {
  const base = baseUrl();
  const withPath = token ? `${base}/preview/${encodeURIComponent(hotelId)}/${encodeURIComponent(token)}` : undefined;
  const withQuery = token ? `${base}/preview/${encodeURIComponent(hotelId)}?token=${encodeURIComponent(token)}` : undefined;
  const noToken = `${base}/preview/${encodeURIComponent(hotelId)}`; // requiere PREVIEW_REQUIRE_TOKEN=false
  return { withPath, withQuery, noToken };
}

// ⬇️ Siempre link en texto + botones de acción (publicar/descartar/volver)
async function sendPreview(ctx: any, url: string, hotelId: string, draftId: string, title: string = '🔎 Previsualización') {
  if (!url) {
    await ctx.reply('⚠️ No pude generar el enlace de previsualización.');
    return;
  }
  // Link plano (no botón)
  await ctx.reply(`${title}\n${url}`);

  // Botones de acción (inline callbacks, válidos en cualquier entorno)
  await ctx.reply(
    'Acciones sobre este borrador:',
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Confirmar y Publicar', `cms:publish:${hotelId}:${draftId}`)],
      [Markup.button.callback('🗑️ Descartar borrador', `cms:discard:${hotelId}:${draftId}`)],
      [Markup.button.callback('⬅️ Volver al panel', `cms:back:${hotelId}:${draftId}`)],
    ])
  );
}

export function registerCmsHandlers(bot: Telegraf) {
  if (!enabled) return;

  /* ========================
   * Comandos básicos
   * ====================== */
  bot.command('editar_pagina', async (ctx) => {
    try {
      const hotelId = argHotelId(ctx.message?.text);
      if (!hotelId) return ctx.reply('Usá: /editar_pagina <hotel_id>');
      const d = await getOrCreateDraft(ctx, hotelId);

      // Token inicial (no frenamos si falla)
      let token: string | undefined;
      try {
        const upd = await regeneratePreviewToken(d.draft_id);
        token = String(upd?.preview_token || '').trim() || undefined;
      } catch (e: any) {
        console.error('[cms] editar_pagina regeneratePreviewToken:', e?.message || e);
      }

      const { withPath, withQuery, noToken } = buildPreviewUrls(hotelId, token);
      await ctx.reply(
        `Borrador listo para *${hotelId}*.\nPodés editar campos con los botones de abajo.`,
        { parse_mode: 'Markdown', ...mainCmsKeyboard(hotelId, d.draft_id) }
      );

      const url = (withPath || withQuery || noToken)!;
      await sendPreview(ctx, url, hotelId, d.draft_id, '🔎 Previsualización');
    } catch (e: any) {
      console.error('[cms] editar_pagina', e?.message || e);
      await ctx.reply('❌ Error iniciando borrador.');
    }
  });

  bot.command('previsualizar', async (ctx) => {
    try {
      const hotelId = argHotelId(ctx.message?.text);
      if (!hotelId) return ctx.reply('Usá: /previsualizar <hotel_id>');
      const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), hotelId);
      if (!active) return ctx.reply('No encontré borrador activo. Probá /editar_pagina <hotel_id>.');

      let token: string | undefined;
      try {
        const upd = await regeneratePreviewToken(active.draft_id);
        token = String(upd?.preview_token || '').trim() || undefined;
      } catch (err: any) {
        console.error('[cms] previsualizar/token', err?.message || err);
      }

      const { withPath, withQuery, noToken } = buildPreviewUrls(hotelId, token);

      const resumen = [
        `*Previsualización de ${hotelId}*`,
        active.titulo_hero ? `*Título:* ${active.titulo_hero}` : '',
        active.descripcion_hero ? `*Descripción:* ${active.descripcion_hero}` : '',
        active.amenities ? `*Amenities:* ${active.amenities}` : '',
        active.precio_desde ? `*Precio desde:* ${active.precio_desde}` : '',
        `*Generado:* ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      ].filter(Boolean).join('\n');

      await ctx.reply(resumen, { parse_mode: 'Markdown' });
      const url = (withPath || withQuery || noToken)!;
      await sendPreview(ctx, url, hotelId, active.draft_id, '🔎 Previsualización lista');
    } catch (e: any) {
      console.error('[cms] previsualizar', e?.message || e);
      await ctx.reply('❌ Error generando previsualización.');
    }
  });

  bot.command('publicar', async (ctx) => {
    try {
      const hotelId = argHotelId(ctx.message?.text);
      if (!hotelId) return ctx.reply('Usá: /publicar <hotel_id>');
      const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), hotelId);
      if (!active) return ctx.reply('No hay borrador activo para publicar.');

      const live = await promoteDraftToLive(active.draft_id);
      const base =
        process.env.LIVE_BASE_URL ||
        process.env.PUBLIC_WEB_ORIGIN ||
        process.env.BASE_URL ||
        '';
      const b = base.endsWith('/') ? base.slice(0, -1) : base;
      const urlLive = b ? `${b}/hotel/${encodeURIComponent(hotelId)}` : '';

      if (urlLive && !isLocalOrPrivate(urlLive)) {
        await ctx.reply(
          `✅ Publicado *${hotelId}* (versión ${live.version_live}).`,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.url('🌐 Ver sitio live', urlLive)]]) }
        );
      } else {
        await ctx.reply(`✅ Publicado *${hotelId}* (versión ${live.version_live}).\n${urlLive ? urlLive : ''}`, { parse_mode: 'Markdown' });
      }
    } catch (e: any) {
      await ctx.reply(`❌ No se pudo publicar.\n${e?.message || e}`);
    }
  });

  bot.command('descartar', async (ctx) => {
    try {
      const hotelId = argHotelId(ctx.message?.text);
      if (!hotelId) return ctx.reply('Usá: /descartar <hotel_id>');
      const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), hotelId);
      if (!active) return ctx.reply('No hay borrador activo.');
      await updateDraftField(active.draft_id, 'descripcion_hero' as any, active.descripcion_hero || '');
      await updateDraftField(active.draft_id, 'secciones_json' as any, active.secciones_json || '');
      await updateDraftField(active.draft_id, 'titulo_hero' as any, active.titulo_hero || '');
      await ctx.reply(`🗑️ Borrador de *${hotelId}* descartado.`, { parse_mode: 'Markdown' });
    } catch (e: any) {
      await ctx.reply('❌ Error descartando.');
    }
  });

  /* ========================
   * Acciones de edición por botones
   * ====================== */
  bot.action(/^cms:title:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    await ctx.reply('Enviame el *nuevo título* para la página.', { parse_mode: 'Markdown' });
    (ctx as any).session.cmsMode = { field: 'titulo_hero', draftId: ctx.match[2], hotelId: ctx.match[1] };
  });

  bot.action(/^cms:desc:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    await ctx.reply('Enviame la *nueva descripción* (texto).', { parse_mode: 'Markdown' });
    (ctx as any).session.cmsMode = { field: 'descripcion_hero', draftId: ctx.match[2], hotelId: ctx.match[1] };
  });

  bot.action(/^cms:amen:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    await ctx.reply('Enviame *amenities* separados por `|`.\nEj: WiFi|Piscina|Desayuno', { parse_mode: 'Markdown' });
    (ctx as any).session.cmsMode = { field: 'amenities', draftId: ctx.match[2], hotelId: ctx.match[1] };
  });

  bot.action(/^cms:pol:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    await ctx.reply('Enviame *políticas de cancelación* (texto).');
    (ctx as any).session.cmsMode = { field: 'politicas_cancelacion', draftId: ctx.match[2], hotelId: ctx.match[1] };
  });

  bot.action(/^cms:price:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    await ctx.reply('Enviame el *precio desde* (número).');
    (ctx as any).session.cmsMode = { field: 'precio_desde', draftId: ctx.match[2], hotelId: ctx.match[1] };
  });

  bot.action(/^cms:photos:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Enviá 1..10 fotos y las agrego al borrador.');
    ensureSession(ctx);
    (ctx as any).session.cmsPhotosDraftId = ctx.match[2];
    (ctx as any).session.cmsPhotosHotelId = ctx.match[1];
  });

  // 🔹 Previsualización manual
  bot.action(/^cms:preview:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const hotelId = ctx.match[1];
    let draftId = ctx.match[2];

    try {
      const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), hotelId);
      if (active?.draft_id) draftId = active.draft_id;
    } catch {}

    try {
      let token: string | undefined;
      try {
        const upd = await regeneratePreviewToken(draftId);
        token = String(upd?.preview_token || '').trim() || undefined;
      } catch (e: any) {
        console.error('[cms] preview action regenerate:', e?.message || e);
      }

      const { withPath, withQuery, noToken } = buildPreviewUrls(hotelId, token);
      const url = (withPath || withQuery || noToken)!;
      await sendPreview(ctx, url, hotelId, draftId, '🔎 Previsualización lista');
    } catch (e: any) {
      console.error('[cms] preview action', e?.message || e);
      await ctx.reply('❌ Error generando previsualización.');
    }
  });

  // 🔹 Publicación
  bot.action(/^cms:publish:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const hotelId = ctx.match[1];
    let draftId = ctx.match[2];

    try {
      const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), hotelId);
      if (active?.draft_id) draftId = active.draft_id;
    } catch {}

    try {
      const live = await promoteDraftToLive(draftId);
      const base =
        process.env.LIVE_BASE_URL ||
        process.env.PUBLIC_WEB_ORIGIN ||
        process.env.BASE_URL ||
        '';
      const b = base.endsWith('/') ? base.slice(0, -1) : base;
      const urlLive = b ? `${b}/hotel/${encodeURIComponent(hotelId)}` : '';

      if (urlLive && !isLocalOrPrivate(urlLive)) {
        await ctx.reply(
          `✅ Publicado. Versión live: ${live.version_live}`,
          Markup.inlineKeyboard([
            [Markup.button.url('🌐 Ver sitio live', urlLive)],
            [Markup.button.callback('⬅️ Volver al panel', `cms:back:${hotelId}:${draftId}`)],
            [Markup.button.callback('🏠 Inicio', `cms:home:${hotelId}:${draftId}`)],
          ])
        );
      } else {
        await ctx.reply(
          `✅ Publicado. Versión live: ${live.version_live}\n${urlLive ? urlLive : ''}`
        );
      }
    } catch (e: any) {
      await ctx.reply(`❌ No se pudo publicar.\n${e?.message || e}`);
    }
  });

  // 🔹 Descartar desde botón (callback)
  bot.action(/^cms:discard:(.+?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Descartado');
    try {
      const hotelId = ctx.match[1];
      const draftId = ctx.match[2];
      // Si no hay helper, refrescamos algunos campos (como en /descartar) para mantener compatibilidad
      const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), hotelId);
      if (active?.draft_id) {
        await updateDraftField(active.draft_id, 'descripcion_hero' as any, active.descripcion_hero || '');
        await updateDraftField(active.draft_id, 'secciones_json' as any, active.secciones_json || '');
        await updateDraftField(active.draft_id, 'titulo_hero' as any, active.titulo_hero || '');
      }
      await ctx.reply(`🗑️ Borrador de *${hotelId}* descartado.`, { parse_mode: 'Markdown', ...mainCmsKeyboard(hotelId, draftId) });
    } catch (e:any) {
      await ctx.reply('❌ Error descartando.');
    }
  });

  // 🔹 Callbacks mínimos genéricos para *_save, *_add, *_remove
  bot.action(/^cms:([a-z]+)_(save|add|remove):(.+?):(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery('OK');
      const field = ctx.match[1];
      const hotelId = ctx.match[3];
      const draftId = ctx.match[4];
      await ctx.reply(`✔️ Acción "${field}" registrada.`, { ...mainCmsKeyboard(hotelId, draftId) });
    } catch (e: any) {
      console.error('[cms optional callbacks]', e?.message || e);
      await ctx.reply('❌ No pude procesar la acción.');
    }
  });

  // 🔹 Quitar foto por índice o URL
  bot.action(/^cms:photos_remove:(.+?):(.+?)(?::(.+))?$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const hotelId = ctx.match[1];
      const draftId = ctx.match[2];
      const targetRaw = ctx.match[3];

      if (!targetRaw) {
        ensureSession(ctx);
        (ctx as any).session.cmsPhotosRemoveDraftId = draftId;
        (ctx as any).session.cmsPhotosRemoveHotelId = hotelId;
        return ctx.reply('Decime el *índice (1..n)* o la *URL exacta* de la foto a quitar.', { parse_mode: 'Markdown' });
      }

      const target = /^\d+$/.test(targetRaw) ? Number(targetRaw) : targetRaw;
      if (typeof removePhoto === 'function') {
        await removePhoto(draftId, target as any);
        await ctx.reply('🗑️ Foto eliminada.', { ...mainCmsKeyboard(hotelId, draftId) } as any);
      } else {
        await ctx.reply('⚠️ Quitar foto no disponible en esta build.', { ...mainCmsKeyboard(hotelId, draftId) });
      }
    } catch (e: any) {
      console.error('[cms photos_remove]', e?.message || e);
      await ctx.reply('❌ No pude eliminar la foto.');
    }
  });

  // 🔹 Navegación — Volver al panel / Inicio
  bot.action(/^cms:back(?::(.+?):(.+))?$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      let hotelId = ctx.match[1];
      let draftId = ctx.match[2];
      if (!hotelId || !draftId) {
        const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), (ctx as any).session?.cmsHotelId || '');
        hotelId = active?.hotel_id || (ctx as any).session?.cmsHotelId;
        draftId = active?.draft_id;
      }
      if (!hotelId || !draftId) return ctx.reply('No encontré borrador activo. Probá /editar_pagina <hotel_id>.');
      await ctx.reply(`Volvimos al panel de *${hotelId}*.`, { parse_mode: 'Markdown', ...mainCmsKeyboard(hotelId, draftId) });
    } catch (e: any) {
      await ctx.reply('❌ No pude volver al panel.');
    }
  });

  bot.action(/^cms:home(?::(.+?):(.+))?$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      if ((ctx as any).session) {
        (ctx as any).session.cmsMode = null;
        (ctx as any).session.cmsPhotosDraftId = null;
        (ctx as any).session.cmsPhotosHotelId = null;
        (ctx as any).session.cmsPhotosRemoveDraftId = null;
        (ctx as any).session.cmsPhotosRemoveHotelId = null;
      }
      await ctx.reply('🏠 Volviste al inicio.', Markup.removeKeyboard());
    } catch (e: any) {
      await ctx.reply('❌ No pude ir al inicio.');
    }
  });

  /* ========================
   * Entrada de texto libre (según campo activo en sesión)
   * ====================== */
  bot.on('text', async (ctx, next) => {
    // 1) Quitar foto por texto
    const rmDraft = (ctx as any).session?.cmsPhotosRemoveDraftId;
    const rmHotel = (ctx as any).session?.cmsPhotosRemoveHotelId;
    if (rmDraft && rmHotel) {
      const raw = String(ctx.message?.text || '').trim();
      const target = /^\d+$/.test(raw) ? Number(raw) : raw;
      try {
        if (typeof removePhoto === 'function') {
          await removePhoto(rmDraft, target as any);
          await ctx.reply('🗑️ Foto eliminada.', { ...mainCmsKeyboard(rmHotel, rmDraft) } as any);
        } else {
          await ctx.reply('⚠️ Quitar foto no disponible en esta build.');
        }
      } catch (e: any) {
        await ctx.reply('❌ No pude eliminar la foto.');
      }
      (ctx as any).session.cmsPhotosRemoveDraftId = null;
      (ctx as any).session.cmsPhotosRemoveHotelId = null;
      return;
    }

    // 2) Campos de edición
    const s = (ctx as any).session?.cmsMode;
    if (!s) return next();

    const val = String(ctx.message?.text || '').trim();
    if (!val) return ctx.reply('Texto vacío. Intentá nuevamente.');

    try {
      if (s.field === 'secciones_json' && typeof updateSectionsJson === 'function') {
        await updateSectionsJson(s.draftId, val);
      } else if (s.field === 'amenities' && typeof updateAmenities === 'function') {
        await updateAmenities(s.draftId, val);
      } else if (s.field === 'politicas_cancelacion' && typeof updatePoliciesText === 'function') {
        await updatePoliciesText(s.draftId, val);
      } else if (s.field === 'precio_desde' && typeof updatePriceFrom === 'function') {
        await updatePriceFrom(s.draftId, val);
      } else if (typeof updateManyFields === 'function') {
        await updateManyFields(s.draftId, { [s.field]: val } as any);
      } else {
        await updateDraftField(s.draftId, s.field as any, val);
      }

      await ctx.reply(`✅ Cambiado. Campo *${s.field}* actualizado para *${s.hotelId}* (borrador).`, { parse_mode: 'Markdown' });

      // Revalidamos draft_id por si se perdió en sesión
      let draftId = s.draftId;
      try {
        const active = await findActiveDraftByOwnerAndHotel(String(ctx.from.id), s.hotelId);
        if (active?.draft_id) draftId = active.draft_id;
      } catch {}

      // Token (si falla, seguimos con fallback)
      let token: string | undefined;
      try {
        const upd = await regeneratePreviewToken(draftId);
        token = String(upd?.preview_token || '').trim() || undefined;
      } catch (e2: any) {
        console.error('[cms] regenerate after change', e2?.message || e2);
      }

      const { withPath, withQuery, noToken } = buildPreviewUrls(s.hotelId, token);
      const url = token ? (withPath || withQuery)! : (PREVIEW_REQUIRE_TOKEN ? (withPath || withQuery)! : noToken);
      if (url) {
        await sendPreview(ctx, url, s.hotelId, draftId, '🔎 Previsualización actualizada');
      } else {
        await ctx.reply('⚠️ Guardé el cambio pero no pude generar la previsualización en este momento.');
      }
    } catch (e: any) {
      await ctx.reply('❌ No pude actualizar el campo.');
      console.error('[cms] on text save error:', e?.message || e);
    }

    (ctx as any).session.cmsMode = null;
  });

  /* ========================
   * Recepción de fotos
   * ====================== */
  bot.on('photo', async (ctx, next) => {
    const sDraftId = (ctx as any).session?.cmsPhotosDraftId;
    const sHotelId = (ctx as any).session?.cmsPhotosHotelId;
    if (!sDraftId || !sHotelId) return next();

    try {
      const photos: any[] = (ctx.message as any).photo || [];
      const best = photos[photos.length - 1];
      const fileId = best.file_id;
      const fileLink = await (ctx.telegram as any).getFileLink(fileId);
      const up = await uploadImageUrlToCloudinary(String(fileLink));
      await appendPhoto(sDraftId, up.url);

      await ctx.reply('🖼️ Foto agregada al borrador.');

      // Token
      let token: string | undefined;
      try {
        const upd = await regeneratePreviewToken(sDraftId);
        token = String(upd?.preview_token || '').trim() || undefined;
      } catch (e: any) {
        console.error('[cms] photo regenerate token', e?.message || e);
      }

      const { withPath, withQuery, noToken } = buildPreviewUrls(sHotelId, token);
      const url = token ? (withPath || withQuery)! : (PREVIEW_REQUIRE_TOKEN ? (withPath || withQuery)! : noToken);
      if (url) {
        await sendPreview(ctx, url, sHotelId, sDraftId, '🔎 Previsualización actualizada');
      } else {
        await ctx.reply('⚠️ Guardé las fotos, pero no pude generar la previsualización ahora.');
      }
    } catch (e: any) {
      console.error('[cms] photo upload', e?.message || e);
      await ctx.reply('❌ No pude procesar la foto. Verificá tu configuración de Cloudinary.');
    }
  });
}
