/**
 * Rastreia estado dos scrapers em memória.
 * Persiste entre requests, não depende do banco.
 */
const tracker = {
  running: {},    // { slug: { started_at, status, products_found, errors, logs[] } }
  history: [],    // últimas 50 execuções finalizadas

  start(slug) {
    this.running[slug] = {
      started_at: new Date().toISOString(),
      status: 'running',
      products_found: 0,
      errors: 0,
      logs: [`[${new Date().toLocaleTimeString()}] Iniciando...`],
    };
  },

  log(slug, msg) {
    if (this.running[slug]) {
      this.running[slug].logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
      // Manter só últimas 50 linhas
      if (this.running[slug].logs.length > 50) this.running[slug].logs.shift();
    }
  },

  update(slug, data) {
    if (this.running[slug]) Object.assign(this.running[slug], data);
  },

  finish(slug, status, stats = {}) {
    const entry = this.running[slug];
    if (entry) {
      entry.status = status;
      entry.finished_at = new Date().toISOString();
      entry.duration_ms = Date.now() - new Date(entry.started_at).getTime();
      Object.assign(entry, stats);
      entry.logs.push(`[${new Date().toLocaleTimeString()}] Finalizado: ${status}`);
      this.history.unshift({ slug, ...entry });
      if (this.history.length > 50) this.history.pop();
      delete this.running[slug];
    }
  },

  isRunning(slug) { return !!this.running[slug]; },
  anyRunning() { return Object.keys(this.running).length > 0; },
  getStatus() {
    return {
      running: Object.entries(this.running).map(([slug, data]) => ({ slug, ...data })),
      running_count: Object.keys(this.running).length,
      history: this.history.slice(0, 20),
    };
  },
  getLogs(slug) {
    return this.running[slug]?.logs || this.history.find(h => h.slug === slug)?.logs || [];
  },
};

module.exports = tracker;
