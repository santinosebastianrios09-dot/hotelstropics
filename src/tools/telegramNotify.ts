// mvp_AGENTS/src/tools/telegramNotify.ts
import 'dotenv/config';
import { Telegraf } from 'telegraf';

function required(name: string, val?: string) {
  if (!val) throw new Error(`Falta ${name} en .env`);
  return val;
}

const TELEGRAM_BOT_TOKEN = required('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_ADMIN_CHAT_ID = required('TELEGRAM_ADMIN_CHAT_ID', process.env.TELEGRAM_ADMIN_CHAT_ID);

// NOTA: no lanzamos el bot; solo usamos el cliente para enviar mensajes
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

export type NewReservationPayload = {
  id: string;             // p.ej. W-MGJQQKR8
  nombre: string;
  email?: string;
  fecha: string;          // check-in ISO YYYY-MM-DD
  noches: number;
  habitacion?: string;
  precioTotal?: number;   // opcional
  fuente?: 'web' | 'telegram' | string;
};

export async function notifyNewReservation(payload: NewReservationPayload) {
  const lines = [
    '🆕 <b>Nueva reserva (web):</b>',
    `• <b>ID:</b> ${payload.id}`,
    `• <b>Hu\u00E9sped:</b> ${payload.nombre}`,
    `• <b>Check-in:</b> ${payload.fecha} (${payload.noches} ${payload.noches === 1 ? 'noche' : 'noches'})`,
    `• <b>Habitaci\u00F3n:</b> ${payload.habitacion || '-'}`,
    payload.precioTotal != null ? `• <b>Total:</b> ${payload.precioTotal}` : undefined,
    payload.email ? `• <b>Email:</b> ${payload.email}` : undefined,
  ].filter(Boolean);

  const text = lines.join('\n');
  await bot.telegram.sendMessage(
    Number(TELEGRAM_ADMIN_CHAT_ID),
    text,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}
