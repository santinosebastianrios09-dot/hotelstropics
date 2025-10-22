// src/dev/test-parse.ts
import { parseRequest } from '../utils/parserequest.js';

for (const t of [
  'disponibilidad para 2 del 10/11 al 13/11',
  'disponibilidad 12/11 al 13/11',
  'disponibilidad 12/11/2025 al 13/11/2025'
]) {
  const r = parseRequest(t);
  console.log(t, '=>', r);
}
