import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { env } from '../tools/config';
import { postChat } from '../adapters/web';

export function makeServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/chat', postChat);

  const port = env.PORT || 8080;
  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });

  return app;
}
