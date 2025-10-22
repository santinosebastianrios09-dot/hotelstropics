// src/tools/drafts.ts
// Borradores y publicación en Google Sheets SIN tocar lo existente.
// Crea/lee/actualiza filas en:
//   - HOTEL_LIVE_TAB (default: "hotel_live")
//   - HOTEL_DRAFTS_TAB (default: "hotel_drafts")
// Opcional backup:
//   - HOTEL_LIVE_BACKUP_TAB (default: "hotel_live_backup")

import { google, sheets_v4 } from 'googleapis';
import dayjs from 'dayjs';
import { validateDraftBeforePublish, DraftData } from './validation';

type SheetsApi = sheets_v4.Sheets;
function req(name: string, v?: string) {
  if (!v) throw new Error(`[drafts] Falta ${name} en .env`);
  return v;
}

const SPREADSHEET_ID = req('GOOGLE_SHEETS_SPREADSHEET_ID', process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
const HOTEL_LIVE_TAB       = process.env.HOTEL_LIVE_TAB || 'hotel_live';
const HOTEL_DRAFTS_TAB     = process.env.HOTEL_DRAFTS_TAB || 'hotel_drafts';
const HOTEL_LIVE_BACKUP_TAB= process.env.HOTEL_LIVE_BACKUP_TAB || 'hotel_live_backup';
const PREVIEW_TTL_HOURS    = Number(process.env.PREVIEW_TOKEN_TTL_HOURS || 48);

function getAuth() {
  const keyFile = req('GOOGLE_APPLICATION_CREDENTIALS', process.env.GOOGLE_APPLICATION_CREDENTIALS);
  return new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}
function getSheets(): SheetsApi {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

function range(tab: string, a1: string) { return `${tab}!${a1}`; }

const DRAFT_HEADERS = [
  'draft_id','hotel_id','owner_telegram_id','estado',
  'nombre','titulo_hero','descripcion_hero','fotos',
  'secciones_json','amenities','politicas_cancelacion','precio_desde',
  'preview_token','preview_expires_at','version_base','updated_at'
];

const LIVE_HEADERS = [
  'hotel_id','nombre','titulo_hero','descripcion_hero','fotos',
  'secciones_json','amenities','politicas_cancelacion','precio_desde',
  'version_live','ultima_publicacion_at'
];

type RowObj = Record<string, any>;

async function readAll(tab: string): Promise<RowObj[]> {
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: range(tab, 'A:ZZ') });
  const values = resp.data.values || [];
  if (values.length === 0) return [];
  const headers = values[0] as string[];
  return values.slice(1).map(row => {
    const o: RowObj = {};
    headers.forEach((h, i) => o[h] = row[i]);
    return o;
  });
}

async function ensureHeaders(tab: string, headers: string[]) {
  const sheets = getSheets();
  const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: range(tab, 'A1:ZZ1') }).catch(() => ({ data: { values: [] }} as any));
  const vals = current.data.values || [];
  const row0 = vals[0] as string[] | undefined;
  if (!row0 || row0.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range(tab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
  }
}

// 🔹 NUEVO: si faltan columnas, las agrega al final de la fila de encabezados (no mueve nada existente).
async function ensureHeaderSuperset(tab: string, desired: string[]) {
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab, 'A1:ZZ1')
  }).catch(() => ({ data: { values: [] }} as any));

  const row0 = (resp.data.values && resp.data.values[0]) ? (resp.data.values[0] as string[]) : [];
  if (row0.length === 0) {
    // Si no hay encabezados, delegamos al ensureHeaders estándar
    await ensureHeaders(tab, desired);
    return desired;
  }

  const have = new Set(row0.map(h => String(h).trim()));
  const missing = desired.filter(h => !have.has(h));
  if (missing.length === 0) return row0;

  const merged = [...row0, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab, 'A1'),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [merged] }
  });
  return merged;
}

function uid() {
  return 'drf_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function token() {
  return 'tok_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function appendRow(tab: string, headers: string[], obj: RowObj) {
  const sheets = getSheets();
  const row = headers.map(h => obj[h] ?? '');
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab, 'A:ZZ'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

async function updateRowByIndex(tab: string, headers: string[], rowIndex1Based: number, obj: RowObj) {
  const sheets = getSheets();
  const row = headers.map(h => obj[h] ?? '');
  const a1 = `A${rowIndex1Based}:ZZ${rowIndex1Based}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab, a1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
}

// (No se usa; mantenido por compatibilidad — tenía confusión de 0/1-based)
async function findRowIndexBy(tab: string, key: string, value: string): Promise<number | null> {
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: range(tab, 'A:ZZ') });
  const values = resp.data.values || [];
  if (values.length === 0) return null;
  const headers = values[0] as string[];
  const kIdx = headers.indexOf(key);
  if (kIdx === -1) return null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][kIdx] || '') === String(value)) {
      return i + 1; // índice 1-based real
    }
  }
  return null;
}

// Ajuste correcto: obtenemos headers y buscamos índice+fila
async function findRowAndHeaders(tab: string, key: string, value: string): Promise<{headers: string[], index: number, row: string[]} | null> {
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: range(tab, 'A:ZZ') });
  const values = resp.data.values || [];
  if (values.length === 0) return null;
  const headers = values[0] as string[];
  const kIdx = headers.indexOf(key);
  if (kIdx === -1) return null;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[kIdx] || '') === String(value)) return { headers, index: i + 1, row };
  }
  return null;
}

/** ========== API PÚBLICA (existente) ========== **/

export async function createOrGetDraft(ownerTelegramId: string, hotelId: string) {
  await ensureHeaders(HOTEL_DRAFTS_TAB, DRAFT_HEADERS);
  await ensureHeaders(HOTEL_LIVE_TAB, LIVE_HEADERS);
  // 🔹 NUEVO: asegurar que los encabezados de drafts tengan al menos las columnas deseadas.
  await ensureHeaderSuperset(HOTEL_DRAFTS_TAB, DRAFT_HEADERS);

  // ¿Ya existe un draft "abierto"?
  const all = await readAll(HOTEL_DRAFTS_TAB);
  const existing = all.find(r =>
    String(r.owner_telegram_id) === String(ownerTelegramId) &&
    String(r.hotel_id) === String(hotelId) &&
    (r.estado === 'editing' || r.estado === 'preview' || r.estado === 'ready')
  );
  if (existing) return existing;

  // Leer live para copiar como base
  const lives = await readAll(HOTEL_LIVE_TAB);
  const base = lives.find(r => String(r.hotel_id) === String(hotelId)) || { hotel_id: hotelId, version_live: '0' };

  const draft = {
    draft_id: uid(),
    hotel_id: hotelId,
    owner_telegram_id: ownerTelegramId,
    estado: 'editing',
    nombre: base.nombre || '',
    titulo_hero: base.titulo_hero || '',
    descripcion_hero: base.descripcion_hero || '',
    fotos: base.fotos || '',
    secciones_json: base.secciones_json || '',
    amenities: base.amenities || '',
    politicas_cancelacion: base.politicas_cancelacion || '',
    precio_desde: base.precio_desde || '',
    preview_token: '',
    preview_expires_at: '',
    version_base: base.version_live || '0',
    updated_at: dayjs().toISOString(),
  };

  await appendRow(HOTEL_DRAFTS_TAB, DRAFT_HEADERS, draft);
  return draft;
}

export async function updateDraftField(draftId: string, field: keyof DraftData, value: string) {
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);
  const { headers, index, row } = fh;
  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);

  obj[String(field)] = value;
  obj['updated_at'] = dayjs().toISOString();
  obj['estado'] = obj['estado'] === 'preview' ? 'editing' : (obj['estado'] || 'editing');

  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
  return obj;
}

export async function appendPhoto(draftId: string, photoUrl: string) {
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);
  const { headers, index, row } = fh;
  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);

  const fotos = String(obj['fotos'] || '').split('|').map((s: string) => s.trim()).filter(Boolean);
  fotos.push(photoUrl);
  obj['fotos'] = fotos.join('|');
  obj['updated_at'] = dayjs().toISOString();

  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
  return obj;
}

// 🔧 REEMPLAZADA: versión defensiva que asegura columnas y solo escribe claves existentes
export async function regeneratePreviewToken(draftId: string) {
  // Aseguramos que, como mínimo, existan las columnas de preview en la cabecera
  await ensureHeaderSuperset(HOTEL_DRAFTS_TAB, DRAFT_HEADERS);

  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);

  const { headers, index, row } = fh;
  const have = new Set(headers.map(h => String(h).trim()));

  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);

  const ttl = Number.isFinite(PREVIEW_TTL_HOURS) && PREVIEW_TTL_HOURS > 0 ? PREVIEW_TTL_HOURS : 48;
  const tok = token();
  const expiresAt = dayjs().add(ttl, 'hour').toISOString();

  // Solo actualizamos columnas existentes
  if (have.has('preview_token'))      obj['preview_token'] = tok;
  if (have.has('preview_expires_at')) obj['preview_expires_at'] = expiresAt;
  if (have.has('estado'))             obj['estado'] = 'preview';
  if (have.has('updated_at'))         obj['updated_at'] = dayjs().toISOString();

  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
  return { ...obj, preview_token: tok };
}

export async function getPreviewByToken(hotelId: string, previewToken: string) {
  const all = await readAll(HOTEL_DRAFTS_TAB);
  const row = all.find(r => String(r.hotel_id) === String(hotelId) && String(r.preview_token) === String(previewToken));
  if (!row) return null;

  const exp = row.preview_expires_at ? dayjs(row.preview_expires_at) : null;
  if (!exp || dayjs().isAfter(exp)) return { expired: true, data: row };
  return { expired: false, data: row };
}

export async function promoteDraftToLive(draftId: string) {
  // 1) Cargar draft
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);
  const { headers, index, row } = fh;
  const d: any = {};
  headers.forEach((h, i) => d[h] = row[i]);

  // 2) Validar
  const { ok, errors } = validateDraftBeforePublish({
    hotel_id: d.hotel_id, nombre: d.nombre, titulo_hero: d.titulo_hero, descripcion_hero: d.descripcion_hero,
    fotos: d.fotos, amenities: d.amenities, secciones_json: d.secciones_json, politicas_cancelacion: d.politicas_cancelacion, precio_desde: d.precio_desde
  });
  if (!ok) throw new Error(`[drafts] Validación falló: ${errors.join(', ')}`);

  // 3) Comparar versión base vs live actual
  await ensureHeaders(HOTEL_LIVE_TAB, LIVE_HEADERS);
  const lives = await readAll(HOTEL_LIVE_TAB);
  const live = lives.find(r => String(r.hotel_id) === String(d.hotel_id));
  const versionLive = Number(live?.version_live || 0);
  const versionBase = Number(d.version_base || 0);
  if (versionBase !== versionLive) {
    throw new Error(`[drafts] La base (${versionBase}) no coincide con live (${versionLive}). Revisa y actualiza el draft.`);
  }

  // 4) Backup live
  await ensureHeaders(HOTEL_LIVE_BACKUP_TAB, [...LIVE_HEADERS, 'backup_at']);
  if (live) {
    const backup = { ...live, backup_at: dayjs().toISOString() };
    await appendRow(HOTEL_LIVE_BACKUP_TAB, [...LIVE_HEADERS, 'backup_at'], backup);
  }

  // 5) Escribir live (upsert por hotel_id)
  const sheets = getSheets();
  const grid = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: range(HOTEL_LIVE_TAB, 'A:ZZ') });
  const values = grid.data.values || [];
  let headersLive: string[] = values[0] as string[] || [];
  if (!headersLive || headersLive.length === 0) {
    await ensureHeaders(HOTEL_LIVE_TAB, LIVE_HEADERS);
    headersLive = LIVE_HEADERS;
  }

  const k = headersLive.indexOf('hotel_id');
  let targetIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][k] || '') === String(d.hotel_id)) { targetIndex = i + 1; break; }
  }

  const newLive = {
    hotel_id: d.hotel_id,
    nombre: d.nombre || '',
    titulo_hero: d.titulo_hero || '',
    descripcion_hero: d.descripcion_hero || '',
    fotos: d.fotos || '',
    secciones_json: d.secciones_json || '',
    amenities: d.amenities || '',
    politicas_cancelacion: d.politicas_cancelacion || '',
    precio_desde: d.precio_desde || '',
    version_live: String(versionLive + 1),
    ultima_publicacion_at: dayjs().toISOString(),
  };

  if (targetIndex > 0) {
    await updateRowByIndex(HOTEL_LIVE_TAB, headersLive, targetIndex, newLive);
  } else {
    await appendRow(HOTEL_LIVE_TAB, LIVE_HEADERS, newLive);
  }

  // 6) Cerrar draft
  const obj = { ...d, estado: 'published', preview_token: '', preview_expires_at: '', updated_at: dayjs().toISOString() };
  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);

  return newLive;
}

/** Utilidades para uso desde el bot */
export async function findActiveDraftByOwnerAndHotel(ownerTelegramId: string, hotelId: string) {
  const all = await readAll(HOTEL_DRAFTS_TAB);
  return all.find(r =>
    String(r.owner_telegram_id) === String(ownerTelegramId) &&
    String(r.hotel_id) === String(hotelId) &&
    (r.estado === 'editing' || r.estado === 'preview' || r.estado === 'ready')
  ) || null;
}

/** ========== NUEVO: utilidades extra para el flujo por botones ========== **/

/**
 * Garantiza un draft en estado 'editing' para el owner+hotel (idempotente).
 * Si existe y está en otro estado ('preview', 'ready'), lo vuelve a 'editing'.
 */
export async function ensureEditingDraft(ownerTelegramId: string, hotelId: string) {
  const draft = await createOrGetDraft(ownerTelegramId, hotelId);
  if (draft.estado !== 'editing') {
    const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draft.draft_id);
    if (fh) {
      const { headers, index, row } = fh;
      const obj: RowObj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      obj['estado'] = 'editing';
      obj['updated_at'] = dayjs().toISOString();
      await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
      return obj;
    }
  }
  return draft;
}

/** Lee un draft por draft_id. */
export async function getDraftById(draftId: string) {
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) return null;
  const { headers, row } = fh;
  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);
  return obj;
}

/** Cambia el estado del draft (editing | preview | ready | published | discarded). */
export async function setDraftStatus(draftId: string, status: 'editing' | 'preview' | 'ready' | 'published' | 'discarded') {
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);
  const { headers, index, row } = fh;
  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);
  obj['estado'] = status;
  obj['updated_at'] = dayjs().toISOString();
  if (status !== 'preview') {
    obj['preview_token'] = '';
    obj['preview_expires_at'] = '';
  }
  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
  return obj;
}

/** Marca un draft como descartado (sin borrarlo físicamente). */
export async function discardDraftById(draftId: string) {
  return setDraftStatus(draftId, 'discarded');
}

/** Quita una foto por índice (0-based/1-based) o por URL exacta. */
export async function removePhoto(draftId: string, target: number | string) {
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);
  const { headers, index, row } = fh;
  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);

  const arr = String(obj['fotos'] || '').split('|').map((s: string) => s.trim()).filter(Boolean);
  if (typeof target === 'number') {
    const idx = target >= 1 ? target - 1 : target; // acepta 1-based o 0-based
    if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
  } else {
    const idx = arr.findIndex(u => u === target);
    if (idx >= 0) arr.splice(idx, 1);
  }
  obj['fotos'] = arr.join('|');
  obj['updated_at'] = dayjs().toISOString();

  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
  return obj;
}

/** Actualiza varios campos del draft de una sola vez (merge sobre la fila). */
export async function updateManyFields(draftId: string, partial: Partial<Record<keyof DraftData, string>>) {
  const fh = await findRowAndHeaders(HOTEL_DRAFTS_TAB, 'draft_id', draftId);
  if (!fh) throw new Error(`[drafts] draft_id no encontrado: ${draftId}`);
  const { headers, index, row } = fh;
  const obj: RowObj = {};
  headers.forEach((h, i) => obj[h] = row[i]);

  for (const [k, v] of Object.entries(partial)) {
    if (headers.includes(k)) {
      obj[k] = v ?? obj[k];
    }
  }
  obj['updated_at'] = dayjs().toISOString();
  if (obj['estado'] === 'preview') obj['estado'] = 'editing';

  await updateRowByIndex(HOTEL_DRAFTS_TAB, headers, index, obj);
  return obj;
}

/** Wrappers convenientes para los callbacks por botón (opcionales). */
export async function updateSectionsJson(draftId: string, json: string) {
  return updateDraftField(draftId, 'secciones_json', json);
}
export async function updateAmenities(draftId: string, amenitiesCsv: string) {
  return updateDraftField(draftId, 'amenities', amenitiesCsv);
}
export async function updatePoliciesText(draftId: string, text: string) {
  return updateDraftField(draftId, 'politicas_cancelacion', text);
}
export async function updatePriceFrom(draftId: string, price: string) {
  return updateDraftField(draftId, 'precio_desde', price);
}

/** ================= NUEVO: listado de hoteles para selector por botones ================ */
/** Lista básica de hoteles desde la hoja live (hotel_id y nombre). */
export async function listLiveHotelsBasic(): Promise<Array<{ hotel_id: string; nombre?: string }>> {
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range(HOTEL_LIVE_TAB, 'A:Z'),
  });
  const values = resp.data.values || [];
  if (values.length === 0) return [];

  const headers = values[0] as string[];
  const idxId = headers.indexOf('hotel_id');
  const idxName = headers.indexOf('nombre');

  const out: Array<{ hotel_id: string; nombre?: string }> = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const hotel_id = String(row[idxId] || '').trim();
    if (!hotel_id) continue;
    const nombre = idxName >= 0 ? String(row[idxName] || '').trim() : undefined;
    out.push({ hotel_id, nombre });
  }
  return out;
}

/** ================= NUEVO: helper para obtención automática de hotel_id ================= */
/**
 * Devuelve el primer `hotel_id` no vacío en la pestaña LIVE.
 * Si hay solo uno, devuelve ese. Si no encuentra, devuelve null.
 */
export async function getPrimaryHotelIdFromLive(): Promise<string | null> {
  await ensureHeaders(HOTEL_LIVE_TAB, LIVE_HEADERS);
  const lives = await readAll(HOTEL_LIVE_TAB);
  if (!lives || lives.length === 0) return null;
  if (lives.length === 1) return String(lives[0].hotel_id || '').trim() || null;
  for (const r of lives) {
    const hid = String(r.hotel_id || '').trim();
    if (hid) return hid;
  }
  return null;
}
