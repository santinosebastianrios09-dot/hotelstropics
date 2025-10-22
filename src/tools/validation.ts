// src/tools/validation.ts
export type DraftData = {
  hotel_id: string;
  nombre?: string;
  titulo_hero?: string;
  descripcion_hero?: string;
  fotos?: string; // URLs separadas por |
  amenities?: string; // separados por |
  secciones_json?: string; // JSON string
  politicas_cancelacion?: string;
  precio_desde?: string | number;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export function validateDraftBeforePublish(d: DraftData): ValidationResult {
  const errors: string[] = [];

  if (!d.hotel_id) errors.push('hotel_id faltante');
  if (!d.titulo_hero || !String(d.titulo_hero).trim()) errors.push('Título (titulo_hero) es requerido');
  if (!d.descripcion_hero || !String(d.descripcion_hero).trim()) errors.push('Descripción (descripcion_hero) es requerida');

  const fotos = (d.fotos || '').split('|').map(s => s.trim()).filter(Boolean);
  if (fotos.length < 1) errors.push('Al menos 1 foto es requerida');

  // secciones_json: si viene, al menos debe parsear
  if (d.secciones_json) {
    try { JSON.parse(String(d.secciones_json)); } catch { errors.push('secciones_json inválido (no es JSON)'); }
  }

  return { ok: errors.length === 0, errors };
}
