// T-001 placeholder — minimal Express bootstrap, replaced by owner A5 in W1.
// It exists so `npm run build`/`start` and `GET /health` work before the real app factory lands.

import express from 'express';
import pino from 'pino';

const PORT = Number(process.env.PORT ?? 5000);

const logger = pino({ name: 'focus-mode-server', level: process.env.LOG_LEVEL ?? 'info' });
const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ success: true });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'T-001 placeholder server listening');
});

process.on('SIGTERM', () => {
  server.close();
});
