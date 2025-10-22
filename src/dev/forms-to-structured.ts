import 'dotenv/config';
import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? process.env.SPREADSHEET_ID;
if (!SPREADSHEET_ID) throw new Error('Falta SPREADSHEET_ID');

const STRUCT_HEADERS = [
  'FECHA DEL FORM','HABITACION','CHECK- IN','CHECK- OUT','NOCHES','PERSONAS',
  'PRECIO_POR_NOCHE','ESTADO','ID RESERVA','TRANSACCION ID','NOMBRE TITULAR','EMAIL','TELEFONO','TOTAL'
];

function n(s?: any){ return (s ?? '').toString(); }

async function main(){
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({version:'v4', auth});

  // 1) Detectar primer tab (Forms)
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const firstTab = meta.data.sheets?.[0]?.properties?.title;
  if(!firstTab) throw new Error('No hay pestañas');
  const quote = (t:string)=>`'${t.replace(/'/g,"''")}'`;

  // 2) Leer todo Forms
  const forms = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(firstTab)}!A1:Z9999`
  });
  const rows = forms.data.values ?? [];
  if (!rows.length) throw new Error('Forms vacío');
  const headers = rows[0];
  const data = rows.slice(1);

  const idx = (nameSubstr: string) => {
    const i = headers.findIndex(h => (h||'').toString().toLowerCase().includes(nameSubstr.toLowerCase()));
    return i >= 0 ? i : -1;
  };

  const iMarca = idx('marca temporal');
  const iHab = idx('habitación') >= 0 ? idx('habitación') : idx('habitación que desees reservar');
  const iIn = idx('entrada');
  const iOut = idx('salida');
  const iPers = idx('numero de personas');
  const iNombre = idx('nombre y apellido');
  const iEmail = idx('correo electrónico');
  const iTel = idx('teléfono de contacto');
  const iProcId = headers.findIndex(h => (h||'').toString().startsWith('processed_booking_id'));

  // 3) Mapear a estructura (campos faltantes quedan vacíos)
  const structured = data.map(r => ([
    iMarca>=0? n(r[iMarca]) : '',
    iHab>=0? n(r[iHab]) : '',
    iIn>=0? n(r[iIn]) : '',
    iOut>=0? n(r[iOut]) : '',
    '',                              // NOCHES (podés calcular luego)
    iPers>=0? n(r[iPers]) : '',
    '',                              // PRECIO_POR_NOCHE
    'pendiente',                     // ESTADO (default)
    iProcId>=0? n(r[iProcId]) : '',  // ID RESERVA (si tu proceso lo llenó)
    '',                              // TRANSACCION ID
    iNombre>=0? n(r[iNombre]) : '',
    iEmail>=0? n(r[iEmail]) : '',
    iTel>=0? n(r[iTel]) : '',
    ''                               // TOTAL
  ]));

  // 4) Crear pestaña "Reservas" si no existe
  const exists = meta.data.sheets?.some(s => s.properties?.title === 'Reservas');
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Reservas' } } }] }
    });
  }

  // 5) Escribir encabezados + datos
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'Reservas'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [STRUCT_HEADERS, ...structured] }
  });

  console.log('✅ Pestaña "Reservas" creada/actualizada con datos normalizados.');
}

main().catch(e => { console.error(e); process.exit(1); });
