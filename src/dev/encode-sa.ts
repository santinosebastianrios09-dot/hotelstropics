// src/dev/encode-sa.ts
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run dev:encode-sa -- <ruta a key.json>');
  process.exit(1);
}
const p = path.resolve(file);
const json = fs.readFileSync(p, 'utf8');
const b64 = Buffer.from(json, 'utf8').toString('base64');
console.log('\n---- PEGAR EN .env ----\nGOOGLE_SA_JSON_BASE64=' + b64 + '\n');
