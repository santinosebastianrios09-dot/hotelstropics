// src/policies/escalation.ts
// Devuelve: 'human' | 'ask' | 'auto'
// - 'human': casos sensibles/conflictivos
// - 'ask': falta info mínima (fecha / huéspedes) para avanzar
// - 'auto': el bot puede resolver con reglas o GPT

export type EscalationDecision = 'human' | 'ask' | 'auto';

type Inputs = {
  intent:
    | 'info'
    | 'availability'
    | 'reserve'
    | 'change'
    | 'refund'
    | 'complaint'
    | 'summary'
    | 'unknown'
    | 'ambiguous';

  // flags provenientes de orchestrator/intents.flags()
  needsDate?: boolean;
  needsGuests?: boolean;
  hasOffense?: boolean;
  hasSensitive?: boolean; // (p.ej. datos personales expuestos, amenazas, etc.)
};

export function decideEscalation({
  intent,
  needsDate,
  needsGuests,
  hasOffense,
  hasSensitive
}: Inputs): EscalationDecision {
  // 1) Cualquier indicador sensible → humano
  if (hasOffense || hasSensitive) return 'human';
  if (intent === 'complaint') return 'human';

  // 2) Intenciones operativas que requieren datos mínimos
  const needsSlots =
    intent === 'availability' || intent === 'reserve' || intent === 'change';

  if (needsSlots && (needsDate || needsGuests)) {
    return 'ask';
  }

  // 3) El resto lo puede manejar el bot
  return 'auto';
}
