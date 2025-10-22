// src/web/preview.route.ts
import type { Application, Request, Response } from 'express';
import {
  getPreviewByToken,
  // Para edición desde la página:
  updateDraftField,
  appendPhoto,
  regeneratePreviewToken,
  promoteDraftToLive,
} from '../tools/drafts';

const PREVIEW_ENABLED = String(process.env.PREVIEW_ENABLED ?? 'true').toLowerCase() !== 'false';
const PREVIEW_DEBUG   = String(process.env.PREVIEW_DEBUG   ?? 'false').toLowerCase() === 'true';
const BOT_USERNAME    = process.env.TELEGRAM_BOT_USERNAME || ''; // opcional para atajo a Telegram

/* --------------------------------- Utils --------------------------------- */

function noIndex(res: Response) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // No seteamos X-Frame-Options para no bloquear el WebApp de Telegram (webview)
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as any)[ch]
  );
}

function htmlError(title: string, message: string) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex,nofollow"/>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;margin:0;padding:24px;background:#f8f9fb;color:#111}
  .container{max-width:860px;margin:0 auto}
  .card{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.06);padding:20px}
  h1{margin:0 0 8px}
  .muted{color:#666}
  a.btn{display:inline-block;margin-top:16px;padding:10px 14px;border-radius:10px;background:#0d6efd;color:#fff;text-decoration:none}
</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(message)}</p>
    </div>
  </div>
</body>
</html>`;
}

/** Extrae hotelId + token desde query/path/header. */
async function resolveToken(req: Request): Promise<{ hotelId: string; token: string } | null> {
  const hotelId = String(req.params.hotelId || '').trim();
  const tokenFromQuery  = String((req.query.token  as string) || '').trim();
  const tokenFromPath   = String((req.params as any).token || '').trim();
  const tokenFromHeader = String(req.headers['x-preview-token'] || '').trim();
  const token = tokenFromQuery || tokenFromPath || tokenFromHeader;
  if (!hotelId || !token) return null;
  return { hotelId, token };
}

/** Resuelve { draftId, data } a partir del token de preview (defensivo). */
async function resolveDraftFromToken(hotelId: string, token: string) {
  const pr: any = await getPreviewByToken(hotelId, token);
  if (!pr || !pr.data) return null;
  const draftId = pr.draft_id || pr.data?.draft_id || pr.data?.id || pr.data?.draftId;
  if (!draftId) {
    // Si tu helper no expone el draft_id, podés ajustarlo aquí.
    // Sin draftId no podemos editar/publicar desde la página.
    return { draftId: null, data: pr.data };
  }
  return { draftId, data: pr.data };
}

/* --------------------------- Render de la página -------------------------- */

function renderHtml(hotelId: string, token: string, data: any) {
  const fotos = String(data.fotos || '')
    .split('|').map((s: string) => s.trim()).filter(Boolean);
  const amenities = String(data.amenities || '')
    .split('|').map((s: string) => s.trim()).filter(Boolean);

  const titulo = data.titulo_hero || data.nombre || 'Previsualización';
  const desc   = data.descripcion_hero || '';
  const politicas = data.politicas_cancelacion || data.politicas || '';
  const precioDesde = data.precio_desde ? String(data.precio_desde) : '';

  let secciones: any = null;
  try { secciones = data.secciones_json ? JSON.parse(String(data.secciones_json)) : null; } catch {}

  // Página con UI de edición ligera (panel lateral) y acciones.
  // Los cambios se envían a /preview/api/... vía fetch.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(titulo)} · PREVIEW</title>
<meta name="robots" content="noindex,nofollow"/>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--muted:#555;--primary:#0d6efd;--danger:#e03131;}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;margin:0;background:var(--bg);color:#111}
  .wrap{display:grid;grid-template-columns:300px 1fr;gap:18px;max-width:1200px;margin:0 auto;padding:18px}
  .card{background:var(--card);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:16px}
  .muted{color:var(--muted)}
  .hero h1{margin:0 0 8px 0;font-size:1.8em}
  .badge{background:#eef4ff;color:#2a56c6;border-radius:999px;padding:6px 10px;display:inline-block;margin:0 6px 6px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
  img{width:100%;height:160px;object-fit:cover;border-radius:8px}
  label{font-size:.85em;color:#333;margin:8px 0 4px;display:block}
  input,textarea{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff}
  textarea{min-height:80px;resize:vertical}
  .btn{display:inline-block;border:none;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
  .btn-primary{background:var(--primary);color:#fff}
  .btn-danger{background:var(--danger);color:#fff}
  .btn-muted{background:#f1f3f5}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .status{margin-top:10px;font-size:.9em}
  .right .section{margin-bottom:16px}
  .price{font-weight:600;color:var(--primary)}
  .footnote{text-align:center;margin-top:12px}
</style>
</head>
<body>
<div class="wrap">
  <aside class="card">
    <h3>⚙️ Editar borrador</h3>
    <div>
      <label>Título</label>
      <input id="f_titulo" value="${escapeHtml(titulo)}"/>
      <label>Descripción</label>
      <textarea id="f_desc">${escapeHtml(desc)}</textarea>
      <label>Amenities (separados por |)</label>
      <input id="f_amen" value="${escapeHtml(amenities.join('|'))}"/>
      <label>Políticas</label>
      <textarea id="f_pol">${escapeHtml(politicas)}</textarea>
      <label>Precio desde</label>
      <input id="f_price" value="${escapeHtml(precioDesde)}"/>

      <div class="actions">
        <button class="btn btn-primary" onclick="saveAll()">💾 Guardar cambios</button>
        <button class="btn btn-muted" onclick="regen()">🔄 Regenerar vista</button>
      </div>

      <hr style="margin:14px 0; border:none; border-top:1px solid #eee"/>

      <label>Agregar foto por URL</label>
      <input id="f_photo_url" placeholder="https://..."/>
      <div class="actions">
        <button class="btn btn-primary" onclick="addPhoto()">➕ Agregar foto</button>
      </div>

      <hr style="margin:14px 0; border:none; border-top:1px solid #eee"/>

      <h4>Publicación</h4>
      <div class="actions">
        <button class="btn btn-primary" onclick="publish()">✅ Confirmar y Publicar</button>
        <button class="btn btn-danger"  onclick="discard()">🗑️ Descartar borrador</button>
      </div>
      <div class="status muted" id="status"></div>

      ${BOT_USERNAME ? (`<div class="footnote muted">
        ¿Preferís Telegram? <a href="https://t.me/${BOT_USERNAME}" target="_blank" rel="noopener">Abrir bot</a>
      </div>`) : ''}

    </div>
  </aside>

  <main class="right">
    <div class="card hero">
      <h1>${escapeHtml(titulo)}</h1>
      ${desc ? `<p class="muted">${escapeHtml(desc)}</p>` : ''}
      ${precioDesde ? `<p class="price">💲 Desde ${escapeHtml(precioDesde)}</p>` : ''}
      ${amenities.length ? `<div>${amenities.map(a => `<span class="badge">${escapeHtml(a)}</span>`).join('')}</div>` : ''}
    </div>

    ${fotos.length ? `<div class="card section"><h3>Galería</h3><div class="grid">${
      fotos.map(u => `<div><img src="${encodeURI(u)}" alt="foto"/></div>`).join('')
    }</div></div>` : ''}

    ${secciones ? `<div class="card section"><h3>Secciones</h3>${
      Array.isArray(secciones)
        ? secciones.map((s:any)=>`<h4>${escapeHtml(s.title||'Sección')}</h4><p class="muted">${escapeHtml(s.text||'')}</p>`).join('')
        : `<pre>${escapeHtml(JSON.stringify(secciones,null,2))}</pre>`
    }</div>` : ''}

    ${politicas ? `<div class="card section"><h3>Políticas</h3><p class="muted">${escapeHtml(politicas)}</p></div>` : ''}

    <p class="muted footnote">🔒 Vista privada de ejemplo — No indexada.</p>
  </main>
</div>

<script>
  const hotelId = ${JSON.stringify(hotelId)};
  const token   = ${JSON.stringify(token)};

  function setStatus(msg, ok){
    const el = document.getElementById('status');
    el.textContent = msg || '';
    el.style.color = ok ? '#2b8a3e' : '#444';
  }

  async function api(path, body){
    const r = await fetch('/preview/api/' + encodeURIComponent(hotelId) + '/' + encodeURIComponent(token) + path, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body || {})
    });
    const json = await r.json().catch(()=> ({}));
    if(!r.ok){
      throw new Error(json?.error || ('HTTP ' + r.status));
    }
    return json;
  }

  async function saveAll(){
    try{
      const payload = {
        titulo_hero: document.getElementById('f_titulo').value.trim(),
        descripcion_hero: document.getElementById('f_desc').value.trim(),
        amenities: document.getElementById('f_amen').value.trim(),
        politicas_cancelacion: document.getElementById('f_pol').value.trim(),
        precio_desde: document.getElementById('f_price').value.trim()
      };
      await api('/update', { fields: payload });
      setStatus('Cambios guardados. Usá "Regenerar vista" para refrescar.', true);
    }catch(e){ setStatus('No pude guardar: ' + e.message); }
  }

  async function regen(){
    try{
      await api('/regen', {});
      location.reload();
    }catch(e){ setStatus('No pude regenerar la vista: ' + e.message); }
  }

  async function addPhoto(){
    const url = document.getElementById('f_photo_url').value.trim();
    if(!url){ setStatus('Ingresá una URL de imagen.'); return; }
    try{
      await api('/add-photo', { url });
      setStatus('Foto agregada. Regenerando...', true);
      location.reload();
    }catch(e){ setStatus('No pude agregar la foto: ' + e.message); }
  }

  async function publish(){
    try{
      const out = await api('/publish', {});
      setStatus('Publicado correctamente. ' + (out?.live_url ? 'Ver: ' + out.live_url : ''), true);
    }catch(e){ setStatus('No se pudo publicar: ' + e.message); }
  }

  async function discard(){
    try{
      await api('/discard', {});
      setStatus('Borrador descartado.', true);
    }catch(e){ setStatus('No pude descartar: ' + e.message); }
  }
</script>
</body>
</html>`;
}

/* ------------------------------- Rutas HTTP ------------------------------- */

export function registerPreviewRoutes(app: Application) {
  if (!PREVIEW_ENABLED) {
    // healthz aunque esté deshabilitado
    app.get('/preview/healthz', (_req, res) => res.status(200).send('preview:disabled'));
    return;
  }

  // Salud
  app.get('/preview/healthz', (_req, res) => res.status(200).send('ok'));

  // Página principal con token en query: /preview/:hotelId?token=XYZ
  app.get('/preview/:hotelId', async (req: Request, res: Response) => {
    noIndex(res);
    try {
      const tok = await resolveToken(req);
      if (!tok) {
        return res
          .status(400)
          .send(htmlError('Previsualización', 'Faltan parámetros: hotelId y token.'));
      }
      const resolved = await resolveDraftFromToken(tok.hotelId, tok.token);
      if (!resolved) return res.status(404).send(htmlError('Previsualización', 'Preview no encontrada.'));
      if (!resolved.data) return res.status(404).send(htmlError('Previsualización', 'Datos no disponibles.'));

      return res.status(200).send(renderHtml(tok.hotelId, tok.token, resolved.data));
    } catch (e: any) {
      console.error('[preview.route] GET /preview/:hotelId error', e?.message || e);
      res.status(500).send(htmlError('Error del servidor', 'No se pudo generar la previsualización.'));
    }
  });

  // Variante con token en path: /preview/:hotelId/:token
  app.get('/preview/:hotelId/:token', async (req: Request, res: Response) => {
    noIndex(res);
    try {
      const hotelId = String(req.params.hotelId || '').trim();
      const token   = String(req.params.token   || '').trim();
      if (!hotelId || !token) {
        return res.status(400).send(htmlError('Previsualización', 'Faltan parámetros: hotelId y token.'));
      }
      const resolved = await resolveDraftFromToken(hotelId, token);
      if (!resolved) return res.status(404).send(htmlError('Previsualización', 'Preview no encontrada.'));
      if (!resolved.data) return res.status(404).send(htmlError('Previsualización', 'Datos no disponibles.'));

      return res.status(200).send(renderHtml(hotelId, token, resolved.data));
    } catch (e: any) {
      console.error('[preview.route] GET /preview/:hotelId/:token error', e?.message || e);
      res.status(500).send(htmlError('Error del servidor', 'No se pudo generar la previsualización.'));
    }
  });

  /* --------------------------- API de edición ---------------------------- */
  // Todas las APIs esperan :hotelId y :token para resolver el draft.
  // Responden JSON { ok: true } o { error: "..."} con HTTP 400/500.

  app.post('/preview/api/:hotelId/:token/update', async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId || '').trim();
      const token   = String(req.params.token   || '').trim();
      const resolved = await resolveDraftFromToken(hotelId, token);
      if (!resolved || !resolved.draftId) return res.status(400).json({ error: 'No pude resolver draft desde el token.' });

      const fields = (req.body?.fields || {}) as Record<string, string>;
      // Guardado “en bloque” usando updateDraftField o tu wrapper updateManyFields si existe.
      for (const [k, v] of Object.entries(fields)) {
        await updateDraftField(resolved.draftId, k as any, String(v ?? ''));
      }

      return res.json({ ok: true });
    } catch (e: any) {
      console.error('[preview.api] update', e?.message || e);
      res.status(500).json({ error: 'No pude actualizar el borrador.' });
    }
  });

  app.post('/preview/api/:hotelId/:token/add-photo', async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId || '').trim();
      const token   = String(req.params.token   || '').trim();
      const resolved = await resolveDraftFromToken(hotelId, token);
      if (!resolved || !resolved.draftId) return res.status(400).json({ error: 'No pude resolver draft desde el token.' });

      const url = String(req.body?.url || '').trim();
      if (!url) return res.status(400).json({ error: 'URL requerida.' });

      await appendPhoto(resolved.draftId, url);
      return res.json({ ok: true });
    } catch (e: any) {
      console.error('[preview.api] add-photo', e?.message || e);
      res.status(500).json({ error: 'No pude agregar la foto.' });
    }
  });

  app.post('/preview/api/:hotelId/:token/regen', async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId || '').trim();
      const token   = String(req.params.token   || '').trim();
      const resolved = await resolveDraftFromToken(hotelId, token);
      if (!resolved || !resolved.draftId) return res.status(400).json({ error: 'No pude resolver draft desde el token.' });

      await regeneratePreviewToken(resolved.draftId);
      return res.json({ ok: true });
    } catch (e: any) {
      console.error('[preview.api] regen', e?.message || e);
      res.status(500).json({ error: 'No pude regenerar la previsualización.' });
    }
  });

  app.post('/preview/api/:hotelId/:token/publish', async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId || '').trim();
      const token   = String(req.params.token   || '').trim();
      const resolved = await resolveDraftFromToken(hotelId, token);
      if (!resolved || !resolved.draftId) return res.status(400).json({ error: 'No pude resolver draft desde el token.' });

      const live = await promoteDraftToLive(resolved.draftId);
      // Construimos posible URL pública
      const base = process.env.LIVE_BASE_URL || process.env.PUBLIC_WEB_ORIGIN || process.env.BASE_URL || '';
      const b = base.endsWith('/') ? base.slice(0, -1) : base;
      const liveUrl = b ? `${b}/hotel/${encodeURIComponent(hotelId)}` : undefined;

      return res.json({ ok: true, version: live?.version_live, live_url: liveUrl });
    } catch (e: any) {
      // Propagamos el motivo (p.ej., validación: “Descripción requerida / al menos 1 foto”)
      const msg = e?.message || 'No se pudo publicar.';
      console.error('[preview.api] publish', msg);
      res.status(400).json({ error: msg });
    }
  });

  app.post('/preview/api/:hotelId/:token/discard', async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId || '').trim();
      const token   = String(req.params.token   || '').trim();
      const resolved = await resolveDraftFromToken(hotelId, token);
      if (!resolved || !resolved.draftId) return res.status(400).json({ error: 'No pude resolver draft desde el token.' });

      // “Descartar” simple: sobrescribir los campos actuales consigo mismos
      // (para refrescar updated_at) o limpiar según tu estrategia real.
      await updateDraftField(resolved.draftId, 'descripcion_hero' as any, String(resolved.data?.descripcion_hero || ''));
      await updateDraftField(resolved.draftId, 'secciones_json'  as any, String(resolved.data?.secciones_json  || ''));
      await updateDraftField(resolved.draftId, 'titulo_hero'     as any, String(resolved.data?.titulo_hero     || ''));

      return res.json({ ok: true });
    } catch (e: any) {
      console.error('[preview.api] discard', e?.message || e);
      res.status(500).json({ error: 'No pude descartar el borrador.' });
    }
  });

  // Ruta de ayuda/diagnóstico (solo si habilitás PREVIEW_DEBUG=true)
  if (PREVIEW_DEBUG) {
    app.get('/preview/debug/:hotelId', async (req: Request, res: Response) => {
      noIndex(res);
      const hotelId = String(req.params.hotelId || '').trim();
      const token = String(req.query.token || '').trim();
      res
        .status(200)
        .send(
          `hotelId=${hotelId || '(none)'}\nquery.token=${token || '(none)'}\nheaders.x-preview-token=${req.headers['x-preview-token'] || '(none)'}`
        );
    });
  }
}
