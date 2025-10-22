import type { Request, Response } from 'express';
import { env } from '../tools/config';
import { hybridReply } from '../ai/hybrid';

export async function postChat(req: Request, res: Response) {
  try {
    const { message } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message requerido' });
    }

    // Gate: reglas básicas para reducir costo
    if (/precio|tarifa/i.test(message) && !/^\d{4}-\d{2}-\d{2}/.test(message)) {
      return res.json({
        reply: 'Para cotizar necesito fechas (YYYY-MM-DD). Ej: 2025-10-12 al 2025-10-15.',
        mode: 'rule'
      });
    }

    // Híbrido compartido
    const reply = await hybridReply(message);

    // (Opcional) filtros de seguridad para público
    if (env.AIINTEGRITY_ENABLED) {
      // acá podrías pasar el reply por AIntegrity si querés
    }

    return res.json({ reply, mode: 'hybrid' });
  } catch (e:any) {
    console.error('[web.postChat] error', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
}
