// src/tools/storage.ts
// Subida de imágenes a Cloudinary usando URL remota (la del archivo de Telegram)
// Requisitos .env:
//   PREVIEW_ENABLED=true
//   CLOUDINARY_CLOUD_NAME=tu_cloud
//   CLOUDINARY_UPLOAD_PRESET=unsigned_preset (modo unsigned)
// Opcional:
//   CLOUDINARY_FOLDER=hoteles
//
// Notas:
// - No dependemos del SDK de Cloudinary; usamos fetch POST multipart.
// - Cloudinary acepta `file` como URL remota (no hace falta descargar binario).

export type UploadResult = {
  url: string;
  publicId?: string;
};

function req(name: string, v?: string) {
  if (!v) throw new Error(`[storage] Falta ${name} en .env`);
  return v;
}

const enabled = String(process.env.PREVIEW_ENABLED || '').toLowerCase() === 'true';

export async function uploadImageUrlToCloudinary(fileUrl: string, opts?: { folder?: string }): Promise<UploadResult> {
  if (!enabled) throw new Error('[storage] PREVIEW_ENABLED=false; storage deshabilitado');
  const cloud = req('CLOUDINARY_CLOUD_NAME', process.env.CLOUDINARY_CLOUD_NAME);
  const preset = req('CLOUDINARY_UPLOAD_PRESET', process.env.CLOUDINARY_UPLOAD_PRESET);
  const folder = opts?.folder || process.env.CLOUDINARY_FOLDER || undefined;

  const endpoint = `https://api.cloudinary.com/v1_1/${cloud}/image/upload`;
  const form = new FormData();
  form.append('upload_preset', preset);
  form.append('file', fileUrl);
  if (folder) form.append('folder', folder);

  const resp = await fetch(endpoint, { method: 'POST', body: form as any });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`[storage] Cloudinary HTTP ${resp.status}: ${txt}`);
  }
  const json: any = await resp.json();
  const url: string = json.secure_url || json.url;
  if (!url) throw new Error('[storage] Respuesta Cloudinary sin URL');
  return { url, publicId: json.public_id };
}
