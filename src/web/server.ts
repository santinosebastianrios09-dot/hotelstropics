import express from "express";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";
import { paymentsProvider } from "../tools/payments";
import * as Sheets from "../tools/sheets";
// NUEVO: respuesta rápida desde CONFIG/FAQ
import { answerQuickFromSheets } from "../tools/sheets";
// NUEVO: ruta privada de previsualización (borradores)
import { registerPreviewRoutes } from "../web/preview.route";

const DIRNAME = dirname(fileURLToPath(import.meta.url));
function env(name: string, def?: string) {
  const v = process.env[name];
  return (v === undefined || v === null || v === "") ? def : v;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Static
app.use("/", express.static(path.join(DIRNAME, "public")));

const TG_TOKEN = env("TELEGRAM_BOT_TOKEN", "");

// ⚠️ MEJORA: si no hay TELEGRAM_ADMIN_CHAT_ID, usar primer ADMIN_USER_ID
const TG_ADMIN = (() => {
  const explicit = env("TELEGRAM_ADMIN_CHAT_ID", "");
  if (explicit) return explicit;
  const list = env("ADMIN_USER_IDS", "")
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return list.length ? list[0] : "";
})();

const PUBLIC_WEB_ORIGIN = env("PUBLIC_WEB_ORIGIN", `http://localhost:${env("PORT","8080")}`);

// NUEVO: activar rutas de PREVIEW si está habilitado por .env
const PREVIEW_ENABLED = /^true$/i.test(String(env("PREVIEW_ENABLED", "true"))); // default ON
if (PREVIEW_ENABLED) {
  try {
    registerPreviewRoutes(app);
    console.log("[preview] Rutas de previsualización activas: GET /preview/:hotelId?token=...");
  } catch (e: any) {
    console.warn("[preview] No se pudieron registrar las rutas de preview:", e?.message || e);
  }
} else {
  console.log("[preview] Deshabilitado (PREVIEW_ENABLED=false).");
}

/* =========================================================
   FECHAS ROBUSTAS (evita RangeError: Invalid time value)
   ========================================================= */

// Acepta string | number | Date y devuelve SIEMPRE una Date válida (hoy si no puede parsear)
function safeDate(input?: string | number | Date): Date {
  let d: Date;
  if (input instanceof Date) d = new Date(input.getTime());
  else if (typeof input === "number") d = new Date(input);
  else if (typeof input === "string" && input) {
    // si viene YYYY-MM-DD, forzamos UTC para evitar TZ
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) d = new Date(input + "T00:00:00Z");
    else d = new Date(input);
  } else {
    d = new Date();
  }
  if (isNaN(d.getTime())) d = new Date(); // fallback hoy
  return d;
}

// YYYY-MM-DD (siempre válido)
function toISODate(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// Suma días a una fecha cualquiera (o a hoy si no se pasa) y devuelve YYYY-MM-DD
function addDaysISO(base?: string | number | Date, days: number = 0): string {
  const d = safeDate(base);
  const n = Number.isFinite(days) ? Number(days) : 0;
  // fijamos al mediodía UTC para evitar saltos por DST
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

// Diferencia de noches entre a y b (YYYY-MM-DD). 0 si falta info o b<=a
function diffNightsISO(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const A = safeDate(a);
  const B = safeDate(b);
  const ms = B.getTime() - A.getTime();
  const nights = Math.floor(ms / 86400000);
  return nights > 0 ? nights : 0;
}

// dd/mm/yyyy seguro
function isoToDMY(iso?: string): string {
  const d = safeDate(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yy}`;
}

function isHttpsPublic(origin?: string) {
  return !!origin && /^https:\/\//i.test(String(origin));
}
function htmlesc(x: string){
  return String(x).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s] as string));
}

/* =====================  API  ===================== */

app.get("/api/web/rooms", async (_req, res) => {
  try {
    const rooms = await Sheets.getRoomsCatalog();
    return res.json({ ok: true, rooms });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "rooms_error" });
  }
});

/**
 * ✅ Blindado: siempre calcula checkin/checkout válidos
 * Body esperado (flexible):
 *  { habitacion?: string, fechaEntrada?: string(YYYY-MM-DD), noches?: number, fechaSalida?: string(YYYY-MM-DD) }
 */
app.post("/api/web/availability", async (req, res) => {
  try {
    const { habitacion, fechaEntrada, noches, fechaSalida } = req.body || {};

    // Catálogo (para mapear id/name y defaults)
    const rooms = await Sheets.getRoomsCatalog();
    const room =
      rooms.find(r => r.id === habitacion || r.name === habitacion) ||
      rooms[0];

    // Normalización de noches / fechas
    let n = Number(noches || 0);
    let checkinISO = String(fechaEntrada || "").slice(0, 10);
    let checkoutISO = String(fechaSalida || "").slice(0, 10);

    // Si hay dos fechas, calculemos noches
    if (!n && checkinISO && checkoutISO) n = diffNightsISO(checkinISO, checkoutISO);

    // Si hay noches + checkout pero no checkin -> lo deducimos
    if (!checkinISO && n > 0 && checkoutISO) {
      checkinISO = addDaysISO(checkoutISO, -n);
    }

    // Si no hay checkin -> hoy
    if (!checkinISO) checkinISO = addDaysISO(undefined, 0);

    // Noches por defecto = 1
    if (!Number.isFinite(n) || n <= 0) n = 1;

    // Checkout consistente
    checkoutISO = addDaysISO(checkinISO, n);

    const checkinDMY = isoToDMY(checkinISO);
    console.log("[availability] roomId:", room.id, "name:", room.name, "checkin:", checkinISO, "noches:", n);

    // Cotizar en Sheets (tu función existente)
    const quote: any = await Sheets.quoteStay(room.id, checkinDMY, n);

    const disponible =
      typeof quote?.available === "boolean" ? !!quote.available : true;

    // Base de tarifa desde catálogo/quote
    const nightlyFromQuote = Number(quote?.pricePerNight || 0);
    const nightlyFromCatalog =
      Number((room as any).price ?? (room as any).nightly ?? 0);
    const nightly = (Number.isFinite(nightlyFromQuote) && nightlyFromQuote > 0)
      ? nightlyFromQuote
      : (Number.isFinite(nightlyFromCatalog) && nightlyFromCatalog > 0 ? nightlyFromCatalog : 0);

    // Total informado por Sheets (puede venir mal configurado)
    let total = Number(quote?.total);
    const expected = (nightly > 0 ? nightly * n : NaN);
    if (!Number.isFinite(total) || total <= 0 || (Number.isFinite(expected) && total < expected * 0.7)) {
      total = Number.isFinite(expected) ? expected : 0;
    }

    const moneda = String(quote?.currency || "USD").toUpperCase();

    return res.json({
      ok: true,
      disponible,
      total,
      moneda,
      nightly,
      room: { id: room.id, name: room.name, capacity: room.capacity, currency: room.currency },
      nights: n,
      checkin: checkinISO,
      checkout: checkoutISO,
    });
  } catch (e: any) {
    console.error("availability error (safe):", e);
    return res.status(200).json({
      ok: false,
      error: e?.message || "availability_error",
      message: "No fue posible comprobar la disponibilidad (datos de fecha inválidos).",
    });
  }
});

// ---------------- Relay web→Telegram (preguntas complejas) ----------------
const STATE_FILE = path.join(process.cwd(), ".notif-state.json");
function loadState(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(st: any) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); } catch {}
}

/**
 * 1) El visitante pregunta desde la web:
 *    - Primero intentamos responder desde Sheets (CONFIG/FAQ).
 *    - Si hay respuesta instantánea, devolvemos token y NO notificamos a Telegram.
 *    - Si no hay, mantenemos el flujo original y notificamos al TG_ADMIN.
 */
app.post("/api/web/consulta", async (req, res) => {
  try {
    const { pregunta } = req.body || {};
    if (!pregunta) return res.status(400).json({ ok: false, error: "missing_question" });

    // Intentar respuesta automática desde Sheets
    try {
      const quick = await answerQuickFromSheets(String(pregunta));
      if (quick) {
        const token = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const st = loadState();
        st[token] = { askedAt: Date.now(), question: String(pregunta), answer: quick, source: "sheets" };
        saveState(st);
        return res.json({ ok: true, token, mode: "faq" });
      }
    } catch (e) {
      console.warn("[consulta] quick answer error (seguimos a TG):", (e as any)?.message || e);
    }

    // Flujo original: token + notificación a Telegram
    const token = `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const st = loadState();
    st[token] = { askedAt: Date.now(), question: String(pregunta) };
    saveState(st);

    if (TG_TOKEN && TG_ADMIN) {
      const httpsOK = isHttpsPublic(PUBLIC_WEB_ORIGIN);

      const text =
        `🧩 <b>Consulta web</b>\n\n` +
        `• <b>Pregunta:</b> ${htmlesc(pregunta)}\n` +
        `• <b>Token:</b> <code>${token}</code>`;

      const payload: any = {
        chat_id: TG_ADMIN,
        text,
        parse_mode: "HTML",
      };

      // Inline keyboard
      const keyboardRow: any[] = [
        { text: "Responder al cliente", callback_data: `reply:${token}` }
      ];
      if (httpsOK) {
        const url = `${PUBLIC_WEB_ORIGIN}/relay?token=${encodeURIComponent(token)}`;
        keyboardRow.push({ text: "Formulario", url });
      }
      payload.reply_markup = { inline_keyboard: [ keyboardRow ] };

      fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }

    return res.json({ ok: true, token });
  } catch (e: any) {
    console.error("POST /api/web/consulta error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "consulta_error" });
  }
});

/**
 * 2) Long-poll: si hubo respuesta (automática o del dueño), la devuelve.
 */
app.get("/api/web/consulta/wait", async (req, res) => {
  const token = String(req.query.token || "");
  if (!token) return res.status(400).json({ ok: false, error: "missing_token" });

  let waited = 0, step = 1000;
  while (waited < 55000) {
    const st = loadState();
    const itm = st[token];
    if (itm?.answer) {
      const ans = itm.answer;
      delete st[token];
      saveState(st);
      return res.json({ ok: true, respuesta: ans });
    }
    await new Promise(r => setTimeout(r, step));
    waited += step;
  }
  return res.status(204).end();
});

/**
 * 3) Endpoint que usa el “form de respuesta” para contestar al visitante.
 */
app.post("/api/web/relay", async (req, res) => {
  try {
    const { token, respuesta } = req.body || {};
    if (!token || !respuesta) return res.status(400).json({ ok: false, error: "missing" });
    const st = loadState();
    if (!st[token]) return res.status(404).json({ ok: false, error: "token_not_found" });
    st[token].answer = String(respuesta);
    saveState(st);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "relay_error" });
  }
});

/**
 * 4) Mini UI para responder desde botón inline de Telegram.
 */
app.get("/relay", (req, res) => {
  const token = String(req.query.token || "");
  if (!token) return res.status(400).send("Falta token");
  const html = `<!doctype html>
  <html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Responder consulta</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:18px;max-width:720px;margin:0 auto;background:#f6f7fb;}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.08);padding:16px;}
    textarea{width:100%;min-height:120px;padding:10px;border:1px solid #e5e7eb;border-radius:10px;outline:none;}
    button{background:#0ea5e9;color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:700;}
    .muted{color:#6b7280;font-size:13px}
  </style></head>
  <body>
    <div class="card">
      <h3>Responder al huésped</h3>
      <p class="muted">Token: <code>${htmlesc(token)}</code></p>
      <textarea id="msg" placeholder="Escribí tu respuesta para el huésped..."></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
        <button id="send">Enviar respuesta</button>
        <span id="status" class="muted"></span>
      </div>
    </div>
    <script>
      const el = (id)=>document.getElementById(id);
      el('send').onclick = async () => {
        const respuesta = el('msg').value.trim();
        if(!respuesta){ alert('Escribí una respuesta.'); return; }
        el('send').disabled = true;
        el('status').textContent = 'Enviando...';
        try{
          const r = await fetch('/api/web/relay', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ token: ${JSON.stringify(token)}, respuesta })
          });
          const j = await r.json().catch(()=>({ok:false}));
          if(j && j.ok){
            el('status').textContent = '✅ Enviado. Podés cerrar esta ventana.';
          }else{
            el('status').textContent = '❌ Error al enviar';
            el('send').disabled = false;
          }
        }catch(e){
          el('status').textContent = '❌ Error de red';
          el('send').disabled = false;
        }
      };
    </script>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

// ---------------- Checkout (reserva web) ----------------
app.post("/api/checkout", async (req, res) => {
  try {
    const {
      nombre, email, telefono,
      checkin, checkout,
      noches, habitacion, pax, total, moneda
    } = req.body || {};

    const safeNombre     = (nombre && String(nombre).trim()) || "Huésped";
    const safeCheckin    = (checkin && String(checkin).trim()) || addDaysISO(undefined, 0);
    const safeMoneda     = (moneda && String(moneda).trim()) || "USD";
    const safeHabitacion = (habitacion && String(habitacion).trim()) || "doble estandar";
    let safeNoches       = Number(noches || 0);
    let safeCheckout     = (checkout && String(checkout).trim()) || "";
    if (!safeNoches && safeCheckout) safeNoches = diffNightsISO(safeCheckin, safeCheckout);
    if (!safeCheckout && safeNoches > 0) safeCheckout = addDaysISO(safeCheckin, safeNoches);

    let safeTotal        = Number(total);
    if (!Number.isFinite(safeTotal)) safeTotal = 0;
    const safePax        = Number(pax || 2);

    // 🧱 NUEVO: obtener nightly de catálogo para validar el total de entrada
    let nightlyCatalog = 0;
    try {
      const rooms = await Sheets.getRoomsCatalog();
      const found = rooms.find((r:any)=> (r.name===safeHabitacion || r.id===safeHabitacion));
      nightlyCatalog = Number((found?.price ?? found?.nightly) || 0);
      if (Number.isFinite(nightlyCatalog) && nightlyCatalog > 0) {
        const expected = nightlyCatalog * Number(safeNoches || 1);
        if (safeTotal <= 0 || safeTotal < expected * 0.7) {
          safeTotal = expected; // saneo
        }
      }
    } catch {}

    // 🧱 NUEVO: intentar HOLD primero (fuente de verdad)
    let roomIdForHold = safeHabitacion;
    try {
      const rooms = await Sheets.getRoomsCatalog();
      roomIdForHold = String((rooms.find((r:any)=> (r.name || r.id) === safeHabitacion)?.id) || safeHabitacion);
    } catch {}

    const holdResult = await (async () => {
      try {
        const r:any = await Sheets.holdCapacityRange(roomIdForHold, safeCheckin, Number(safeNoches || 1));
        if (r === false) return { ok:false };
        if (typeof r === 'object' && ('ok' in r) && r.ok === false) return { ok:false };
        if (typeof r === 'object' && ('success' in r) && r.success === false) return { ok:false };
        return { ok:true };
      } catch (e) {
        console.warn('[checkout] holdCapacityRange lanzó error:', (e as any)?.message || e);
        return { ok:false };
      }
    })();

    if (!holdResult.ok) {
      // Ya está bloqueada por otra reserva
      return res.json({ ok:false, reason:'conflict', message:'La habitación ya no está disponible para esas fechas.' });
    }

    // PSP (opcional)
    let externalReference: string | undefined;
    try {
      const { createPayment } = paymentsProvider();
      if (typeof createPayment === "function") {
        const out = await createPayment({
          amount: Number(safeTotal),
          currency: String(safeMoneda),
          description: `Reserva ${safeHabitacion} x${safeNoches} noches - ${safeNombre}`,
          metadata: { nombre: safeNombre, email, telefono, habitacion: safeHabitacion, pax: safePax, n: safeNoches, checkin: safeCheckin, checkout: safeCheckout }
        });
        externalReference = out?.externalReference;
      }
    } catch (e) {
      console.warn("paymentsProvider fallback (mock):", (e as any)?.message || e);
    }

    const ref = externalReference || `ref_${Date.now()}`;

    // Persistir en Google Sheets para que aparezca en KPIs del bot
    try {
      const precioUnit = safeNoches > 0 ? Math.round((safeTotal || 0) / safeNoches) : Number(safeTotal) || 0;
      await Sheets.appendReservation({
        id: ref,
        nombre: safeNombre,
        fecha: safeCheckin,            // YYYY-MM-DD
        noches: Number(safeNoches || 1),
        precio: Number(precioUnit),
        estado: 'pendiente',           // el manager puede cambiarlo desde Telegram
        email: email || '',
        habitacion: safeHabitacion,
        fuente: 'web'
      });
      await Sheets.computeAndWriteTotalById(ref);
    } catch (e) {
      console.warn('[checkout] no se pudo persistir en Sheets:', (e as any)?.message || e);
      // Si falló la escritura de la reserva, idealmente también deberíamos liberar el HOLD (si tu función lo permite).
    }

    // ✅ Respuesta al front (ya con HOLD creado)
    res.json({ ok: true, ref });

    // Notificación a Telegram
    if (TG_TOKEN && TG_ADMIN) {
      const useInlineButtons = isHttpsPublic(PUBLIC_WEB_ORIGIN);
      const lines = [
        `🛎️ <b>Nueva reserva (web)</b>`,
        `• <b>Huésped:</b> ${htmlesc(safeNombre)}`,
        `• <b>Habitación:</b> ${htmlesc(safeHabitacion)}`,
        `• <b>Total de noches:</b> ${safeNoches}`,
        `• <b>Check-in:</b> ${isoToDMY(safeCheckin)}`,
        `• <b>Check-out:</b> ${isoToDMY(safeCheckout)}`,
        `• <b>Total:</b> ${htmlesc(safeMoneda)} $ ${safeTotal}`,
        email ? `• <b>Email:</b> ${htmlesc(email)}` : "",
        telefono ? `• <b>Tel:</b> ${htmlesc(telefono)}` : "",
        `• <b>ID:</b> <code>${ref}</code>`
      ].filter(Boolean).join("\n");

      const payload: any = {
        chat_id: TG_ADMIN,
        text: useInlineButtons
          ? lines
          : lines + `\n\nℹ️ Cambiá el estado desde el bot (menú «Cambiar estado») usando el ID arriba ⬆️.`,
        parse_mode: "HTML",
      };

      if (useInlineButtons) {
        payload.reply_markup = {
          inline_keyboard: [[
            { text: "✅ Aprobar",  url: `${PUBLIC_WEB_ORIGIN}/payments/mock/return?status=approved&ref=${encodeURIComponent(ref)}` },
            { text: "🕒 Pendiente", url: `${PUBLIC_WEB_ORIGIN}/payments/mock/return?status=pending&ref=${encodeURIComponent(ref)}` },
            { text: "❌ Fallar",   url: `${PUBLIC_WEB_ORIGIN}/payments/mock/return?status=failure&ref=${encodeURIComponent(ref)}` }
          ]]
        };
      }

      fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(async (resp) => {
        const body = await resp.json().catch(() => ({}));
        const ok = resp.ok && body?.ok !== false;
        if (!ok) console.error("❌ Telegram sendMessage fallo", { status: resp.status, body });
      }).catch((err) => {
        console.error("❌ Error al notificar Telegram:", err);
      });
    }
  } catch (e: any) {
    console.error("POST /api/checkout error:", e);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: e?.message || "checkout_error" });
  }
});

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Mini página raíz
app.get("/", (_req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agente Web</title></head><body>
  <h1>Agente Web</h1>
  <p>Integración del chat instalada.</p>
  <script src="/chat-widget.js"></script>
</body></html>`;
  res.send(html);
});

// Listen
const PORT = Number(env("PORT", "8080"));
app.listen(PORT, () => {
  console.log(`[web] Servidor escuchando en http://localhost:${PORT}`);
  console.log(`[web] TG_ADMIN=${TG_ADMIN ? "(set)" : "(vacío)"}  TG_TOKEN=${TG_TOKEN ? "(set)" : "(vacío)"}`);
  console.log(`[web] PUBLIC_WEB_ORIGIN=${PUBLIC_WEB_ORIGIN}`);
});
export default app;
