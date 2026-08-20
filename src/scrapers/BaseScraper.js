const { chromium } = require('playwright');
const { pool, acquireLock, releaseLock } = require('../database');

class BaseScraper {
  constructor(storeSlug) {
    this.storeSlug = storeSlug;
    this.store = null;
    this.browser = null;
    this.context = null;
    this.stats = { found: 0, new: 0, updated: 0, errors: 0 };
    this.lockId = this.hashCode(storeSlug);
    this.lockClient = null;
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash) % 2147483647;
  }

  async init() {
    // Adquirir advisory lock
    try {
      this.lockClient = await acquireLock(this.lockId);
      if (!this.lockClient) {
        throw new Error(`Scraper já em execução para ${this.storeSlug}`);
      }
    } catch (lockErr) {
      console.error(`[${this.storeSlug}] Lock falhou: ${lockErr.message}`);
      // Continuar sem lock se falhar
      this.lockClient = null;
    }

    // Buscar dados da loja
    const result = await pool.query('SELECT * FROM stores WHERE slug = $1', [this.storeSlug]);
    if (result.rows.length === 0) {
      throw new Error(`Loja não encontrada: ${this.storeSlug}`);
    }
    this.store = result.rows[0];

    // Iniciar browser com stealth
    const launchArgs = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-gpu', '--disable-infobars',
    ];
    const launchOpts = { headless: true, args: launchArgs };

    // Chromium path
    const chromePath = process.env.CHROMIUM_PATH;
    if (chromePath && chromePath.length > 5) {
      launchOpts.executablePath = chromePath;
    }
    // Não setar executablePath se não tem CHROMIUM_PATH - Playwright usa o bundled

    this.browser = await chromium.launch(launchOpts);

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      viewport: { width: 1920, height: 1080 },
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
    });

    // Stealth: remover sinais de automação
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(params);
    });

    console.log(`[${this.storeSlug}] Scraper inicializado (stealth mode)`);
  }

  // Esperar Cloudflare challenge resolver (até 15s)
  async waitForCloudflare(page, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const title = await page.title();
      if (!title.includes('Just a moment') && !title.includes('Checking') && !title.includes('Cloudflare')) {
        return true;
      }
      await this.delay(1000);
    }
    const finalTitle = await page.title();
    console.log(`[${this.storeSlug}] Cloudflare timeout. Título: "${finalTitle}"`);
    return false;
  }

  async createPage() {
    const page = await this.context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    // Wrapper seguro: detecta Cloudflare sem quebrar navegação normal
    const self = this;
    const origGoto = page.goto.bind(page);
    page.goto = async function(url, opts = {}) {
      const response = await origGoto(url, opts);
      try {
        const title = await page.title();
        if (title && (title.includes('Just a moment') || title.includes('Checking your browser'))) {
          console.log(`[${self.storeSlug}] Cloudflare detectado em ${url.substring(0, 60)}, aguardando...`);
          await self.waitForCloudflare(page, 20000);
        }
      } catch (_) {
        // Ignorar erro no check de título - navegação normal continua
      }
      return response;
    };

    return page;
  }

  async upsertCategory(name, slug, parentId = null, url = null) {
    const result = await pool.query(`
      INSERT INTO categories (store_id, name, slug, parent_id, url)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (store_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        parent_id = EXCLUDED.parent_id,
        url = EXCLUDED.url,
        updated_at = NOW()
      RETURNING id
    `, [this.store.id, name, slug, parentId, url]);
    return result.rows[0].id;
  }

  async upsertProduct(data) {
    this.stats.found++;
    try {
      const isPromo = !!(data.is_promo || (data.discount_percent && data.discount_percent > 0) ||
        (data.price_original && data.price_usd && data.price_original > data.price_usd));
      const images = JSON.stringify(data.images || []);

      const existing = await pool.query(
        'SELECT id, price_usd FROM products WHERE store_id = $1 AND product_url = $2',
        [this.store.id, data.product_url]
      );

      if (existing.rows.length > 0) {
        const product = existing.rows[0];
        const priceChanged = product.price_usd !== null &&
          parseFloat(product.price_usd) !== parseFloat(data.price_usd);

        await pool.query(`
          UPDATE products SET
            name = $1, price_usd = $2, price_original = $3,
            discount_percent = $4, image_url = $5, in_stock = $6,
            brand = $7, category_id = $8, specs = $9,
            is_promo = $10, promo_label = $11,
            images = CASE WHEN $12::jsonb != '[]'::jsonb THEN $12::jsonb ELSE images END,
            last_seen_at = NOW(), updated_at = NOW()
          WHERE id = $13
        `, [
          data.name, data.price_usd, data.price_original,
          data.discount_percent, data.image_url, data.in_stock ?? true,
          data.brand, data.category_id, JSON.stringify(data.specs || {}),
          isPromo, data.promo_label || null, images,
          product.id
        ]);

        if (priceChanged) {
          await pool.query(
            'INSERT INTO price_history (product_id, price_usd, price_original) VALUES ($1, $2, $3)',
            [product.id, data.price_usd, data.price_original]
          );
        }

        this.stats.updated++;
        return product.id;
      } else {
        const result = await pool.query(`
          INSERT INTO products (
            store_id, category_id, external_id, name, slug,
            description, price_usd, price_original, discount_percent,
            currency, brand, image_url, images, product_url, in_stock,
            is_promo, promo_label, sku, specs
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          RETURNING id
        `, [
          this.store.id, data.category_id, data.external_id, data.name, data.slug,
          data.description, data.price_usd, data.price_original, data.discount_percent,
          data.currency || 'USD', data.brand, data.image_url, images,
          data.product_url, data.in_stock ?? true,
          isPromo, data.promo_label || null,
          data.sku, JSON.stringify(data.specs || {})
        ]);

        await pool.query(
          'INSERT INTO price_history (product_id, price_usd, price_original) VALUES ($1, $2, $3)',
          [result.rows[0].id, data.price_usd, data.price_original]
        );

        this.stats.new++;
        return result.rows[0].id;
      }
    } catch (err) {
      this.stats.errors++;
      console.error(`[${this.storeSlug}] Erro ao upsert produto: ${err.message}`);
      return null;
    }
  }

  /**
   * Busca imagens extras da página de detalhe do produto.
   */
  async scrapeProductImages(page, productUrl) {
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
      await this.delay(1500);
      const images = await page.evaluate(() => {
        const imgs = new Set();
        document.querySelectorAll('img[src]').forEach(img => {
          const src = img.src;
          if (!src || src.includes('logo') || src.includes('icon') || src.includes('flag') ||
              src.includes('banner') || src.includes('loading') || src.includes('placeholder') ||
              src.includes('svg') || img.width < 80 || img.height < 80) return;
          imgs.add(src);
        });
        document.querySelectorAll('[data-src], [data-zoom-image], [data-large]').forEach(el => {
          const src = el.getAttribute('data-src') || el.getAttribute('data-zoom-image') || el.getAttribute('data-large');
          if (src && src.startsWith('http')) imgs.add(src);
        });
        return Array.from(imgs).slice(0, 10);
      });
      return images;
    } catch (err) {
      return [];
    }
  }

  async logScrape(status, startTime, errorMessage = null) {
    const duration = Date.now() - startTime;
    await pool.query(`
      INSERT INTO scrape_logs (store_id, status, products_found, products_new, products_updated, errors, duration_ms, error_message, finished_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      this.store.id, status, this.stats.found, this.stats.new,
      this.stats.updated, this.stats.errors, duration, errorMessage
    ]);
  }

  async run() {
    const startTime = Date.now();
    try {
      await this.init();
      console.log(`[${this.storeSlug}] Iniciando scraping...`);
      await this.scrape();
      await this.logScrape('success', startTime);
      console.log(`[${this.storeSlug}] Concluído: ${this.stats.found} encontrados, ${this.stats.new} novos, ${this.stats.updated} atualizados, ${this.stats.errors} erros`);
    } catch (err) {
      console.error(`[${this.storeSlug}] ERRO FATAL: ${err.message}`);
      console.error(`[${this.storeSlug}] Stack: ${err.stack?.substring(0, 300)}`);
      try {
        if (this.store) {
          await this.logScrape('error', startTime, err.message);
        }
      } catch (_) {}
    } finally {
      await this.cleanup();
    }
    return this.stats;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    if (this.lockClient) {
      await releaseLock(this.lockClient, this.lockId);
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Override nos scrapers filhos
  async scrape() {
    throw new Error('Método scrape() deve ser implementado');
  }
}

module.exports = BaseScraper;

// Retry com exponential backoff
BaseScraper.prototype.retryPage = async function(page, url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: options.waitUntil || 'domcontentloaded', timeout: options.timeout || 30000 });
      return true;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 15000) + Math.random() * 2000;
      console.log(`[${this.storeSlug}] Retry ${attempt}/${maxRetries} em ${Math.round(backoff)}ms: ${url.substring(0, 80)}`);
      await this.delay(backoff);
    }
  }
};
