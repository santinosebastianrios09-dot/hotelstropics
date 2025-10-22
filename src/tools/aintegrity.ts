// src/tools/aintegrity.ts
import { getConfig } from './config';

// Respeta el contrato básico: POST /v1/analyze con header X-AIIntegrity-Key
export async function analyzeText(text: string): Promise<{
  ok: boolean;
  isComplex?: boolean;
  toxicity?: number;
  pii?: boolean;
  raw?: any;
}> {
  const cfg = getConfig();
  if (!cfg.AINTEGRITY_API_BASE || !cfg.AINTEGRITY_KEY) {
    return { ok: true, isComplex: false }; // deshabilitado
  }
  const url = `${cfg.AINTEGRITY_API_BASE.replace(/\/+$/,'')}/v1/analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'X-AIIntegrity-Key': cfg.AINTEGRITY_KEY,
    } as any,
    body: JSON.stringify({
      text,
      options: { sync: true, language: 'es' }
    }),
  });
  if (!res.ok) return { ok: false };
  const data = await res.json();
  // Heurística simple basada en summary/flags si existen:
  const summary = data?.summary || {};
  const isComplex = !!summary?.is_complex || false;
  const toxicity = Number(summary?.toxicity ?? 0);
  const pii = !!summary?.pii || false;
  return { ok: true, isComplex, toxicity, pii, raw: data };
}
