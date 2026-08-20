const BaseScraper = require('./BaseScraper');

class CloudflareBlockedScraper extends BaseScraper {
  constructor(storeSlug, config = {}) {
    super(storeSlug);
    this.baseUrl = config.baseUrl || '';
    this.reason = config.reason || 'Cloudflare challenge ativo';
  }

  async init() {
    const result = await require('../database').pool.query('SELECT * FROM stores WHERE slug = $1', [this.storeSlug]);
    if (result.rows.length) this.store = result.rows[0];
  }

  async scrape() {
    console.log(`[${this.storeSlug}] BLOQUEADO: ${this.reason}. Requer FlareSolverr ou proxy.`);
    // Não tenta nada, só loga
  }

  async cleanup() {}
}

module.exports = CloudflareBlockedScraper;
