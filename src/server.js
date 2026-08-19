require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { initDatabase, addSearchIndexes } = require('./database');
const apiRoutes = require('./routes/api');
const { createScraper, getAvailableScrapers } = require('./scrapers');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API
app.use('/api', apiRoutes);

// SPA fallback
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    next();
  }
});

// Iniciar
async function start() {
  try {
    await initDatabase();
    await addSearchIndexes();
    console.log('[DB] Conectado e inicializado');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[SERVER] Rodando em http://0.0.0.0:${PORT}`);
    });

    // CRON: executar scrapers periodicamente
    const schedule = process.env.CRON_SCHEDULE || '0 */6 * * *';
    cron.schedule(schedule, async () => {
      console.log('[CRON] Iniciando scraping agendado...');
      const scrapers = getAvailableScrapers();
      for (const slug of scrapers) {
        try {
          const scraper = createScraper(slug);
          await scraper.run();
        } catch (err) {
          console.error(`[CRON] Erro ${slug}: ${err.message}`);
        }
      }
      console.log('[CRON] Scraping agendado concluído');
    });

    console.log(`[CRON] Agendado: ${schedule}`);
  } catch (err) {
    console.error('[STARTUP] Erro:', err);
    process.exit(1);
  }
}

start();
