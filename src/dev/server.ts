import express from 'express';

export function makeServer() {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));
  app.get('/ready', (_req, res) => res.status(200).send('ready'));
  // (Webhook opcional se engancha luego)
  return app;
}

export function startServer(port: number) {
  const app = makeServer();
  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });
  return app;
}
