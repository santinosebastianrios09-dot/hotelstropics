// src/tools/sheets.ts
import 'dotenv/config';
import { google } from 'googleapis';
import NodeCache from 'node-cache';
import dayjs from 'dayjs';

const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL_SECONDS || '60', 10) });

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? process.env.SPREADSHEET_ID;
if (!SPREADSHEET_ID) throw new Error('Falta GOOGLE_SHEETS_SPREADSHEET_ID o SPREADSHEET_ID en .env');

const TAB_NAME = process.env.SHEETS_TAB_NAME; // opcional: si no se setea, se autodescubre

type Reserva = {
  fechaForm: string;            // FECHA DEL FORM (texto)
  habitacion: string;           // HABITACION
  checkIn: string;              // CHECK- IN
  checkOut: string;             // CHECK- OUT
  noches: number;               // NOCHES
  personas: string;             // PERSONAS (a veces nombre en tus datos)
  precioPorNoche: number;       // PRECIO_POR_NOCHE
  estado: 'pendiente'|'Pagado'|'Pagado '|'pendiente '|string; // estados variados
  idReserva: string;            // ID RESERVA
  transaccionId: string;        // TRANSACCION ID
  nombreTitular: string;        // NOMBRE TITULAR
  email: string;                // EMAIL
  telefono: string;             // TELEFONO
  total: number | null;         // TOTAL (puede faltar)
  _rowIndex: number;            // índice de fila (1-based en Sheets)
};

function normalizeHeader(h: string): string {
  // Limpia espacios, saltos de línea, guiones extraños y tildes simples
  return h
    .replace(/\n/g, '')
    .replace(/\s*-\s*/g, '-')     // "CHECK- IN" -> "CHECK-IN"
    .replace(/\s+/g, ' ')         // espacios múltiples -> uno
    .trim()
    .toUpperCase();
}

function parseMoney(s?: string | number | null): number | null {
  if (s == null) return null;
  const t = String(s).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(s?: string | number | null): number {
  const n = parseInt(String(s ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function dateISO(s?: string | null): string {
  // Admite formatos tipo 3/1/2026 (D/M/YYYY) o 29/09/2025 HH:mm:ss
  if (!s) return '';
  const t = String(s).trim();
  // dayjs sin locales: intentamos DD/MM/YYYY o D/M/YYYY
  const parts = t.split(/[\/\s:]/).map(x => x.trim());
  // Heurística simple: si formato corto D/M/YYYY al comienzo
  if (parts.length >= 3 && parts[2].length === 4) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (d && m && y) {
      const iso = dayjs(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`).format('YYYY-MM-DD');
      return iso;
    }
  }
  // fallback: que dayjs lo intente
  const iso = dayjs(t).isValid() ? dayjs(t).format('YYYY-MM-DD') : '';
  return iso;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function resolveTabName(sheets = await getSheetsClient()): Promise<string> {
  if (TAB_NAME) return TAB_NAME;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const title = meta.data.sheets?.[0]?.properties?.title;
  if (!title) throw new Error('No se encontró ninguna pestaña (tab) en la planilla.');
  return title;
}

function mapRowToReserva(headers: string[], row: any[], rowIndex: number): Reserva {
  // Creamos un mapa header->valor
  const map = new Map<string, any>();
  headers.forEach((h, i) => {
    map.set(normalizeHeader(h), row[i]);
  });

  const get = (key: string) => map.get(normalizeHeader(key));

  const res: Reserva = {
    fechaForm: String(get('FECHA DEL FORM') ?? ''),
    habitacion: String(get('HABITACION') ?? ''),
    checkIn: String(get('CHECK- IN') ?? get('CHECK-IN') ?? ''),
    checkOut: String(get('CHECK- OUT') ?? get('CHECK-OUT') ?? ''),
    noches: parseIntSafe(get('NOCHES')),
    personas: String(get('PERSONAS') ?? ''),
    precioPorNoche: parseMoney(get('PRECIO_POR_NOCHE') ?? get('PRECIO POR NOCHE') ?? get('PRECIO_POR_NOCHE ')) ?? 0,
    estado: String(get('ESTADO') ?? ''),
    idReserva: String(get('ID RESERVA') ?? get('ID_RESERVA') ?? ''),
    transaccionId: String(get('TRANSACCION ID') ?? get('TRANSACCIÓN ID') ?? get('TRANSACCIONID') ?? ''),
    nombreTitular: String(get('NOMBRE TITULAR') ?? ''),
    email: String(get('EMAIL') ?? ''),
    telefono: String(get('TELEFONO') ?? get('TELÉFONO') ?? ''),
    total: parseMoney(get('TOTAL')),
    _rowIndex: rowIndex, // fila real de Sheets (1-based)
  };
  return res;
}

/** Lee todas las reservas (con caché en memoria). */
export async function listarReservas(force = false): Promise<Reserva[]> {
  const cacheKey = 'sheets:reservas:all';
  if (!force) {
    const hit = cache.get<Reserva[]>(cacheKey);
    if (hit) return hit;
  }
  const sheets = await getSheetsClient();
  const tab = await resolveTabName(sheets);
  const range = `'${tab}'!A1:Z9999`;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const values = resp.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0];
  const rows = values.slice(1);

  const reservas = rows.map((row, idx) =>
    mapRowToReserva(headers, row, idx + 2) // +2 porque headers están en fila 1
  );

  cache.set(cacheKey, reservas);
  return reservas;
}

/** Busca una reserva por ID (ej.: R-003) */
export async function getReservaById(id: string): Promise<Reserva | null> {
  const all = await listarReservas();
  return all.find(r => r.idReserva === id) ?? null;
}

/** Actualiza el campo ESTADO de una reserva por ID (devuelve true si escribió). */
export async function updateEstado(id: string, nuevoEstado: string): Promise<boolean> {
  const sheets = await getSheetsClient();
  const tab = await resolveTabName(sheets);
  const reservas = await listarReservas(true);

  const target = reservas.find(r => r.idReserva === id);
  if (!target) return false;

  // necesitamos columna exacta del ESTADO
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'!1:1`,
  });
  const headers = (meta.data.values?.[0] ?? []).map(normalizeHeader);
  const colIndex = headers.indexOf('ESTADO');
  if (colIndex === -1) throw new Error('No encontré la columna ESTADO');

  const cell = `'${tab}'!${colLetter(colIndex)}${target._rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: cell,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[nuevoEstado]] },
  });

  cache.del('sheets:reservas:all');
  return true;
}

/** Inserta una nueva fila al final (escritura simple). */
export async function crearReserva(input: Partial<Reserva>): Promise<string> {
  const sheets = await getSheetsClient();
  const tab = await resolveTabName(sheets);

  // Leemos headers para respetar el orden
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'!1:1`,
  });
  const headers: string[] = meta.data.values?.[0] ?? [];
  const normalized = headers.map(normalizeHeader);

  // Construimos la fila en el orden de headers
  const row: any[] = headers.map((h, i) => {
    const key = normalized[i];
    switch (key) {
      case 'FECHA DEL FORM': return input.fechaForm ?? new Date().toLocaleString('es-AR');
      case 'HABITACION': return input.habitacion ?? '';
      case 'CHECK- IN':
      case 'CHECK-IN': return input.checkIn ?? '';
      case 'CHECK- OUT':
      case 'CHECK-OUT': return input.checkOut ?? '';
      case 'NOCHES': return input.noches ?? '';
      case 'PERSONAS': return input.personas ?? '';
      case 'PRECIO_POR_NOCHE':
      case 'PRECIO POR NOCHE': return input.precioPorNoche ?? '';
      case 'ESTADO': return input.estado ?? 'pendiente';
      case 'ID RESERVA':
      case 'ID_RESERVA': return input.idReserva ?? '';
      case 'TRANSACCION ID':
      case 'TRANSACCIÓN ID':
      case 'TRANSACCIONID': return input.transaccionId ?? '';
      case 'NOMBRE TITULAR': return input.nombreTitular ?? '';
      case 'EMAIL': return input.email ?? '';
      case 'TELEFONO':
      case 'TELÉFONO': return input.telefono ?? '';
      case 'TOTAL': return input.total ?? '';
      default: return '';
    }
  });

  const appendRange = `'${tab}'!A1`;
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: appendRange,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  cache.del('sheets:reservas:all');

  // devolvemos el ID de reserva si vino en input o el range actualizado
  return input.idReserva ?? (resp.data.updates?.updatedRange ?? 'OK');
}

/** Disponibilidad: devuelve si una habitación se solapa con un rango. */
export async function disponibilidad(habitacionId: string, desdeISO: string, hastaISO: string) {
  const all = await listarReservas();
  const start = dayjs(desdeISO);
  const end = dayjs(hastaISO);

  const overlap = all.filter(r => {
    if (!r.habitacion) return false;
    // Normalizamos fechas de r
    const inISO = dateISO(r.checkIn);
    const outISO = dateISO(r.checkOut);
    if (!inISO || !outISO) return false;
    const rin = dayjs(inISO);
    const rout = dayjs(outISO);

    // solapa si [rin, rout) intersecta [start, end)
    const solapa = rin.isBefore(end) && start.isBefore(rout);
    const mismaHabitacion = r.habitacion.includes(habitacionId); // H-004, H-002, etc.
    const activa = String(r.estado).toLowerCase().includes('paga') || String(r.estado).toLowerCase().includes('pend');
    return solapa && mismaHabitacion && activa;
  });

  return {
    habitacionId,
    desdeISO,
    hastaISO,
    conflictos: overlap.map(o => ({ id: o.idReserva, estado: o.estado, checkIn: dateISO(o.checkIn), checkOut: dateISO(o.checkOut) })),
    disponible: overlap.length === 0,
  };
}

function colLetter(idxZeroBased: number): string {
  // 0->A, 1->B ...
  let n = idxZeroBased;
  let s = '';
  do {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
