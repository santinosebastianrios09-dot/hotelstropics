export type Intent =
  | 'saludo'
  | 'disponibilidad'
  | 'precios'
  | 'itinerario'
  | 'politicas'
  | 'resumen'
  | 'grafico'
  | 'contacto_humano'
  | 'fallback';

const patterns: Record<Intent, RegExp[]> = {
  saludo: [/hola|buenas|qué tal/i],
  disponibilidad: [/disponib|reservar|cupos?|lugares?|libre/i],
  precios: [/precio|tarifa|cuánto sale|cost/i],
  itinerario: [/itinerar|duraci|horar|punto de encuentro|incluye/i],
  politicas: [/pol[ií]tica|cancelaci|reembolso|check-?in|check-?out/i],
  resumen: [/resumen|reporte|estado/i],
  grafico: [/gr[aá]fic|chart/i],
  contacto_humano: [/agente humano|hablar con alguien|tel[eé]fono|whatsapp/i],
  fallback: []
};

export function detectIntent(text: string): Intent {
  const keys = Object.keys(patterns) as Intent[];
  for (const k of keys) {
    if (k === 'fallback') continue;
    if (patterns[k].some((re) => re.test(text))) return k;
  }
  return 'fallback';
}
