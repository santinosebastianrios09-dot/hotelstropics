// mvp_AGENTS/src/adapters/telegram.ts
import { Telegraf, Markup, session } from 'telegraf';
import { getConfig } from '../tools/config';
import {
  recomputeAllTotals,
  updateReservationStatus,
  getSummary,
  getNext7DaysPanel,
} from '../tools/sheets';
import { analyzeText } from '../tools/aintegrity';
import { createBarChartUrl, createLineChartUrl } from '../tools/charts';

// NUEVO (CMS): handlers de edición por Telegram (borrador → preview → publicación)
import { registerCmsHandlers } from '../bot/features/cms.handlers';

// ===== CARGA ROBUSTA DE MÓDULOS OPCIONALES (named o default) =====
let createOrGetDraft:
  | undefined
  | ((ownerId: string, hotelId: string) => Promise<{ draft_id: string }>);
let mainCmsKeyboard:
  | undefined
  | ((hotelId: string, draftId: string) => ReturnType<typeof Markup.InlineKeyboard>);

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const d = require('../tools/drafts');
  createOrGetDraft = d.createOrGetDraft ?? d.default?.createOrGetDraft;
} catch (_) {
  // silencioso
}
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const k = require('../bot/features/cms.keyboards');
  mainCmsKeyboard = k.mainCmsKeyboard ?? k.default?.mainCmsKeyboard;
} catch (_) {
  // silencioso
}

// 🔹 NUEVO: obtener el hotel_id automáticamente desde la hoja `hotel_live`
let getPrimaryHotelIdFromLive: undefined | (() => Promise<string | null>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const d2 = require('../tools/drafts');
  getPrimaryHotelIdFromLive = d2.getPrimaryHotelIdFromLive ?? d2.default?.getPrimaryHotelIdFromLive;
} catch (_) {
  // opcional
}

const cfg = getConfig();
const PREVIEW_ENABLED = /^true$/i.test(String(process.env.PREVIEW_ENABLED || 'false'));

// 🔹 ID por defecto para flujo rápido por botones
const DEFAULT_HOTEL_ID = String(process.env.DEFAULT_HOTEL_ID || 'HT-001');

/** ---------------- Permisos (admins) ---------------- */
function parseAdmins(): string[] {
  try {
    const s = (cfg.ADMIN_USER_IDS || '').trim();
    return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
  } catch { return []; }
}
function isAdmin(userId?: number | string | null): boolean {
  if (!userId) return false;
  return parseAdmins().includes(String(userId));
}

/** ---------------- Helper de sesión seguro ---------------- */
function ensureSession(ctx: any) {
  if (!ctx.session) (ctx as any).session = {};
  return ctx.session as Record<string, any>;
}

/** ---------------- Teclado y botones ---------------- */
const BTN_RESERVA = '➕ Nueva reserva';
const BTN_RESUMEN = '📊 Resumen';
const BTN_DISPO   = '📅 Disponibilidad';
const BTN_FIX     = '🔁 Recalcular totales';
const BTN_ESTADO  = '✏️ Cambiar estado';
const BTN_AYUDA   = '❓ Ayuda';
const BTN_EDIT    = '🛠️ Editar página';
const BTN_HOTEL_AUTO = '📌 Mi Hotel (Sheets)';

const CB_USE_DEFAULT_HOTEL = 'cms:use_default_hotel';
const CB_ENTER_OTHER_HOTEL = 'cms:enter_other_hotel';

const mainMenu = () =>
  Markup.keyboard([
    [BTN_RESUMEN, BTN_DISPO],
    [BTN_FIX, BTN_AYUDA],
    [BTN_EDIT]
  ]).resize();

/** Helper: enviar Markdown + mantener teclado */
async function replyMD(ctx: any, text: string) {
  return ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenu().reply_markup });
}

/** ---------------- Util: pretty print para “Próximos 7 días” ---------------- */
function prettifyNext7DaysPanel(raw: string): string {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return raw;

  const headerIdx = lines.findIndex(l => /^Habitación\b/i.test(l));
  if (headerIdx === -1) return raw;

  const header = lines[headerIdx];
  const dateTokens = (header.match(/\b\d{2}\/\d{2}\b/g) || []);
  if (dateTokens.length === 0) return raw;

  const range = `${dateTokens[0]} – ${dateTokens[dateTokens.length - 1]}`;

  const roomLines = lines.slice(headerIdx + 1);
  const out: string[] = [];
  out.push('📅 Ocupación (próximos 7 días)');
  out.push(range);
  out.push('');

  const joinDays = (days: string[]) => {
    if (days.length === 1) return days[0];
    if (days.length === 2) return `${days[0]} y ${days[1]}`;
    return `${days.slice(0, -1).join(', ')} y ${days[days.length - 1]}`;
  };

  for (const row of roomLines) {
    const numbers = (row.match(/-?\d+/g) || []).map(n => Number(n));
    if (numbers.length !== dateTokens.length) continue;

    const firstNumPos = row.search(/-?\d+/);
    const roomName = row.substring(0, firstNumPos).trim().replace(/\s+/g, ' ');

    const totalDays = numbers.length;
    const occupiedIdx: number[] = [];
    let anyFree = false;

    numbers.forEach((val, i) => {
      if (val <= 0) occupiedIdx.push(i);
      else anyFree = true;
    });

    let line: string;
    if (occupiedIdx.length === 0 && anyFree) {
      line = `🛏️ ${roomName} → Libre todos los días`;
    } else if (occupiedIdx.length === totalDays) {
      line = `🏨 ${roomName} → 100% ocupada`;
    } else {
      const days = occupiedIdx.map(i => dateTokens[i].split('/')[0]);
      line = `🏠 ${roomName} → ${occupiedIdx.length} noche${occupiedIdx.length > 1 ? 's' : ''} ocupada${occupiedIdx.length > 1 ? 's' : ''} (${joinDays(days)})`;
    }

    out.push(line);
  }

  return out.join('\n');
}

/** ---------------- Acciones reutilizables ---------------- */
async function actionResumen(ctx: any) {
  if (!isAdmin(ctx.from?.id)) return;
  try {
    const s: any = await getSummary();

    const totalBookings   = Number(s?.bookings ?? s?.totalBookings ?? 0);
    const confirmed       = Number(s?.confirmed ?? 0);
    const pending         = Number(s?.pending ?? 0);
    const canceled        = Number(s?.canceled ?? 0);
    const revenue         = Number(s?.revenue ?? 0);
    const occupancy       = Number(s?.occupancy ?? 0);

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd   = new Date(Date.UTC(y, m + 1, 0));
    const pad = (n: number) => String(n).padStart(2, '0');
    const span = `${pad(monthStart.getUTCDate())}/${pad(monthStart.getUTCMonth()+1)}/${monthStart.getUTCFullYear()}–${pad(monthEnd.getUTCDate())}/${pad(monthEnd.getUTCMonth()+1)}/${monthEnd.getUTCFullYear()}`;

    const monthBookings   = Number(s?.month?.bookings ?? 0);
    const monthRevenue    = Number(s?.month?.revenue  ?? 0);
    const monthOccupancy  = Number(s?.month?.occupancy ?? 0);
    const monthNights     = Number(s?.month?.nights ?? 0);
    const monthCapacity   = Number(s?.month?.capacity ?? 0);

    const next7Raw = await getNext7DaysPanel();
    const next7Pretty = prettifyNext7DaysPanel(next7Raw);

    const msg1 = [
      '📊 Resumen general',
      '',
      `• *Reservas:* ${totalBookings}`,
      `• *Estados:* Confirmadas ${confirmed} · Pendientes ${pending} · Canceladas ${canceled}`,
      `• *Ingresos (USD):* $${revenue}`,
      `• *Ocupación global:* ${occupancy.toFixed(2)}%`,
      '',
      `🗓️ *Periodo actual:* ${span}`,
      '',
      '📈 *KPIs del mes*',
      `• *Total de reservas:* ${monthBookings}`,
      `• *Ingresos:* $${monthRevenue}`,
      `• *Ocupación:* ${monthOccupancy.toFixed(2)}%`,
      '',
      '*Detalles*',
      `• Noches reservadas: ${monthNights}`,
      `• Capacidad (hab × días): ${monthCapacity}`,
    ].join('\n');

    await replyMD(ctx, msg1);

    // Gráficas (si hay datos)
    const trendUrl    = s?.trend    ? createLineChartUrl(s.trend)   : '';
    const topRoomsUrl = s?.topRooms ? createBarChartUrl(s.topRooms) : '';
    if (trendUrl)    await ctx.reply(`Tendencia ingresos: ${trendUrl},`, { reply_markup: mainMenu().reply_markup });
    if (topRoomsUrl) await ctx.reply(`Top habitaciones: ${topRoomsUrl}`, { reply_markup: mainMenu().reply_markup });

    await ctx.reply(next7Pretty, { reply_markup: mainMenu().reply_markup });
  } catch (e: any) {
    await ctx.reply(`❌ Error al generar resumen: ${e?.message || e}`, { reply_markup: mainMenu().reply_markup });
  }
}

// ====== IMPORTS PARA GRÁFICOS (se registran DENTRO de makeBot) ======
import { getDailySalesSeries, getInteractionsVsBookingsSeries, getRoomsSummarySeries } from '../tools/sheets';

/** ---------------- Construcción del bot ---------------- */
export function makeBot() {
  if (!cfg.TELEGRAM_BOT_TOKEN) {
    throw new Error('Falta TELEGRAM_BOT_TOKEN en el entorno');
  }
  const bot = new Telegraf(cfg.TELEGRAM_BOT_TOKEN, { handlerTimeout: 60_000 });

  // NUEVO: estado de sesión (necesario para los wizards de edición CMS)
  bot.use(session());

  bot.start(async (ctx) => {
    const uid = ctx.from?.id;
    if (!isAdmin(uid)) {
      return ctx.reply('Este bot es solo para administradores.', Markup.removeKeyboard());
    }
    await ctx.reply('Bienvenido 👋', mainMenu());
  });

  bot.hears(BTN_AYUDA, async (ctx) => {
    await showHelp(ctx);
  });

  /** ----- Menú de gráficos (inline) ----- */
  const chartsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📈 Ventas diarias', 'chart:sales')],
    [Markup.button.callback('🔁 Interacciones vs Reservas', 'chart:funnel')],
    [Markup.button.callback('🛏️ Resumen por habitación', 'chart:rooms')],
    [Markup.button.callback('🏷️ KPIs', 'chart:kpis')],
    [Markup.button.callback('📊 Mostrar todos', 'chart:all')],
  ]);

  // Helpers de normalización para aceptar distintas formas de datos sin romper nada
  const normSales = (s: any) => {
    // admite: {labels, values} o [{date,count},...]
    const labels = Array.isArray(s) ? s.map((d: any) => d.date) : (s?.labels ?? []);
    const values = Array.isArray(s) ? s.map((d: any) => Number(d.count ?? 0)) : (s?.values ?? []);
    return { labels, values };
  };
  const normFunnel = (s: any) => {
    // admite: {labels, interactions, bookings} o [{date,interactions,bookings},...]
    const labels = Array.isArray(s) ? s.map((d: any) => d.date) : (s?.labels ?? []);
    const interactions = Array.isArray(s) ? s.map((d: any) => Number(d.interactions ?? 0)) : (s?.interactions ?? []);
    const bookings = Array.isArray(s) ? s.map((d: any) => Number(d.bookings ?? 0)) : (s?.bookings ?? []);
    return { labels, interactions, bookings };
  };
  const normRooms = (s: any) => {
    // admite: {labels, bookings} o [{room,count},...]
    const labels = Array.isArray(s) ? s.map((r: any) => r.room) : (s?.labels ?? []);
    const bookings = Array.isArray(s) ? s.map((r: any) => Number(r.count ?? 0)) : (s?.bookings ?? []);
    return { labels, bookings };
  };

  /** ---------------- 📊 RESUMEN / KPIs ---------------- */
  bot.hears(BTN_RESUMEN, async (ctx) => { await ctx.reply('Elegí qué querés ver:', chartsKeyboard); });

  /** ---------------- 📅 Disponibilidad (próximos 7 días) ---------------- */
  bot.hears(BTN_DISPO, async (ctx) => { return actionDisponibilidad(ctx); });

  /** ---------------- Recompute ---------------- */
  bot.hears(BTN_FIX, async (ctx) => { return actionRecompute(ctx); });

  /** ---------------- Cambiar estado (handler oculto; botón NO está en menú) ---------------- */
  bot.hears(BTN_ESTADO, async (ctx) => { return actionPromptEstado(ctx); });

  // ========= Handlers de gráficos (DENTRO de makeBot) =========

  // KPIs (usa tu resumen actual, mantiene comportamiento)
  bot.action('chart:kpis', async (ctx) => {
    await ctx.answerCbQuery();
    await actionResumen(ctx);
  });

  // Mostrar todos (resumen completo)
  bot.action('chart:all', async (ctx) => {
    await ctx.answerCbQuery();
    await actionResumen(ctx);
  });

  // Ventas diarias (últimos 14 días)
  bot.action('chart:sales', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const raw = await getDailySalesSeries(14);
      const s = normSales(raw);
      if (!s.labels?.length) {
        return ctx.reply('No hay ventas en los últimos días.', { reply_markup: chartsKeyboard.reply_markup });
      }
      const url = createLineChartUrl('Ventas diarias (últimos 14 días)', s.labels, { label: 'Ventas', data: s.values });
      await ctx.replyWithPhoto(url, { reply_markup: chartsKeyboard.reply_markup });
    } catch (e:any) {
      await ctx.reply('❌ No pude generar el gráfico de ventas.', { reply_markup: chartsKeyboard.reply_markup });
    }
  });

  // Interacciones vs Reservas (últimos 14 días)
  bot.action('chart:funnel', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const raw = await getInteractionsVsBookingsSeries(14);
      const s = normFunnel(raw);
      if (!s.labels?.length) {
        return ctx.reply('No hay datos de interacciones/reservas.', { reply_markup: chartsKeyboard.reply_markup });
      }
      const url = createBarChartUrl(
        'Interacciones vs Reservas (14 días)',
        s.labels,
        { label: 'Interacciones', data: s.interactions },
        { label: 'Reservas', data: s.bookings },
      );
      await ctx.replyWithPhoto(url, { reply_markup: chartsKeyboard.reply_markup });
    } catch (e:any) {
      await ctx.reply('❌ No pude generar el gráfico de interacciones vs reservas.', { reply_markup: chartsKeyboard.reply_markup });
    }
  });

  // Resumen por habitación (mes actual)
  bot.action('chart:rooms', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const raw = await getRoomsSummarySeries();
      const s = normRooms(raw);
      if (!s.labels?.length) {
        return ctx.reply('No hay reservas para el mes actual.', { reply_markup: chartsKeyboard.reply_markup });
      }
      const url = createBarChartUrl(
        'Reservas por habitación (mes)',
        s.labels,
        { label: 'Reservas', data: s.bookings },
      );
      await ctx.replyWithPhoto(url, { reply_markup: chartsKeyboard.reply_markup });
    } catch (e:any) {
      await ctx.reply('❌ No pude generar el resumen por habitación.', { reply_markup: chartsKeyboard.reply_markup });
    }
  });

  // Helper local reutilizable para abrir el panel CMS de un hotel
  async function openPanelFor(ctx: any, ownerId: string, hotelId: string) {
    // NUEVO: intentamos cargar módulos antes de caer en el fallback
    await ensureCmsModulesLoaded();

    if (createOrGetDraft && mainCmsKeyboard) {
      const draft = await createOrGetDraft(ownerId, hotelId);
      // guardamos en sesión para futuros toques de los botones
      ctx.session = { ...(ctx.session || {}), cmsHotelId: hotelId, awaitingHotelIdForEdit: false };
      return ctx.reply(
        `Borrador listo para *${hotelId}*.\nUsá los botones para editar.`,
        { parse_mode: 'Markdown', ...mainCmsKeyboard(hotelId, draft.draft_id) }
      );
    }
    // Fallback: no rompemos nada, guiamos a comando existente
    console.warn('[CMS shortcuts] Módulos opcionales no disponibles. Usá comandos /editar_pagina, /previsualizar, /publicar.');
    return ctx.reply(
      [
        `No encontré módulos de atajo (usá comandos).`,
        `• Ejecutá: /editar_pagina ${hotelId}`,
        `• Luego: /previsualizar ${hotelId} · /publicar ${hotelId}`,
      ].join('\n'),
      { reply_markup: mainMenu().reply_markup }
    );
  }

  // NUEVO: 🛠️ Editar página → abre DIRECTO HT-001 (o DEFAULT_HOTEL_ID) y ofrece cambiar
  bot.hears(BTN_EDIT, async (ctx: any) => {
    try {
      if (!isAdmin(ctx.from?.id)) return ctx.reply('Este botón es solo para administradores.');
      if (!PREVIEW_ENABLED) {
        return ctx.reply(
          'La edición por Telegram está deshabilitada (PREVIEW_ENABLED=false).\nPodés usar los comandos /editar_pagina, /previsualizar, /publicar.',
          { reply_markup: mainMenu().reply_markup }
        );
      }

      const ownerId = String(ctx.from.id);
      const sessionHotel: string | undefined = ctx.session?.cmsHotelId ? String(ctx.session.cmsHotelId) : undefined;

      // Si ya hay hotel en sesión, abrimos ese; si no, abrimos DIRECTO el default (HT-001)
      await openPanelFor(ctx, ownerId, sessionHotel || DEFAULT_HOTEL_ID);

      // Ofrecemos opcionalmente cambiar de hotel
      const kb = Markup.inlineKeyboard([[Markup.button.callback('Ingresar otro hotel', CB_ENTER_OTHER_HOTEL)]]);
      await ctx.reply('¿Querés editar otro hotel?', kb);
    } catch (e: any) {
      console.error('[BTN_EDIT]', e?.message || e);
      await ctx.reply('❌ No pude abrir el editor.', { reply_markup: mainMenu().reply_markup });
    }
  });

  // 👉 Usar hotel por defecto (handler conservado para compatibilidad)
  bot.action(CB_USE_DEFAULT_HOTEL, async (ctx: any) => {
    try {
      if (!isAdmin(ctx.from?.id)) return;
      await ctx.answerCbQuery(); // cierra spinner
      if (!PREVIEW_ENABLED) {
        return ctx.reply(
          'La edición por Telegram está deshabilitada (PREVIEW_ENABLED=false).',
          { reply_markup: mainMenu().reply_markup }
        );
      }
      const ownerId = String(ctx.from.id);
      await openPanelFor(ctx, ownerId, DEFAULT_HOTEL_ID);
    } catch {
      // silencio
    }
  });

  // 👉 Pedir hotel_id (solo si quiere otro)
  bot.action(CB_ENTER_OTHER_HOTEL, async (ctx: any) => {
    try {
      if (!isAdmin(ctx.from?.id)) return;
      await ctx.answerCbQuery();
      ensureSession(ctx).awaitingHotelIdForEdit = true;
      await ctx.reply('Decime el *hotel_id* que querés editar (ej.: H001).', { parse_mode: 'Markdown' });
    } catch {
      // silencio
    }
  });

  // 🔹 NUEVO: Atajo para tomar automáticamente el hotel_id desde hoja `hotel_live`
  bot.hears(BTN_HOTEL_AUTO, async (ctx: any) => {
    try {
      if (!isAdmin(ctx.from?.id)) return ctx.reply('Este botón es solo para administradores.');
      if (!PREVIEW_ENABLED) {
        return ctx.reply(
          'La edición por Telegram está deshabilitada (PREVIEW_ENABLED=false).\nPodés usar los comandos /editar_pagina, /previsualizar, /publicar.',
          { reply_markup: mainMenu().reply_markup }
        );
      }
      if (!getPrimaryHotelIdFromLive) {
        // Intentar cargar en caliente si no está
        await ensureCmsModulesLoaded();
      }
      if (!getPrimaryHotelIdFromLive) {
        return ctx.reply('La función automática no está disponible en esta build.', { reply_markup: mainMenu().reply_markup });
      }

      const ownerId = String(ctx.from.id);
      const autoHotel = await getPrimaryHotelIdFromLive();
      if (!autoHotel) {
        return ctx.reply('No encontré hotel en la hoja *hotel_live*.', { parse_mode: 'Markdown', reply_markup: mainMenu().reply_markup });
      }
      await openPanelFor(ctx, ownerId, autoHotel);
    } catch (e: any) {
      console.error('[BTN_HOTEL_AUTO]', e?.message || e);
      await ctx.reply('❌ No pude abrir el editor automáticamente.', { reply_markup: mainMenu().reply_markup });
    }
  });

  // Capturar el siguiente mensaje como hotel_id para el editor (antes del relay/catch-all)
  bot.on('text', async (ctx: any, next: Function) => {
    try {
      if (!isAdmin(ctx.from?.id)) return next();
      if (!ctx.session?.awaitingHotelIdForEdit) return next();

      const txt = String(ctx.message?.text || '').trim();
      const hotelId = txt.split(/\s+/)[0];
      if (!hotelId) {
        ensureSession(ctx).awaitingHotelIdForEdit = false;
        await ctx.reply('No entendí el hotel_id.', { reply_markup: mainMenu().reply_markup });
        return; // no continuar
      }

      // guardamos en sesión para futuros toques del botón
      ensureSession(ctx).awaitingHotelIdForEdit = false;
      ensureSession(ctx).cmsHotelId = hotelId;

      if (!PREVIEW_ENABLED) {
        return ctx.reply(
          `Recibí *${hotelId}*, pero la edición está deshabilitada.\nUsá /editar_pagina ${hotelId}`,
          { parse_mode: 'Markdown', reply_markup: mainMenu().reply_markup }
        );
      }

      const ownerId = String(ctx.from.id);
      await openPanelFor(ctx, ownerId, hotelId);
      return; // manejado
    } catch (e: any) {
      console.error('[capturar hotel_id editar]', e?.message || e);
      await ctx.reply('❌ Hubo un problema creando el borrador.', { reply_markup: mainMenu().reply_markup });
      return; // no continuar
    }
  });

  // Tolerancia a texto escrito manualmente y comandos slash
  bot.hears(/^(?:\/resumen|resumen|resuemen|📊\s*resumen)$/i, async (ctx) => actionResumen(ctx));
  bot.command('resumen', async (ctx) => actionResumen(ctx));

  bot.hears(/^(?:\/disponibilidad|disponibilidad|📅\s*disponibilidad)$/i, async (ctx) => actionDisponibilidad(ctx));
  bot.command('disponibilidad', async (ctx) => actionDisponibilidad(ctx));

  bot.hears(/^(?:\/recalcular|\/fix|recalcular(?:\s+totales)?|🔁\s*recalcular(?:\s+totales)?)$/i, async (ctx) => actionRecompute(ctx));
  bot.command('fix', async (ctx) => actionRecompute(ctx));

  bot.hears(/^(?:\/estado|cambiar\s+estado|✏️\s*cambiar\s*estado)$/i, async (ctx) => actionPromptEstado(ctx));
  bot.command('estado', async (ctx) => actionPromptEstado(ctx));

  bot.hears(/^(?:\/ayuda|ayuda|❓\s*ayuda)$/i, async (ctx) => showHelp(ctx));
  bot.command('ayuda', async (ctx) => showHelp(ctx));

  // Atajo para mostrar el menú
  bot.command('menu', async (ctx) => ctx.reply('Menú', mainMenu()));

  /** ---------------- NUEVO: botón inline "Responder al cliente" ---------------- */
  bot.action(/^reply:(tok_[A-Za-z0-9._-]+)/, async (ctx: any) => {
    if (!isAdmin(ctx.from?.id)) return;
    try {
      const token = ctx.match[1];
      await ctx.answerCbQuery(); // cierra el spinner del botón
      await ctx.reply(
        `Responder al cliente\nToken: ${token}\n✍️ Escribí tu respuesta y enviala en este mismo hilo.`,
        { reply_markup: { force_reply: true } }
      );
    } catch {
      // silencio
    }
  });

  // NUEVO: si llega el texto "Usa /responder tok_XXXX ..." lo convertimos en botón
  bot.hears(/Usa\s*\/responder\s+(tok_[A-Za-z0-9._-]+)/i, async (ctx: any) => {
    if (!isAdmin(ctx.from?.id)) return;
    const token = (ctx.match as RegExpMatchArray)[1];
    const kb = Markup.inlineKeyboard([[Markup.button.callback('Responder al cliente', `reply:${token}`)]]);
    await ctx.reply('Responder al cliente', kb);
  });

  /** =========================================================
   *  RELAY por REPLY (PRIORIDAD)
   *  ========================================================= */
  bot.on('text', async (ctx: any, next: Function) => {
    try {
      if (!isAdmin(ctx.from?.id)) return next();

      const msg = ctx.message as any;
      const repliedText: string | undefined = msg?.reply_to_message?.text;

      // ¿Es un reply a “Responder al cliente … Token: tok_…”?
      const token = extractTokenFromText(repliedText);
      if (!token) return next();

      const respuesta = String(msg?.text || '').trim();
      if (!respuesta) {
        await ctx.reply('Escribí la respuesta del huésped en el mismo mensaje de reply.');
        return; // no continuar
      }

      const apiBase = getWebBase();
      const resp = await fetch(`${apiBase}/api/web/relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, respuesta }),
      });

      if (!resp.ok) {
        await ctx.reply(`❌ No pude enviar al sitio (HTTP ${resp.status}).`, mainMenu());
        return; // no continuar
      }

      await ctx.reply('✅ Enviado al huésped.', mainMenu());
      return; // manejado, no seguir al catch-all
    } catch (e: any) {
      await ctx.reply(`❌ Error en relay: ${e?.message || e}`, mainMenu());
      return; // no continuar
    }
  });

  // —— Registrar handlers CMS (edición por Telegram) antes del catch-all —— //
  if (PREVIEW_ENABLED) {
    registerCmsHandlers(bot);
    console.log('🧩 CMS (preview) habilitado en Telegram.');
  } else {
    console.log('🧩 CMS (preview) deshabilitado (PREVIEW_ENABLED=false).');
  }

  /** ---------------- CATCH-ALL ---------------- */
  bot.on('text', async (ctx) => {
    const uid = ctx.from?.id;
    if (!isAdmin(uid)) return;
    const t = (ctx.message?.text || '').trim();

    if (/^\d+\s+(approved|pending|canceled)$/i.test(t)) {
      const [id, st] = t.split(/\s+/, 2);
      try {
        await updateReservationStatus(id, st as any);
        await ctx.reply(`✅ Estado de ${id} → ${st}`, { reply_markup: mainMenu().reply_markup });
      } catch (e: any) {
        await ctx.reply(`❌ No pude actualizar: ${e?.message || e}`, { reply_markup: mainMenu().reply_markup });
      }
      return;
    }

    if (t === BTN_RESERVA) {
      try {
        const msg = 'Este bot es para managers. Las reservas se realizan en el **Agente Web** de la página del hotel.';
        try { await analyzeText('Nueva reserva'); } catch { /* ignorar */ }
        await ctx.reply(`🧭 ${msg}`, { reply_markup: mainMenu().reply_markup });
      } catch (err: any) {
        await ctx.reply(`❌ Error al mostrar guía de reserva: ${err?.message || err}`, { reply_markup: mainMenu().reply_markup });
      }
      return;
    }

    await showHelp(ctx);
  });

  async function showHelp(ctx: any) {
    await ctx.reply(
      [
        'Comandos y opciones:',
        '• 📊 Resumen → KPIs + gráficas + próximos 7 días',
        '• 📅 Disponibilidad → próximos 7 días',
        '• 🔁 Recalcular totales',
        '• ✏️ Cambiar estado → "ID ESTADO"',
        '• 🛠️ Editar página → abre el panel CMS directamente (HT-001 por defecto) y podés cambiarlo',
        '• 📌 Mi Hotel (Sheets) → usa el hotel_id de la hoja hotel_live automáticamente',
        ...(PREVIEW_ENABLED ? [
          '',
          'CMS (edición por comandos, por si hiciera falta):',
          '• /editar_pagina <hotel_id>',
          '• /previsualizar <hotel_id>',
          '• /publicar <hotel_id> · /descartar <hotel_id>',
        ] : []),
        '',
        'Responder consultas del sitio:',
        '• Tocá "Responder al cliente" y escribí tu mensaje (sin copiar comandos).',
      ].join('\n'),
      mainMenu()
    );
  }

  return bot;
}

export function launchBot() {
  const bot = makeBot();
  bot.launch();
  console.log('Telegram bot lanzado.');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// -------- Utilities usadas más arriba --------
async function actionDisponibilidad(ctx: any) {
  if (!isAdmin(ctx.from?.id)) return;
  try {
    const panelRaw = await getNext7DaysPanel();
    const panel = prettifyNext7DaysPanel(panelRaw);
    await ctx.reply(panel, { reply_markup: mainMenu().reply_markup });
  } catch (e: any) {
    await ctx.reply(`❌ Error al cargar disponibilidad: ${e?.message || e}`, { reply_markup: mainMenu().reply_markup });
  }
}

async function actionRecompute(ctx: any) {
  if (!isAdmin(ctx.from?.id)) return;
  try {
    const result = await recomputeAllTotals();
    await ctx.reply(`🔁 Totales recomputados.\n${result.summary}`, { reply_markup: mainMenu().reply_markup });
  } catch (e: any) {
    await ctx.reply(`❌ Error al recomputar: ${e?.message || e}`, { reply_markup: mainMenu().reply_markup });
  }
}

async function actionPromptEstado(ctx: any) {
  if (!isAdmin(ctx.from?.id)) return;
  await ctx.reply('Enviá: ID <espacio> ESTADO (approved|pending|canceled)', { reply_markup: mainMenu().reply_markup });
}

function getWebBase(): string {
  return (
    process.env.WEB_BASE_URL ||
    process.env.PUBLIC_WEB_ORIGIN ||
    `http://localhost:${process.env.PORT || 8080}`
  );
}
function extractTokenFromText(text?: string): string | null {
  if (!text) return null;
  const m = text.match(/\b(tok_[A-Za-z0-9_]+)\b/);
  return m ? m[1] : null;
}

/** ----------- NUEVO: importación en caliente de módulos CMS ----------- */
async function ensureCmsModulesLoaded() {
  // Si ya están, no hacemos nada
  if (createOrGetDraft && mainCmsKeyboard) return;
  try {
    const d = await import('../tools/drafts');
    createOrGetDraft = (d as any).createOrGetDraft ?? (d as any).default?.createOrGetDraft ?? createOrGetDraft;
    getPrimaryHotelIdFromLive = (d as any).getPrimaryHotelIdFromLive ?? (d as any).default?.getPrimaryHotelIdFromLive ?? getPrimaryHotelIdFromLive;
  } catch { /* silencioso */ }
  try {
    const k = await import('../bot/features/cms.keyboards');
    mainCmsKeyboard = (k as any).mainCmsKeyboard ?? (k as any).default?.mainCmsKeyboard ?? mainCmsKeyboard;
  } catch { /* silencioso */ }
}
