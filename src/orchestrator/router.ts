// src/orchestrator/router.ts
import { env } from '../tools/config.js';
import { logger } from '../tools/logger.js';
import { detectIntent, Intent } from './intents.js';
import { analyzeText } from '../tools/aintegrity.js';
import { readTabObjects } from '../tools/sheets.js';
import { chartUrl } from '../tools/charts.js';
import { chat } from '../tools/gpt.js';
import { parseRequest } from '../utils/parserequest.js';
import { notifyAdmin } from '../tools/notify.js';

export type Context = { chatId?: string | number };

// Pestañas reales (según tu planilla)
const TABS = {
  DISPONIBILIDAD: 'CALENDARIO',
  TARIFAS: 'Recursos',
  RESERVAS: 'RESERVAS PROCESADAS'
} as const;

// Tipos mapeados por cabecera
type RowCalendario = {
  'ID RECURSO'?: string;
  'FECHA'?: string;                 // dd/mm/yyyy | yyyy-mm-dd
  'CUPO TOTAL'?: string | number;
  'CUPO BLOQUEADO'?: string | number;
  'PRECIO DIA'?: string | number;
  'ESTADO'?: string;                // abierto | cerrado | agotado ...
};

type RowReservas = {
  'FECHA DEL FORM'?: string;
  'HABITACION'?: string;
  'CHECK- IN'?: string;
  'CHECK- OUT'?: string;
  'NOCHES'?: string | number;
  'PERSONAS'?: string | number;
  'PRECIO_POR_NOCHE\n'?: string | number; // esa cabecera rara existe en tu sheet
  'ESTADO'?: string;
  'ID RESERVA'?: string;
  'TOTAL'?: string | number;
};

function toNumber(x: any, def = 0) {
  if (x === null || x === undefined) return def;
  const n = Number(String(x).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return isNaN(n) ? def : n;
}
function normISO(s?: string | number): string | null {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  // yyyy-mm-dd
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t.slice(0, 10);
  // dd/mm/yyyy o dd-mm-yyyy
  const eu = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (eu) {
    const d = parseInt(eu[1], 10), m = parseInt(eu[2], 10);
    const y = parseInt(eu[3].length === 2 ? `20${eu[3]}` : eu[3], 10);
    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  return null;
}
const inRange = (iso: string, fromIso: string, toIso: string) => iso >= fromIso && iso <= toIso;
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export async function handleMessage(text: string, ctx: Context = {}) {
  const intent: Intent = detectIntent(text);

  // TRIAGE + handoff (opcional según flags)
  if (env.TRIAGE_ENABLED) {
    try {
      const verdict = await analyzeText(text);
      if (!verdict.public || verdict.forwardToAdmin) {
        await notifyAdmin(`[ESCALADO] chatId=${ctx.chatId ?? '-'} · "${text.slice(0, 300)}"`);
        return 'Gracias por tu mensaje. Te contacta un agente humano en breve.';
      }
    } catch (e) {
      logger.warn({ err: e }, 'Triage failed — continuing as public');
    }
  }

  try {
    switch (intent) {
      case 'saludo':
        return '¡Hola! Soy tu asistente para reservas y tours. ¿En qué te ayudo?';

      case 'disponibilidad': {
        const req = parseRequest(text); // { from?: 'yyyy-mm-dd', to?: 'yyyy-mm-dd', guests?: number }
        if (!req.from || !req.to) {
          return '¿Para qué fechas? Podés decirme: "para 2 personas del 10/11 al 12/11".';
        }
        const guests = req.guests ?? 2;

        try {
          const rows = await readTabObjects<RowCalendario>(TABS.DISPONIBILIDAD, 'A1:F2000');
          const normalized = rows.map(r => ({
            date: normISO(r['FECHA']),
            total: toNumber(r['CUPO TOTAL']),
            blocked: toNumber(r['CUPO BLOQUEADO']),
            price: toNumber(r['PRECIO DIA']),
            estado: String(r['ESTADO'] ?? '').toLowerCase().trim()
          }));

          const filtered = normalized
            .filter(r => !!r.date && inRange(r.date!, req.from!, req.to!))
            .filter(r => r.estado !== 'cerrado' && r.estado !== 'agotado');

          if (!filtered.length) {
            return `No veo disponibilidad entre ${fmt(req.from!)} y ${fmt(req.to!)}. ¿Querés otras fechas?`;
          }

          const nights = filtered.length;
          const daysOk = filtered.filter(d => d.total - d.blocked >= guests).length;
          const priceTotal = filtered.reduce((acc, d) => acc + d.price, 0);

          const sample = filtered
            .slice(0, 3)
            .map(d => `${fmt(d.date!)}: cupo ${Math.max(0, d.total - d.blocked)}, $${d.price.toFixed(0)}`)
            .join(' · ');

          if (daysOk === 0) {
            return `Entre ${fmt(req.from!)} y ${fmt(req.to!)} no hay cupo suficiente para ${guests} personas. Puedo sugerir fechas alternativas.`;
          }

          return `Disponibilidad del ${fmt(req.from!)} al ${fmt(req.to!)}:
- Noches consultadas: ${nights}
- Cupo OK para ${guests}: ${daysOk}/${nights} noches
- Precio estimado total (suma de PRECIO DIA): $${priceTotal.toFixed(0)}
Ejemplos: ${sample}

Si te sirve, te reservo.`;
        } catch (e) {
          logger.error({ err: e }, 'Sheets read error (disponibilidad)');
          return 'No puedo leer disponibilidad ahora mismo. Ya lo reviso.';
        }
      }

      case 'precios': {
        const req = parseRequest(text);
        if (!req.from || !req.to) {
          return 'Decime fechas para calcular precio: por ejemplo "precio del 15/11 al 17/11".';
        }
        try {
          const rows = await readTabObjects<RowCalendario>(TABS.DISPONIBILIDAD, 'A1:F2000');
          const filtered = rows
            .map(r => ({ date: normISO(r['FECHA']), price: toNumber(r['PRECIO DIA']) }))
            .filter(r => r.date && inRange(r.date!, req.from!, req.to!));

          if (!filtered.length) {
            return `No encuentro precios entre ${fmt(req.from!)} y ${fmt(req.to!)}. ¿Podés verificar las fechas?`;
          }
          const nights = filtered.length;
          const total = filtered.reduce((acc, d) => acc + d.price, 0);
          const avg = total / nights;
          return `Tarifa entre ${fmt(req.from!)} y ${fmt(req.to!)}:
- Noches: ${nights}
- Total estimado: $${total.toFixed(0)}
- Promedio por noche: $${avg.toFixed(0)}
*(Basado en PRECIO DIA en la pestaña ${TABS.DISPONIBILIDAD}).*`;
        } catch (e) {
          logger.error({ err: e }, 'Sheets read error (precios)');
          return 'No puedo consultar tarifas ahora mismo.';
        }
      }

      case 'resumen': {
        try {
          const rows = await readTabObjects<RowReservas>(TABS.RESERVAS, 'A1:Z2000');
          const total = rows.length;
          const confirmadas = rows.filter(r => String(r['ESTADO'] ?? '').toLowerCase().includes('confirm')).length;
          const pendientes = rows.filter(r => String(r['ESTADO'] ?? '').toLowerCase().includes('pend')).length;
          const recaudado = rows.reduce((acc, r) => acc + toNumber(r['TOTAL']), 0);

          // Check-in últimos 7 días
          const sevenAgoISO = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
          const i7 = rows
            .map(r => normISO(r['CHECK- IN'] ?? r['FECHA DEL FORM']))
            .filter((iso): iso is string => !!iso && iso >= sevenAgoISO).length;

          return `Resumen (${TABS.RESERVAS}):
- Reservas: ${total}
- Confirmadas: ${confirmadas}
- Pendientes: ${pendientes}
- Total facturado: $${recaudado.toFixed(0)}
- Registros últimos 7 días: ${i7}`;
        } catch (e) {
          logger.error({ err: e }, 'Sheets read error (resumen)');
          return 'No puedo generar el resumen ahora mismo.';
        }
      }

      case 'grafico': {
        if (!env.CHARTS_ENABLED) return 'La generación de gráficos está desactivada.';
        try {
          // Construimos un gráfico con reservas por día (últimos 10 días) usando CHECK- IN o FECHA DEL FORM
          const rows = await readTabObjects<RowReservas>(TABS.RESERVAS, 'A1:Z2000');
          const todayISO = new Date().toISOString().slice(0, 10);
          const tenAgoISO = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);

          const counts = new Map<string, number>();
          for (const r of rows) {
            const iso = normISO(r['CHECK- IN'] ?? r['FECHA DEL FORM']);
            if (!iso || iso < tenAgoISO || iso > todayISO) continue;
            counts.set(iso, (counts.get(iso) ?? 0) + 1);
          }

          // aseguramos todos los días del rango
          const labelsISO: string[] = [];
          for (let i = 9; i >= 0; i--) {
            labelsISO.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
          }
          const labels = labelsISO.map(fmt);
          const data = labelsISO.map(iso => counts.get(iso) ?? 0);

          const cfg = {
            type: 'line',
            data: {
              labels,
              datasets: [{ label: 'Reservas (últimos 10 días)', data }]
            },
            options: { plugins: { legend: { display: true } } }
          };
          const url = await chartUrl(cfg);
          return `Aquí tenés el gráfico de reservas (últimos 10 días): ${url}`;
        } catch (e) {
          logger.error({ err: e }, 'Chart error');
          // Fallback a demo
          try {
            const demo = await chartUrl({
              type: 'line',
              data: { labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'], datasets: [{ label: 'Reservas', data: [3, 5, 2, 6, 4] }] }
            });
            return `No pude graficar desde la planilla, te dejo un ejemplo: ${demo}`;
          } catch {
            return 'No pude generar el gráfico ahora mismo.';
          }
        }
      }

      case 'itinerario':
        return 'Nuestros tours tienen salidas diarias. Decime qué tour te interesa y te paso duración y punto de encuentro.';

      case 'politicas':
        return 'Políticas clave: cancelación hasta 24h con reembolso total, check-in 14:00, check-out 11:00. ¿Querés el detalle?';

      case 'contacto_humano': {
        await notifyAdmin(`[ESCALADO MANUAL] chatId=${ctx.chatId ?? '-'} · "${text.slice(0, 300)}"`);
        return 'Te contacto con un agente humano ahora. Gracias por tu paciencia.';
      }

      case 'fallback':
      default: {
        const answer = await chat([{ role: 'user', content: text }]);
        return answer?.trim() || 'No me quedó claro. ¿Podés reformular o dar más detalles?';
      }
    }
  } catch (e) {
    logger.error({ err: e }, 'Router fatal error');
    return 'Tuvimos un inconveniente procesando tu mensaje. Ya lo reviso.';
  }
}
