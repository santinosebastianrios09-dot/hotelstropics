import readline from 'node:readline';
import { handleMessage } from '../orchestrator/router.js';
import { logger } from '../tools/logger.js';

logger.info('Chat local iniciado. Escribí tu mensaje y presioná Enter. Ctrl+C para salir.');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function ask() {
  rl.question('Tú: ', async (text) => {
    if (!text || !text.trim()) return ask();
    try {
      const res = await handleMessage(text.trim(), { chatId: 'local' });
      console.log(`Bot: ${res}`);
    } catch (e) {
      console.error('Error:', e);
    }
    ask();
  });
}

ask();
