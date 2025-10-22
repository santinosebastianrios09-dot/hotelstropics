// src/tools/handlers.ts
import type { Context } from 'telegraf';
import { getWeeklyChartUrl, getMonthlyRevenue, getBookedRoomsToday } from './charts';
import { sheets } from './sheets';

export const showResumen = async (ctx: Context) => {
  try {
    const revenue = await getMonthlyRevenue();
    const chart = await getWeeklyChartUrl();
    await ctx.reply(`Resumen mensual\nIngresos: $${revenue}`);
    if (chart) {
      await ctx.replyWithPhoto({ url: chart }, { caption: 'Reservas por semana' });
    }
  } catch (e: any) {
    await ctx.reply('⚠️ No pude generar el resumen.');
  }
};

export const showDisponibilidad = async (ctx: Context) => {
  try {
    const rooms = await getBookedRoomsToday();
    const text = rooms && rooms.length
      ? `Habitaciones reservadas hoy: ${rooms.join(', ')}`
      : 'No hay reservas hoy.';
    await ctx.reply(text);
  } catch (e: any) {
    await ctx.reply('⚠️ No pude consultar disponibilidad.');
  }
};

export const recalcTotales = async (ctx: Context) => {
  try {
    await sheets.fixTotals();
    await ctx.reply('Totales recalculados ✅');
  } catch (e: any) {
    await ctx.reply('⚠️ No pude recalcular totales.');
  }
};

export const startAyuda = async (ctx: Context) => {
  await ctx.reply(
    'Opciones: "■ Nueva reserva", "■ Resumen", "■ Disponibilidad", "■ Recalcular totales", "✏ Cambiar estado"'
  );
};

export const promptNuevaReserva = async (ctx: Context) => {
  await ctx.reply('Este bot es para managers. Las reservas las maneja el agente web en la página del hotel.');
};

export const promptCambioEstado = async (ctx: Context) => {
  await ctx.reply('Decime el ID de la reserva y el nuevo estado (p. ej., "#123 Confirmada").');
};
