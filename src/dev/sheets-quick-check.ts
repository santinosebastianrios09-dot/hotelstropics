import 'dotenv/config';
import { listarReservas, getReservaById, disponibilidad, updateEstado } from '../tools/sheets';

async function run() {
  const all = await listarReservas();
  console.log('Total reservas:', all.length);
  console.log('Primera fila:', all[0]);

  const r = await getReservaById('R-002');
  console.log('R-002 =>', r);

  const disp = await disponibilidad('H-004', '2025-10-07', '2025-10-10');
  console.log('Disponibilidad H-004 2025-10-07→2025-10-10:', disp);

  // Ejemplo de update (comentalo si no querés escribir):
  // const ok = await updateEstado('R-003', 'Pagado');
  // console.log('Update estado R-003:', ok);
}
run().catch(console.error);

