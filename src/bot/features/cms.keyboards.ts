import { Markup } from 'telegraf';

/**
 * Teclado principal del CMS para un hotel en particular.
 * Usa callback_data con el formato: cms:<accion>:<hotelId>:<draftId>
 * Mantiene compatibilidad con tu flujo actual.
 */
export function mainCmsKeyboard(hotelId: string, draftId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 Título',       `cms:title:${hotelId}:${draftId}`),
      Markup.button.callback('🗒️ Descripción',  `cms:desc:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('🖼️ Fotos',        `cms:photos:${hotelId}:${draftId}`),
      Markup.button.callback('🧩 Secciones',    `cms:sections:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('🧰 Amenities',    `cms:amen:${hotelId}:${draftId}`),
      Markup.button.callback('📃 Políticas',    `cms:pol:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('💲 Precio desde', `cms:price:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('🔎 Ver Previsualización', `cms:preview:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('✅ Confirmar y Publicar', `cms:publish:${hotelId}:${draftId}`),
      Markup.button.callback('🗑️ Descartar borrador',   `cms:discard:${hotelId}:${draftId}`),
    ],
    [
      // NUEVO: acceso directo para volver al panel (por si estás dentro de un subflujo)
      Markup.button.callback('⬅️ Volver al panel', `cms:back:${hotelId}:${draftId}`),
      // NUEVO: ir al inicio del bot (sale del flujo CMS y vuelve al menú del agente)
      Markup.button.callback('🏠 Inicio', `cms:home:${hotelId}:${draftId}`),
    ],
  ]);
}

/**
 * Teclado "volver". Compatibilidad total:
 * - Si NO pasás hotelId/draftId → callback = "cms:back" (como tenías).
 * - Si SÍ pasás hotelId/draftId → callback = "cms:back:<hotelId>:<draftId>" (más contextual).
 */
export const backKeyboard = (hotelId?: string, draftId?: string) => {
  const cb = (hotelId && draftId) ? `cms:back:${hotelId}:${draftId}` : 'cms:back';
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', cb)]]);
};

/**
 * NUEVO: Teclado "inicio" opcional (útil para pantallas sueltas)
 * - Si NO pasás hotelId/draftId → callback = "cms:home".
 * - Si SÍ pasás hotelId/draftId → callback = "cms:home:<hotelId>:<draftId>".
 */
export const homeKeyboard = (hotelId?: string, draftId?: string) => {
  const cb = (hotelId && draftId) ? `cms:home:${hotelId}:${draftId}` : 'cms:home';
  return Markup.inlineKeyboard([[Markup.button.callback('🏠 Inicio', cb)]]);
};

/**
 * Fila de navegación estándar que combina Volver + Inicio.
 * Para reutilizar en subpantallas y mantener consistencia visual.
 */
export const navRow = (hotelId: string, draftId: string) => [
  Markup.button.callback('⬅️ Volver al panel', `cms:back:${hotelId}:${draftId}`),
  Markup.button.callback('🏠 Inicio',          `cms:home:${hotelId}:${draftId}`),
];

/* ====== (Opcional) Teclados auxiliares por ítem, con "volver al panel" e "inicio" ======
   Estos helpers no rompen nada si no los usás. Son útiles para subpantallas
   donde pedís/mostrás un campo específico y querés ofrecer los botones de navegación.
*/

export const titleKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💾 Guardar título', `cms:title_save:${hotelId}:${draftId}`)],
    navRow(hotelId, draftId),
  ]);

export const descKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💾 Guardar descripción', `cms:desc_save:${hotelId}:${draftId}`)],
    navRow(hotelId, draftId),
  ]);

export const photosKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Agregar foto', `cms:photos_add:${hotelId}:${draftId}`),
      Markup.button.callback('🗑️ Quitar foto', `cms:photos_remove:${hotelId}:${draftId}`),
    ],
    navRow(hotelId, draftId),
  ]);

export const sectionsKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Agregar sección', `cms:sections_add:${hotelId}:${draftId}`),
      Markup.button.callback('🗑️ Quitar sección', `cms:sections_remove:${hotelId}:${draftId}`),
    ],
    navRow(hotelId, draftId),
  ]);

export const amenitiesKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Agregar amenity', `cms:amen_add:${hotelId}:${draftId}`),
      Markup.button.callback('🗑️ Quitar amenity', `cms:amen_remove:${hotelId}:${draftId}`),
    ],
    navRow(hotelId, draftId),
  ]);

export const policiesKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Editar políticas', `cms:pol_edit:${hotelId}:${draftId}`),
    ],
    navRow(hotelId, draftId),
  ]);

export const priceKeyboard = (hotelId: string, draftId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Cambiar precio', `cms:price_edit:${hotelId}:${draftId}`),
    ],
    navRow(hotelId, draftId),
  ]);


/* ===========================
 * NUEVO: teclados de previsualización
 * ===========================
 * - previewInlineKeyboard(url): muestra botón WebApp (abre dentro de Telegram)
 *   y también un botón URL como fallback.
 * - mainCmsKeyboardWithWebApp(hotelId, draftId, previewUrl): igual al principal,
 *   pero además agrega una fila con botón WebApp directo a la preview.
 */

export function previewInlineKeyboard(previewUrl: string) {
  return Markup.inlineKeyboard([
    [{ text: '🔎 Ver previsualización', web_app: { url: previewUrl } }],
    [Markup.button.url('🌐 Abrir en navegador', previewUrl)],
  ]);
}

export function mainCmsKeyboardWithWebApp(hotelId: string, draftId: string, previewUrl?: string) {
  // Conserva EXACTAMENTE las filas del teclado original y agrega WebApp (si hay URL)
  const rows: any[][] = [
    [
      Markup.button.callback('📝 Título',       `cms:title:${hotelId}:${draftId}`),
      Markup.button.callback('🗒️ Descripción',  `cms:desc:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('🖼️ Fotos',        `cms:photos:${hotelId}:${draftId}`),
      Markup.button.callback('🧩 Secciones',    `cms:sections:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('🧰 Amenities',    `cms:amen:${hotelId}:${draftId}`),
      Markup.button.callback('📃 Políticas',    `cms:pol:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('💲 Precio desde', `cms:price:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('🔎 Ver Previsualización', `cms:preview:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('✅ Confirmar y Publicar', `cms:publish:${hotelId}:${draftId}`),
      Markup.button.callback('🗑️ Descartar borrador',   `cms:discard:${hotelId}:${draftId}`),
    ],
    [
      Markup.button.callback('⬅️ Volver al panel', `cms:back:${hotelId}:${draftId}`),
      Markup.button.callback('🏠 Inicio',          `cms:home:${hotelId}:${draftId}`),
    ],
  ];

  // Agregamos una fila adicional con botón WebApp si tenemos URL
  if (previewUrl) {
    rows.splice(5, 0, [{ text: '🔎 Abrir previsualización (WebApp)', web_app: { url: previewUrl } }]);
  }

  return Markup.inlineKeyboard(rows);
}

/**
 * Alias de exportación explícito para evitar errores con algunas builds ESM/CJS
 * donde el árbol de exports puede fallar en caliente.
 */
export { mainCmsKeyboard as MainCmsKeyboard };
