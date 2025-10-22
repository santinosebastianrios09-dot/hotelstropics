// mvp_AGENTS/src/tools/config.ts
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/** Intenta cargar .env desde varios lugares (soporta Opción A: correr desde mvp/) */
function loadEnvOnce() {
  // Evita recargar .env si ya se cargó
  if ((process as any).__ENV_LOADED__) return;
  (process as any).__ENV_LOADED__ = true;

  const candidates = [
    path.resolve(process.cwd(), '.env'),          // mvp/.env  (Opción A: corremos desde mvp)
    path.resolve(process.cwd(), '../.env'),       // por si corren desde mvp_AGENTS
    path.resolve(process.cwd(), '../../.env'),    // por si hay otra profundidad
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const r = dotenv.config({ path: p });
        if (!r.error) {
          // console.log('[config] .env cargado desde:', p);
          return;
        }
      }
    } catch { /* ignore */ }
  }

  // Si no encontró nada, igualmente intentamos dotenv por defecto
  dotenv.config();
}
loadEnvOnce();

/** Devuelve un string saneado: recorta y convierte '' a undefined */
function s(v?: string | null): string | undefined {
  const t = (v ?? '').toString().trim();
  return t.length ? t : undefined;
}

/** Enmascara valores para logueo opcional */
export function mask(v?: string) {
  if (!v) return '(vacío)';
  if (v.length <= 8) return '****';
  return v.slice(0, 4) + '****' + v.slice(-4);
}

export type AppConfig = {
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_USER_IDS?: string; // coma-separados
  PORT?: number;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  GOOGLE_SHEETS_SPREADSHEET_ID?: string;
  SHEETS_TAB_NAME?: string;
  CHARTS_ENABLED?: boolean;
  HYBRID_AGENT_ENABLED?: boolean;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  QUICKCHART_ENABLED?: boolean;
};

/**
 * Lee variables de entorno y valida lo mínimo indispensable.
 * @param strict Si true, exige TELEGRAM_BOT_TOKEN (útil para lanzar el bot). Si false, no tira error (útil para scripts de diagnóstico).
 */
export function getConfig(strict = true): AppConfig {
  const TELEGRAM_BOT_TOKEN = s(process.env.TELEGRAM_BOT_TOKEN);

  // Permisos: acepta ADMIN_USER_IDS o fallback a TELEGRAM_ADMIN_CHAT_ID (uno solo)
  const ADMIN_USER_IDS =
    s(process.env.ADMIN_USER_IDS) ??
    (s(process.env.TELEGRAM_ADMIN_CHAT_ID) ? String(process.env.TELEGRAM_ADMIN_CHAT_ID) : undefined);

  const cfg: AppConfig = {
    TELEGRAM_BOT_TOKEN: TELEGRAM_BOT_TOKEN || '',
    ADMIN_USER_IDS,
    PORT: process.env.PORT ? Number(process.env.PORT) : undefined,
    GOOGLE_APPLICATION_CREDENTIALS: s(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    GOOGLE_SHEETS_SPREADSHEET_ID: s(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
    SHEETS_TAB_NAME: s(process.env.SHEETS_TAB_NAME),
    CHARTS_ENABLED: s(process.env.CHARTS_ENABLED)?.toLowerCase() === 'true',
    HYBRID_AGENT_ENABLED: s(process.env.HYBRID_AGENT_ENABLED)?.toLowerCase() === 'true',
    OPENAI_API_KEY: s(process.env.OPENAI_API_KEY),
    OPENAI_MODEL: s(process.env.OPENAI_MODEL),
    QUICKCHART_ENABLED: s(process.env.QUICKCHART_ENABLED)?.toLowerCase() === 'true',
  };

  if (strict && !cfg.TELEGRAM_BOT_TOKEN) {
    // Mensaje claro y corto
    throw new Error('Falta TELEGRAM_BOT_TOKEN en .env');
  }

  return cfg;
}
