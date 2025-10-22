export type ParsedRequest = {
  guests?: number;
  from?: string; // ISO yyyy-mm-dd
  to?: string;   // ISO yyyy-mm-dd
};

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Acepta: dd/mm, dd/mm/yyyy, dd-mm, dd-mm-yyyy
function parseDateLike(s: string, ref?: Date): Date | null {
  const txt = s.trim().replace(/\./g, '/').replace(/-/g, '/');
  const m = txt.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const [, dStr, moStr, yStr] = m;
  const d = Number(dStr);
  const mo = Number(moStr);
  if (!d || !mo) return null;
  let y: number;
  if (yStr) {
    y = Number(yStr.length === 2 ? `20${yStr}` : yStr);
  } else {
    y = (ref ?? new Date()).getFullYear();
  }
  const out = new Date(y, mo - 1, d);
  return isNaN(out.getTime()) ? null : out;
}

/**
 * Ejemplos que parsea:
 * - "para 2 del 10/11 al 12/11"
 * - "2 personas 05-11-2025 a 07/11/2025"
 * - "disponibilidad 3 adultos 10/11-12/11"
 */
export function parseRequest(text: string): ParsedRequest {
  const out: ParsedRequest = {};
  const lower = text.toLowerCase();

  // huéspedes
  const g = lower.match(/(\d+)\s*(hu[eé]spedes|personas|adultos?)/);
  if (g) out.guests = Number(g[1]);

  // rango: dd/mm(/yyyy) (al|a|-) dd/mm(/yyyy)
  const r = lower.match(
    /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s*(?:al|a|[-–])\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/
  );
  if (r) {
    const d1 = parseDateLike(r[1]);
    const d2 = parseDateLike(r[2], d1 ?? undefined);
    if (d1) out.from = toISO(d1);
    if (d2) out.to = toISO(d2);
  }

  return out;
}
