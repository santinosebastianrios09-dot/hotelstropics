import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import fs from 'fs';
dayjs.extend(customParseFormat);

/* ============== ENV & CLIENT ============== */
type SheetsApi = sheets_v4.Sheets;

function required(name: string, val?: string) {
  if (!val) throw new Error(`Falta ${name} en .env`);
  return val;
}
const SPREADSHEET_ID = required('GOOGLE_SHEETS_SPREADSHEET_ID', process.env.GOOGLE_SHEETS_SPREADSHEET_ID);

// Pestañas (aceptamos múltiples nombres por compatibilidad con tu libro)
const RESERVAS_TAB_PRIMARY = process.env.SHEETS_TAB_NAME || 'RESERVAS';
const RESERVAS_TAB_FALLBACKS = ['RESERVAS PROCESADAS', 'Reservas', 'reservas'];
const ROOMS_TAB = process.env.ROOMS_TAB_NAME || 'Recursos';
const ROOMS_TAB_CANDIDATES = [
  ROOMS_TAB, 'Recursos', 'RECURSOS', 'Habitaciones', 'HABITACIONES', 'Rooms', 'rooms'
];
const CAL_TAB = process.env.CALENDAR_TAB_NAME || 'CALENDARIO';
const DEFAULT_CURR = (process.env.DEFAULT_CURRENCY || 'USD').toUpperCase();

// Estados que bloquean ocupación
const OCCUPANCY_STATES = (
  process.env.OCCUPANCY_STATES ||
  'confirmada,approved,pagado,pendiente,pending,pending_payment,web'
).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Modo de ocupación
const OCCUPANCY_MODE = (process.env.OCCUPANCY_MODE || 'any_booking').toLowerCase(); // any_booking | capacity

// ==== AUTENTICACIÓN ROBUSTA ====
function getAuth() {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  // 1) Inline (recomendado)
  if (clientEmail && privateKey) {
    console.log('[sheets] Credenciales: INLINE');
    return new google.auth.JWT(
      clientEmail,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
  }

  // 2) Archivo JSON (fallback) — saneo comillas y verificación
  let keyFile = required('GOOGLE_APPLICATION_CREDENTIALS', process.env.GOOGLE_APPLICATION_CREDENTIALS);
  keyFile = keyFile.trim().replace(/^['"]+|['"]+$/g, '');
  if (!fs.existsSync(keyFile)) {
    throw new Error(`[sheets] No se encuentra el archivo de credenciales en: ${keyFile}`);
  }
  console.log('[sheets] Credenciales: ARCHIVO →', keyFile);
  return new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}
function getSheets(): SheetsApi {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

/* ============== HELPERS ============== */
function num(x: any): number | undefined {
  if (x === null || x === undefined) return undefined;
  const s = String(x).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function parseAnyDate(s: any): dayjs.Dayjs | null {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (!str) return null;

  // PRIORIDAD: DÍA-MES-AÑO
  let d = dayjs(str, 'DD-MM-YYYY', true);
  if (d.isValid()) return d;
  d = dayjs(str, 'D-M-YYYY', true);
  if (d.isValid()) return d;

  // Luego barras
  d = dayjs(str, 'DD/MM/YYYY', true);
  if (d.isValid()) return d;
  d = dayjs(str, 'D/M/YYYY', true);
  if (d.isValid()) return d;

  // ISO u otros parseables
  d = dayjs(str, 'YYYY-MM-DD', true);
  if (d.isValid()) return d;

  d = dayjs(str);
  return d.isValid() ? d : null;
}
function toISO(s: any): string | null { const d = parseAnyDate(s); return d ? d.format('YYYY-MM-DD') : null; }
function range(tab: string, a1: string) { return `${tab}!${a1}`; }

function normalize(s: any) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readAllRows(sheetName: string): Promise<any[][]> {
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range(sheetName, 'A:ZZ')
  });
  return (resp.data.values as any[][]) || [];
}

async function readAllRowsAny(names: string[]): Promise<{ tab: string; rows: any[][] }> {
  for (const n of names) {
    try {
      const rows = await readAllRows(n);
      if (rows && rows.length > 1) return { tab: n, rows };
    } catch { /* continua */ }
  }
  return { tab: names[0], rows: [] };
}

// Lee una de varias pestañas de reservas (la primera que tenga datos)
async function readReservationsFlexible(): Promise<{ tab: string; rows: any[][] }> {
  let rows = await readAllRows(RESERVAS_TAB_PRIMARY).catch(() => []);
  if (rows && rows.length > 0) return { tab: RESERVAS_TAB_PRIMARY, rows };
  for (const name of RESERVAS_TAB_FALLBACKS) {
    rows = await readAllRows(name).catch(() => []);
    if (rows && rows.length > 0) return { tab: name, rows };
  }
  return { tab: RESERVAS_TAB_PRIMARY, rows: [] };
}

async function appendRows(sheetName: string, rows: any[][]) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: range(sheetName, 'A:ZZ'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
}
async function updateCellRange(sheetName: string, a1Range: string, rows: any[][]) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: range(sheetName, a1Range),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows }
  });
}
function findColIdx(header: string[], re: RegExp, fallbackIdx?: number): number {
  const i = header.findIndex(h => re.test(String(h || '')));
  return i >= 0 ? i : (typeof fallbackIdx === 'number' ? fallbackIdx : -1);
}

/* ============== TIPOS ============== */
export type Room = {
  id: string;
  name: string;
  capacity: number;
  basePrice: number;
  currency: string;
  policy?: string;
};

/* ============== HABITACIONES (con autodetección de pestaña) ============== */
export async function getRoomsCatalog(): Promise<Room[]> {
  // intenta la pestaña configurada y, si no hay datos, prueba candidatas comunes
  const { tab, rows } = await readAllRowsAny(ROOMS_TAB_CANDIDATES);
  if (!rows || rows.length <= 1) {
    throw new Error(`[rooms] No se encontraron datos en "${ROOMS_TAB_CANDIDATES.join(' | ')}". Verificá el nombre de la pestaña en Sheets.`);
  }

  const h = rows[0] || [];
  const idxId    = findColIdx(h, /ID\s*RECURSO|^ID$/i, 0);
  const idxName  = findColIdx(h, /NOMBRE|HABITACI[ÓO]N|RECURSO/i, 1);
  const idxCap   = findColIdx(h, /CAP(\.|ACIDAD)?\s*MAX|CAPACIDAD/i, 2);
  const idxPrice = findColIdx(h, /PRECIO|BASE|PRICE/i, 3);
  const idxCurr  = findColIdx(h, /MONEDA|CURRENCY/i, 4);

  
  const idxImg   = findColIdx(h, /IMAGEN[_\s]*URL|IMAGEN|FOTO|PHOTO|IMAGE[_\s]*URL/i);
  const idxServ  = findColIdx(h, /SERVICIOS|AMENITIES|CARACTER[ÍI]STICAS|FEATURES/i);
const out: Room[] = [];
  for (let i = 1; i < rows.length; i++) {
    out.push({
      id: String(rows[i][idxId] || '').trim(),
      name: String(rows[i][idxName] || '').trim(),
      capacity: num(rows[i][idxCap]) ?? 1,
      basePrice: num(rows[i][idxPrice]) ?? 0,
      currency: String(rows[i][idxCurr] || DEFAULT_CURR).toUpperCase()
    });
      const imageUrl = idxImg !== -1 ? String(rows[i][idxImg] || '').trim() : '';
      const amenities = idxServ !== -1 ? (rows[i][idxServ] ?? '') : '';
      out[out.length-1].imageUrl = imageUrl;
      out[out.length-1].amenities = amenities;
  }
  const rooms = out.filter(r => r.id || r.name);
  if (!rooms.length) {
    throw new Error(`[rooms] La pestaña "${tab}" está accesible pero no hay filas válidas de habitaciones.`);
  }
  return rooms;
}

/* ============== COTIZACIÓN BÁSICA ============== */
export async function quoteStay(roomIdOrName: string, _checkinDMY: string, nights: number) {
  const rooms = await getRoomsCatalog();
  const room = rooms.find(r => r.id === roomIdOrName || r.name === roomIdOrName);
  const nightly = room?.basePrice ?? 0;
  const total = nightly * (Number(nights) || 1);
  return { available: true, pricePerNight: nightly, total, currency: room?.currency || DEFAULT_CURR };
}
export async function holdCapacityRange(_roomId: string, _checkinISO: string, _nights: number) { return true; }
export async function releaseCapacityRange(_roomId: string, _checkinISO: string, _nights: number) { return true; }

/* ============== RESERVAS (append al tab principal) ============== */
export async function appendReservation(data: {
  id: string; nombre: string; fecha: string; noches: number; precio?: number;
  estado?: 'pendiente'|'confirmada'|'cancelada'|'approved'|'pagado'|'pending_payment'|'web';
  email?: string; habitacion?: string; fuente?: string;
}) {
  const values = [[
    data.id,
    data.nombre,
    toISO(data.fecha) ?? data.fecha,
    data.noches,
    data.precio ?? '',
    '', // TOTAL
    data.estado ?? 'pendiente',
    data.fuente ?? '',
    data.email ?? '',
    data.habitacion ?? ''
  ]];
  await appendRows(RESERVAS_TAB_PRIMARY, values);
}

export async function computeAndWriteTotalById(id: string) {
  const { rows, tab } = await readReservationsFlexible();
  if (rows.length <= 1) return null;

  const header   = rows[0] || [];
  const idxId    = header.indexOf('ID')     > -1 ? header.indexOf('ID')     : 0;
  const idxNoches= header.indexOf('NOCHES') > -1 ? header.indexOf('NOCHES') : 3;
  const idxPrecio= header.indexOf('PRECIO') > -1 ? header.indexOf('PRECIO') : 4;
  const idxTotal = header.indexOf('TOTAL')  > -1 ? header.indexOf('TOTAL')  : 5;

  let row = -1;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][idxId]).trim() === id) { row = i; break; }
  if (row === -1) return null;

  const noches = num(rows[row][idxNoches]) ?? 1;
  const precio = num(rows[row][idxPrecio]) ?? 0;
  const total  = noches * precio;

  const col = String.fromCharCode(65 + idxTotal);
  await updateCellRange(tab, `${col}${row + 1}`, [[total]]);
  return total;
}

export async function recomputeAllTotals() {
  const { rows, tab } = await readReservationsFlexible();
  if (rows.length <= 1) return { updated: 0, summary: 'No hay filas para actualizar.' };

  const header   = rows[0] || [];
  const idxNoches= header.indexOf('NOCHES') > -1 ? header.indexOf('NOCHES') : 3;
  const idxPrecio= header.indexOf('PRECIO') > -1 ? header.indexOf('PRECIO') : 4;
  const idxTotal = header.indexOf('TOTAL')  > -1 ? header.indexOf('TOTAL')  : 5;

  const values: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const noches = num(rows[i][idxNoches]) ?? 1;
    const precio = num(rows[i][idxPrecio]) ?? 0;
    values.push([noches * precio]);
  }
  const col = String.fromCharCode(65 + idxTotal);
  await updateCellRange(tab, `${col}2`, values);

  const updated = values.length;
  return { updated, summary: `Recalculadas ${updated} filas en TOTAL.` };
}

export async function updateReservationStatus(id: string, estado: string) {
  const { rows, tab } = await readReservationsFlexible();
  if (rows.length <= 1) return false;

  const header   = rows[0] || [];
  const idxId    = header.indexOf('ID')     > -1 ? header.indexOf('ID')     : 0;
  const idxEstado= header.indexOf('ESTADO') > -1 ? header.indexOf('ESTADO') : 6;

  let row = -1;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][idxId]).trim() === id) { row = i; break; }
  if (row === -1) return false;

  const col = String.fromCharCode(65 + idxEstado);
  await updateCellRange(tab, `${col}${row + 1}`, [[estado]]);
  return true;
}

/* ============== KPIs / RESUMEN (flex) ============== */
export async function getSummary() {
  const { rows } = await readReservationsFlexible();

  const now = dayjs();
  const monthStartISO = now.startOf('month').format('YYYY-MM-DD');
  const monthEndISO   = now.endOf('month').format('YYYY-MM-DD');

  if (rows.length <= 1) {
    return {
      bookings: 0, totalBookings: 0,
      confirmed: 0, pending: 0, canceled: 0,
      revenue: 0, occupancy: 0,
      month: { startISO: monthStartISO, endISO: monthEndISO, bookings: 0, revenue: 0, occupancy: 0, nights: 0, capacity: 0 }
    };
  }

  const h = rows[0] || [];
  const idxFecha   = [findColIdx(h, /CHECK.?-?\s*IN/i), findColIdx(h, /^FECHA$/i), findColIdx(h, /^FECHA\s+DEL\s+FORM$/i)]
    .find(i => (i ?? -1) >= 0) ?? 2;
  const idxNoches  = findColIdx(h, /^NOCHES$/i, 4);
  const idxTotal   = findColIdx(h, /^TOTAL$/i, 13);
  const idxEstado  = findColIdx(h, /^ESTADO$/i, 7);

  let confirmed = 0, pending = 0, canceled = 0, revenue = 0;
  let monthBookings = 0, monthRevenue = 0, monthNights = 0;

  for (let i = 1; i < rows.length; i++) {
    const estRaw = normalize(rows[i][idxEstado]);
    const est =
      estRaw === 'pagado' || estRaw === 'approved' ? 'confirmada' :
      estRaw === 'canceled' ? 'cancelada' :
      estRaw; // pendiente, web, pending_payment, etc.

    if (est === 'confirmada') confirmed++;
    else if (est === 'pendiente' || est === 'pending' || est === 'web' || est === 'pending_payment') pending++;
    else if (est === 'cancelada') canceled++;

    const total = num(rows[i][idxTotal]) ?? 0;
    if (est === 'confirmada') revenue += total;

    const fechaISO = toISO(rows[i][idxFecha]);
    if (fechaISO && fechaISO >= monthStartISO && fechaISO <= monthEndISO) {
      monthBookings++;
      const noches = num(rows[i][idxNoches]) ?? 0;
      if (est === 'confirmada') { monthRevenue += total; monthNights += noches; }
    }
  }
  const totalBookings = rows.length - 1;

  // Capacidad mensual (si existe hoja CALENDARIO con FECHA / CUPO TOTAL)
  let monthCapacity = 0;
  try {
    const calRows = await readAllRows(CAL_TAB);
    if (calRows.length > 1) {
      const ch = calRows[0] || [];
      const idxFechaC = findColIdx(ch, /FECHA/i, 0);
      const idxTotalC = findColIdx(ch, /CUPO\s*TOTAL/i, 2);
      for (let i = 1; i < calRows.length; i++) {
        const fechaISO = toISO(calRows[i][idxFechaC]);
        if (fechaISO && fechaISO >= monthStartISO && fechaISO <= monthEndISO) {
          monthCapacity += num(calRows[i][idxTotalC]) ?? 0;
        }
      }
    }
  } catch {}

  const monthOccupancy = monthCapacity > 0 ? (monthNights / monthCapacity) * 100 : 0;

  return {
    bookings: totalBookings, totalBookings,
    confirmed, pending, canceled,
    revenue,
    occupancy: monthOccupancy,
    month: { startISO: monthStartISO, endISO: monthEndISO, bookings: monthBookings, revenue: monthRevenue, occupancy: monthOccupancy, nights: monthNights, capacity: monthCapacity }
  };
}


/* ============== SERIES PARA GRÁFICOS (simple) ============== */
export async function getDailySalesSeries(days: number = 14): Promise<{labels: string[], values: number[]}> {
  const { rows } = await readReservationsFlexible();
  const now = dayjs().startOf('day');
  const labels: string[] = [];
  const map: Record<string, number> = {};
  for (let i=days-1;i>=0;i--) {
    const d = now.subtract(i,'day').format('YYYY-MM-DD');
    labels.push(dayjs(d).format('DD/MM'));
    map[d] = 0;
  }
  if (rows.length > 1) {
    const h = rows[0] || [];
    const idxFecha   = [findColIdx(h, /CHECK.?-?\s*IN/i), findColIdx(h, /^FECHA$/i), findColIdx(h, /^FECHA\s+DEL\s+FORM$/i)].find(i => (i ?? -1) >= 0) ?? 2;
    const idxTotal   = findColIdx(h, /^TOTAL$/i, 13);
    const idxEstado  = findColIdx(h, /^ESTADO$/i, 7);
    for (let i=1;i<rows.length;i++) {
      const fechaISO = toISO(rows[i][idxFecha]);
      const estRaw = normalize(rows[i][idxEstado]);
      const est = (estRaw === 'pagado' || estRaw === 'approved') ? 'confirmada' : (estRaw === 'canceled' ? 'cancelada' : estRaw);
      if (!fechaISO || est !== 'confirmada') continue;
      if (map[fechaISO] !== undefined) map[fechaISO] += (num(rows[i][idxTotal]) ?? 0);
    }
  }
  return { labels, values: labels.map((_,i) => map[dayjs().startOf('day').subtract(days-1-i,'day').format('YYYY-MM-DD')] ?? 0) };
}

export async function getInteractionsVsBookingsSeries(days: number = 14): Promise<{labels: string[], interactions: number[], bookings: number[]}> {
  const now = dayjs().startOf('day');
  const labels: string[] = [];
  const interMap: Record<string, number> = {};
  const bookMap: Record<string, number> = {};
  for (let i=days-1;i>=0;i--) {
    const d = now.subtract(i,'day').format('YYYY-MM-DD');
    labels.push(dayjs(d).format('DD/MM'));
    interMap[d] = 0; bookMap[d] = 0;
  }
  // Interacciones desde .notif-state.json (si existe)
  try {
    const fsDyn = await import('fs');
    const path = require('path');
    const notifPath = path.resolve(process.cwd(), 'mvp/.notif-state.json');
    if (fsDyn.existsSync(notifPath)) {
      const raw = JSON.parse(fsDyn.readFileSync(notifPath, 'utf-8'));
      for (const k of Object.keys(raw)) {
        if (!k.startsWith('tok_')) continue;
        const ts = Number(raw[k]?.askedAt || 0);
        if (!ts) continue;
        const d = dayjs(ts);
        const iso = d.startOf('day').format('YYYY-MM-DD');
        if (interMap[iso] !== undefined) interMap[iso] += 1;
      }
    }
  } catch {}
  // Reservas por día desde la hoja
  const { rows } = await readReservationsFlexible();
  if (rows.length > 1) {
    const h = rows[0] || [];
    const idxFecha   = [findColIdx(h, /CHECK.?-?\s*IN/i), findColIdx(h, /^FECHA$/i), findColIdx(h, /^FECHA\s+DEL\s+FORM$/i)].find(i => (i ?? -1) >= 0) ?? 2;
    for (let i=1;i<rows.length;i++) {
      const fechaISO = toISO(rows[i][idxFecha]);
      if (!fechaISO) continue;
      if (bookMap[fechaISO] !== undefined) bookMap[fechaISO] += 1;
    }
  }
  return { labels, interactions: labels.map((_,i)=>interMap[dayjs().startOf('day').subtract(days-1-i,'day').format('YYYY-MM-DD')] ?? 0), bookings: labels.map((_,i)=>bookMap[dayjs().startOf('day').subtract(days-1-i,'day').format('YYYY-MM-DD')] ?? 0) };
}

export async function getRoomsSummarySeries(): Promise<{labels: string[], bookings: number[]}> {
  const { rows } = await readReservationsFlexible();
  if (rows.length <= 1) return { labels: [], bookings: [] };
  const h = rows[0] || [];
  const idxHab = [findColIdx(h, /^HABITACI[ÓO]N$/i), findColIdx(h, /^RECURSO$/i)].find(i => (i ?? -1) >= 0) ?? 3;
  const counts: Record<string, number> = {};
  for (let i=1;i<rows.length;i++) {
    const name = String(rows[i][idxHab] ?? '').trim() || 'N/D';
    counts[name] = (counts[name] ?? 0) + 1;
  }
  const labels = Object.keys(counts);
  const bookings = labels.map(k => counts[k]);
  return { labels, bookings };
}

/* ============== PANEL PRÓXIMOS 7 DÍAS ============== */
export async function getNext7DaysPanel(days: number = 7): Promise<string> {
  const d = Math.max(1, days);
  const start = dayjs().startOf('day');
  const dates = Array.from({ length: d }, (_, i) => start.add(i, 'day'));
  const header = ['Habitación', ...dates.map(x => x.format('DD/MM'))].join('  ');

  const rooms = await getRoomsCatalog();
  const rows: string[] = [header];

  const { rows: resRows } = await readReservationsFlexible();
  const hasData = resRows.length > 1;
  const rh = hasData ? (resRows[0] || []) : [];

  const idxFecha  = hasData ? ([findColIdx(rh, /CHECK.?-?\s*IN/i), findColIdx(rh, /^FECHA$/i), findColIdx(rh, /^FECHA\s+DEL\s+FORM$/i)].find(i => (i ?? -1) >= 0) ?? -1) : -1;
  const idxNoches = hasData ? findColIdx(rh, /^NOCHES$/i, 4) : -1;
  const idxEstado = hasData ? findColIdx(rh, /^ESTADO$/i, 7) : -1;

  let idxHab = hasData ? findColIdx(rh, /HABITACI[ÓO]N|HABITACION|ROOM/i, 1) : -1;
  if (idxHab === -1 && hasData) idxHab = rh.findIndex(h => /hab/i.test(String(h||'')));

  type Res = { roomNorm: string; checkin: dayjs.Dayjs; checkout: dayjs.Dayjs; estado: string };
  const reservations: Res[] = [];
  if (hasData && idxFecha >= 0 && idxNoches >= 0 && idxHab >= 0) {
    for (let i = 1; i < resRows.length; i++) {
      const estadoRaw = normalize(resRows[i][idxEstado]);
      if (!OCCUPANCY_STATES.includes(estadoRaw)) continue;

      const chk = parseAnyDate(resRows[i][idxFecha]);
      const noches = num(resRows[i][idxNoches]) ?? 0;
      if (!chk || noches <= 0) continue;

      const roomNorm = normalize(resRows[i][idxHab]);
      if (!roomNorm) continue;

      const checkin = chk.startOf('day');
      const checkout = checkin.add(noches, 'day');
      reservations.push({ roomNorm, checkin, checkout, estado: estadoRaw });
    }
  }

  const roomMatches = (roomNorm: string, room: Room) => {
    const name = normalize(room.name);
    const id   = normalize(room.id);
    return (
      roomNorm === name || roomNorm === id ||
      roomNorm.includes(name) || roomNorm.includes(id) ||
      name.includes(roomNorm) || id.includes(roomNorm)
    );
  };

  if (!rooms.length) {
    rows.push('(sin habitaciones configuradas)');
  } else {
    for (const r of rooms) {
      const cap = Math.max(1, Number(r.capacity || 1));
      const values: number[] = [];

      for (const day of dates) {
        const count = reservations.reduce((acc, res) => {
          if (!roomMatches(res.roomNorm, r)) return acc;
          const inRange = day.isSame(res.checkin) || (day.isAfter(res.checkin) && day.isBefore(res.checkout));
          return inRange ? acc + 1 : acc;
        }, 0);

        const occupied = OCCUPANCY_MODE === 'capacity' ? (count >= cap) : (count > 0);
        values.push(occupied ? 0 : 1); // 0 = ocupado, 1 = libre
      }

      rows.push(`${(r.name || r.id).trim()}  ${values.join('  ')}`);
    }
  }

  return rows.join('\n');
}

/* ========================================================================== */
/* =====================  CONFIG & FAQ  ===================================== */
/* ========================================================================== */

function headerIndex(header: any[], names: RegExp[]): number {
  const H = (header || []).map(x => String(x || ''));
  for (const rx of names) {
    const idx = H.findIndex(h => rx.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}
function tokenize(t: string) { return normalize(t).split(' ').filter(Boolean); }
function jaccardSim(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

export async function readConfigMap(): Promise<Record<string, string>> {
  const possibleTabs = [process.env.CONFIG_TAB_NAME || 'CONFIG', 'Config', 'config', 'Ajustes', 'Parámetros', 'Parametros'];
  let rows: any[][] = [];
  for (const name of possibleTabs) {
    try { rows = await readAllRows(name); } catch { rows = []; }
    if (rows && rows.length > 1) break;
  }
  if (!rows || rows.length <= 1) return {};

  const h = rows[0] || [];
  const iKey   = headerIndex(h, [/^CLAVE$/i, /^KEY$/i, /^NOMBRE$/i, /^TITULO$/i]);
  const iVal   = headerIndex(h, [/^VALOR$/i, /^VALUE$/i, /^RESPUESTA$/i]);
  const iKwOpt = headerIndex(h, [/PALABRAS.*CLAVE/i, /^KEYWORDS?$/i, /^ALIAS$/i, /^SINONIMOS$/i, /^SINÓNIMOS$/i]);

  const out: Record<string, string> = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawKey = String(row[iKey] ?? '').trim();
    if (!rawKey) continue;
    const rawVal = String(row[iVal] ?? '').trim();
    const keyNorm = normalize(rawKey);
    out[keyNorm] = rawVal;

    if (iKwOpt >= 0 && row[iKwOpt]) {
      const kws = String(row[iKwOpt]).split(/[,;]+/).map(s => normalize(s)).filter(Boolean);
      for (const kw of kws) out[kw] = rawVal;
    }
  }
  return out;
}

type FAQRow = { pregunta: string; respuesta: string; keywords: string[] };

export async function readFAQs(): Promise<FAQRow[]> {
  const possibleTabs = [process.env.FAQ_TAB_NAME || 'FAQ', 'FAQs', 'faq', 'Preguntas', 'F.A.Q.'];
  let rows: any[][] = [];
  for (const name of possibleTabs) {
    try { rows = await readAllRows(name); } catch { rows = []; }
    if (rows && rows.length > 1) break;
  }
  if (!rows || rows.length <= 1) return [];

  const h = rows[0] || [];
  const iQ  = headerIndex(h, [/^PREGUN(TA)?$/i, /^QUESTION$/i, /^Q$/i, /^TITULO$/i, /^TÍTULO$/i]);
  const iA  = headerIndex(h, [/^RESPUESTA$/i, /^ANSWER$/i, /^A$/i]);
  const iKw = headerIndex(h, [/PALABRAS.*CLAVE/i, /^KEYWORDS?$/i]);

  const out: FAQRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const pregunta = String(row[iQ] ?? '').trim();
    const respuesta = String(row[iA] ?? '').trim();
    if (!pregunta || !respuesta) continue;
    const keywords = (iKw >= 0 && row[iKw])
      ? String(row[iKw]).split(/[,;]+/).map(s => normalize(s)).filter(Boolean)
      : [];
    out.push({ pregunta, respuesta, keywords });
  }
  return out;
}

export async function answerQuickFromSheets(userText: string): Promise<string | null> {
  const text = String(userText || '').trim();
  if (!text) return null;
  const norm = normalize(text);
  const tokens = tokenize(text);

  const cfg = await readConfigMap().catch(() => ({} as Record<string, string>));
  if (cfg && Object.keys(cfg).length) {
    for (const [k, v] of Object.entries(cfg)) {
      if (!k) continue;
      const rx = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (rx.test(norm)) return v || null;
    }
    const shortcuts: Record<string, string | undefined> = {
      'pileta': cfg['tiene pileta'] || cfg['pileta'] || cfg['piscina'],
      'piscina': cfg['tiene pileta'] || cfg['pileta'] || cfg['piscina'],
      'check in': cfg['check in hora'] || cfg['check in'] || cfg['ingreso'] || cfg['hora de check in'],
      'check-in': cfg['check in hora'] || cfg['check in'] || cfg['ingreso'] || cfg['hora de check in'],
      'check out': cfg['check out hora'] || cfg['check out'] || cfg['salida'] || cfg['hora de check out'],
      'check-out': cfg['check out hora'] || cfg['check out'] || cfg['salida'] || cfg['hora de check out'],
      'mascotas': cfg['pet friendly'] || cfg['mascotas'] || cfg['aceptan mascotas'],
      'pet friendly': cfg['pet friendly'] || cfg['mascotas'] || cfg['aceptan mascotas'],
      'desayuno': cfg['desayuno'] || cfg['incluye desayuno'] || cfg['desayuno incluido'],
    };
    for (const key of Object.keys(shortcuts)) {
      const rx = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (rx.test(norm) && shortcuts[key]) return shortcuts[key]!;
    }
  }

  const faqs = await readFAQs().catch(() => [] as FAQRow[]);
  if (faqs.length) {
    for (const f of faqs) {
      if (!f.keywords?.length) continue;
      for (const kw of f.keywords) {
        const rx = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (rx.test(norm)) return f.respuesta;
      }
    }
    let bestScore = 0;
    let bestAns: string | null = null;
    for (const f of faqs) {
      const sc = jaccardSim(tokens, tokenize(f.pregunta));
      if (sc > bestScore) { bestScore = sc; bestAns = f.respuesta; }
    }
    if (bestAns && bestScore >= 0.35) return bestAns;
  }
  return null;
}
