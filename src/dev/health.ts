// src/dev/sa-health.ts
import { google } from 'googleapis';
import { env } from '../tools/config.js';

(async () => {
  try {
    if (!env.GOOGLE_SA_JSON_BASE64) throw new Error('Falta GOOGLE_SA_JSON_BASE64 en .env');

    const json = Buffer.from(env.GOOGLE_SA_JSON_BASE64, 'base64').toString('utf8');
    const creds = JSON.parse(json);

    console.log('client_email =>', creds.client_email);
    console.log('private_key prefix =>', String(creds.private_key).slice(0, 30).replace(/\n/g, '\\n'));

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();
    console.log('ACCESS TOKEN length =>', (token?.token ?? '').length || 0);
    if (!token || !token.token) throw new Error('No se obtuvo access token');

    console.log('OK: autenticación correcta.');
  } catch (e) {
    console.error('SA health ERROR:', e);
    process.exit(1);
  }
})();
