import { google } from 'googleapis';
import { env } from '../tools/config';

async function peek(tab: string, range = 'A1:Z1') {
  const json = Buffer.from(env.GOOGLE_SA_JSON_BASE64!, 'base64').toString('utf-8');
  const credentials = JSON.parse(json);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID!,
    range: `'${tab.replace(/'/g,"''")}'!${range}`
  });
  const headers = res.data.values?.[0] ?? [];
  console.log(`Headers de ${tab}:`, headers);
}

(async () => {
  for (const tab of ['CALENDARIO','Recursos','RESERVAS PROCESADAS','form responses 1']) {
    try { await peek(tab); } catch (e) { console.error(`Error en ${tab}:`, (e as any)?.message); }
  }
})();
