// mvp_AGENTS/src/web/api/sheetsAvailability.js
// Capa de disponibilidad / holds / reservas basada en Google Sheets,
// adaptada a la hoja real "RESERVAS PROCESADAS" con encabezados en español.
// Requiere .env con: GOOGLE_SHEETS_ID, GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY
// Opcional .env: SHEETS_RESERVAS_SHEET="RESERVAS PROCESADAS"

const { google } = require('googleapis');
const crypto = require('crypto');

const SHEET_NAME = process.env.SHEETS_RESERVAS_SHEET || 'RESERVAS PROCESADAS';

/* ================== AUTH ================== */
function getJWT() {
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return new google.auth.JWT(
    process.env.GOOGLE_SA_CLIENT_EMAIL,
    null,
    key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

/* ================== HELPERS ================== */
function genId() {
  return 'ord_' + crypto.randomBytes(8).toString('hex');
}

function toISO(d) {
  // acepta 2025-10-17 o 17/10/2025
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2,'0');
    const mm = String(m[2]).padStart(2,'0');
    return `${m[3]}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0,10);
  return '';
}

function asNum(x, def = '') {
  if (x === null || x === undefined || x === '') return def;
  const s = String(x).replace(/[^\d.,-]/g,'').replace(',','.');
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

function caseKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}

/* ================== SHEETS I/O ================== */
async function readHeaderAndRows(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${SHEET_NAME}!A1:ZZ10000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const values = resp.data.values || [];
  const header = (values[0] || []).map(String);
  const rows   = values.slice(1);
  return { header, rows };
}

function buildIndex(header) {
  // índice por nombre normalizado; si hay duplicados (p. ej. dos "ESTADO"), toma el de la DERECHA
  const map = {};
  header.forEach((h, i) => { map[caseKey(h)] = i; });
  return map;
}

/* Campos internos estándar que el sistema maneja */
const INTERNAL_FIELDS = [
  'id','created_at','status','room','checkin','checkout','nights',
  'name','email','phone','pax','price_per_night','total','currency','source'
];

/* Mapeo flexible: interno → posibles nombres de columna en TU hoja */
const HEADER_GUESS = {
  id:                ['id','i d'],
  created_at:        ['created_at','creado','fecha alta','fecha creacion'],
  status:            ['estado','status'],
  room:              ['habitacion','hab','room'],
  checkin:           ['check-in','check in','entrada','fecha entrada'],
  checkout:          ['check-out','check out','salida','fecha salida'],
  nights:            ['noches','nights'],
  name:              ['nombre titular','titular','nombre'],
  email:             ['email','e-mail','correo'],
  phone:             ['telefono','teléfono','phone'],
  pax:               ['personas','pax','huéspedes','huespedes'],
  price_per_night:   ['precio_por_noche','precio por noche','rate','tarifa'],
  total:             ['total','importe','monto'],
  currency:          ['moneda','currency'],
  source:            ['origen','source','fuente','estado (origen)'] // si hay dos "ESTADO", el de la derecha se toma como textual
};

function resolveColumnIndexes(header) {
  const idx = buildIndex(header);
  const resolved = {};
  for (const key of Object.keys(HEADER_GUESS)) {
    const candidates = HEADER_GUESS[key];
    let found = -1;
    for (const c of candidates) {
      const k = caseKey(c);
      if (idx[k] !== undefined) found = idx[k];
    }
    resolved[key] = found; // -1 si no existe en tu hoja → se escribirá ""
  }

  // Caso especial: dos columnas “ESTADO”
  // Si existen dos "estado", una suele ser precio/estado monetario y otra el textual ("pendiente/pagado").
  // Nos quedamos con la más a la DERECHA para "status".
  const estadoPositions = header.map((h,i)=> [caseKey(h),i]).filter(([k])=> k==='estado' || k==='status').map(([,i])=>i);
  if (estadoPositions.length >= 2) {
    resolved.status = Math.max(...estadoPositions);
  } else if (estadoPositions.length === 1) {
    resolved.status = estadoPositions[0];
  }

  return resolved;
}

async function appendByHeader(sheets, header, rowObj) {
  const map = resolveColumnIndexes(header);
  const out = new Array(header.length).fill('');

  // Normalizaciones
  rowObj.checkin  = toISO(rowObj.checkin);
  rowObj.checkout = toISO(rowObj.checkout);
  rowObj.nights   = asNum(rowObj.nights, '');
  rowObj.pax      = asNum(rowObj.pax,    '');
  rowObj.price_per_night = asNum(rowObj.price_per_night, '');
  rowObj.total    = asNum(rowObj.total,  '');
  rowObj.currency = String(rowObj.currency || 'USD').toUpperCase();
  rowObj.source   = rowObj.source || 'web';

  for (const k of Object.keys(HEADER_GUESS)) {
    const i = map[k];
    if (i >= 0) out[i] = (rowObj[k] === undefined ? '' : rowObj[k]);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${SHEET_NAME}!A:ZZ`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [out] },
  });
}

/* ================== LÓGICA DE NEGOCIO ================== */

// Solape estricto de rangos [a,b) con [c,d)
function overlaps(ciA, coA, ciB, coB) {
  const a0 = new Date(ciA).getTime();
  const a1 = new Date(coA).getTime();
  const b0 = new Date(ciB).getTime();
  const b1 = new Date(coB).getTime();
  return (a0 < b1) && (b0 < a1);
}

async function readAllNormalized() {
  const jwt = getJWT();
  const sheets = google.sheets({ version: 'v4', auth: jwt });
  const { header, rows } = await readHeaderAndRows(sheets);
  return { header, rows, sheets };
}

// Disponibilidad contra tu hoja real
async function isAvailable({ room, checkin, checkout }) {
  const { header, rows } = await readAllNormalized();
  if (!header.length) throw new Error(`La hoja "${SHEET_NAME}" está vacía o sin encabezados.`);

  const m = resolveColumnIndexes(header);
  if (m.room < 0 || m.checkin < 0 || m.checkout < 0) {
    throw new Error(`Faltan columnas clave (habitacion / check-in / check-out) en "${SHEET_NAME}".`);
  }

  const ci = toISO(checkin);
  const co = toISO(checkout);
  const wantedRoom = String(room || '').toLowerCase();

  for (const r of rows) {
    const rRoom = String(r[m.room] || '').toLowerCase();
    if (!rRoom || rRoom !== wantedRoom) continue;

    const ciRow = toISO(r[m.checkin] || '');
    const coRow = toISO(r[m.checkout] || '');
    if (!ciRow || !coRow) continue;

    if (overlaps(ci, co, ciRow, coRow)) {
      return { ok: false, reason: 'conflict' };
    }
  }
  return { ok: true };
}

// Crea HOLD (reserva tentativa) en tu hoja
async function createHold({ room, checkin, checkout, nights, name, email, phone, pax, price_per_night, total, currency }) {
  const { header, sheets } = await readAllNormalized();
  const id = genId();

  // Si no vienen noches pero sí fechas, las calculamos
  let n = asNum(nights, '');
  const ci = toISO(checkin);
  const co = toISO(checkout);
  if (!n && ci && co) {
    const d1 = new Date(ci + 'T00:00:00Z');
    const d2 = new Date(co + 'T00:00:00Z');
    const days = Math.max(0, Math.round((d2 - d1) / 86400000));
    n = days || '';
  }

  const row = {
    id,
    created_at: new Date().toISOString(),
    status: 'pendiente',
    room,
    checkin: ci,
    checkout: co,
    nights: n,
    name,
    email,
    phone,
    pax,
    price_per_night,
    total,
    currency,
    source: 'web',
  };

  await appendByHeader(sheets, header, row);
  return { ok: true, id };
}

module.exports = {
  isAvailable,
  createHold,
};
