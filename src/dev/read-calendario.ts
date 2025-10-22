// src/dev/read-calendario.ts
import { readTabObjects } from '../tools/sheets.js';

type RowCalendario = {
  'ID RECURSO'?: string;
  'FECHA'?: string;
  'CUPO TOTAL'?: string | number;
  'CUPO BLOQUEADO'?: string | number;
  'PRECIO DIA'?: string | number;
  'ESTADO'?: string;
};

(async () => {
  try {
    const rows = await readTabObjects<RowCalendario>('CALENDARIO', 'A1:F50');
    console.log('CALENDARIO: filas =>', rows.length);
    console.log('Primeras 5 =>', rows.slice(0, 5));
  } catch (e) {
    console.error('ERROR leyendo CALENDARIO:', e);
    process.exit(1);
  }
})();
