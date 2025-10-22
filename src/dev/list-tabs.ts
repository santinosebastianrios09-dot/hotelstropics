import { google } from 'googleapis';
import { env } from '../tools/config';

async function main() {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    console.error('Falta GOOGLE_SHEETS_SPREADSHEET_ID en .env');
    process.exit(1);
  }
  if (!env.GOOGLE_SA_JSON_BASE64) {
    console.error('Falta GOOGLE_SA_JSON_BASE64 en .env (en una sola línea base64)');
    process.exit(1);
  }

  const json = Buffer.from(env.GOOGLE_SA_JSON_BASE64, 'base64').toString('utf-8');
  const credentials = JSON.parse(json);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID
  });

  const titles = meta.data.sheets?.map(s => s.properties?.title || '(sin título)') ?? [];
  console.log('Pestañas encontradas:', titles);
}

main().catch(e => {
  console.error('Error listando pestañas:', e);
  process.exit(1);
});
