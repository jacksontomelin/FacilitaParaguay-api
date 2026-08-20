const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');
const { solveUrl, solveCookies, solvePost, cookiesToHeader, testConnection } = require('../flaresolverr');

/**
 * Scraper que usa FlareSolverr pra bypassar Cloudflare.
 * Resolve o challenge uma vez, pega cookies, e depois faz requests com eles.
 */
class FlareSolverrScraper extends BaseScraper {
  constructor(storeSlug, config = {}) {
    super(storeSlug);
    this.baseUrl = config.baseUrl || '';
    this.gqlUrl = config.gqlUrl || null;
    this.storeCode = config.storeCode || 'default';
    this.categories = config.categories || [];
    this.searchTerms = config.searchTerms || [];
    this.cfCookies = [];
    this.cfUserAgent = '';
    this.useGraphQL = config.useGraphQL !== false && !!this.gqlUrl;
    this.pageSize = config.pageSize || 48;
  }

  // Override: não precisa de Playwright browser
  async init() {
    try {
      this.lockClient = await require('../database').acquireLock(this.lockId);
    } catch (_) { this.lockClient = null; }

    const result = await require('../database').pool.query('SELECT * FROM stores WHERE slug = $1', [this.storeSlug]);
    if (!result.rows.length) throw new Error(`Loja não encontrada: ${this.storeSlug}`);
    this.store = result.rows[0];

    // Testar FlareSolverr
    console.log(`[${this.storeSlug}] Testando FlareSolverr...`);
    const fs = await testConnection();
    if (!fs.ok) throw new Error(`FlareSolverr offline: ${fs.error}. Certifique-se que o container está rodando.`);
    console.log(`[${this.storeSlug}] FlareSolverr OK`);

    // Resolver Cloudflare e pegar cookies
    console.log(`[${this.storeSlug}] Resolvendo Cloudflare challenge em ${this.baseUrl}...`);
    const solution = await solveCookies(this.baseUrl);
    this.cfCookies = solution.cookies;
    this.cfUserAgent = solution.userAgent;
    console.log(`[${this.storeSlug}] Cloudflare resolvido! ${this.cfCookies.length} cookies obtidos`);
  }

  async cleanup() {
    if (this.lockClient) {
      await require('../database').releaseLock(this.lockClient, this.lockId);
    }
  }

  async createPage() { return null; }

  // Fetch com cookies do Cloudflare
  async cfFetch(url, options = {}) {
    const headers = {
      'User-Agent': this.cfUserAgent || 'Mozilla/5.0 Chrome/131',
      'Cookie': cookiesToHeader(this.cfCookies),
      'Accept': 'application/json, text/html',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    // Se Cloudflare bloqueou de novo, tentar resolver novamente
    if (response.status === 403) {
      console.log(`[${this.storeSlug}] 403 em ${url}, re-resolvendo Cloudflare...`);
      const solution = await solveCookies(this.baseUrl);
      this.cfCookies = solution.cookies;
      this.cfUserAgent = solution.userAgent;
      headers['Cookie'] = cookiesToHeader(this.cfCookies);
      headers['User-Agent'] = this.cfUserAgent;
      return fetch(url, { ...options, headers });
    }

    return response;
  }

  // GraphQL com cookies
  async gqlQuery(query, variables = {}) {
    const response = await this.cfFetch(this.gqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Store': this.storeCode },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) throw new Error(`GraphQL ${response.status}`);
    const data = await response.json();
    if (data.errors) throw new Error('GQL: ' + data.errors.map(e => e.message).join(', '));
    return data.data;
  }

  async scrape() {
    if (this.useGraphQL) {
      await this.scrapeViaGraphQL();
    } else {
      await this.scrapeViaHTML();
    }
  }

  // ======== GRAPHQL MODE ========
  async scrapeViaGraphQL() {
    console.log(`[${this.storeSlug}] Modo GraphQL via FlareSolverr`);

    // Testar GraphQL
    try {
      const test = await this.gqlQuery('{ storeConfig { store_name base_currency_code } }');
      console.log(`[${this.storeSlug}] GraphQL OK: ${test.storeConfig?.store_name}`);
    } catch (e) {
      console.error(`[${this.storeSlug}] GraphQL falhou, tentando HTML: ${e.message}`);
      await this.scrapeViaHTML();
      return;
    }

    // Descobrir categorias
    if (this.categories.length === 0) {
      try {
        const data = await this.gqlQuery(`{
          categories(filters: {}) {
            items { id name url_path product_count
              children { id name url_path product_count }
            }
          }
        }`);
        for (const item of (data.categories?.items || [])) {
          if (item.product_count > 0) this.categories.push({ id: item.id, name: item.name, slug: item.url_path });
          for (const ch of (item.children || [])) {
            if (ch.product_count > 0) this.categories.push({ id: ch.id, name: ch.name, slug: ch.url_path });
          }
        }
        console.log(`[${this.storeSlug}] ${this.categories.length} categorias`);
      } catch (e) { console.error(`[${this.storeSlug}] Erro categorias: ${e.message}`); }
    }

    // Scrape categorias
    for (const cat of this.categories) {
      try {
        const catId = await this.upsertCategory(cat.name, cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'), null, `${this.baseUrl}/${cat.slug || ''}`);
        await this.scrapeGQLCategory(cat, catId);
        await this.delay(500);
      } catch (e) { this.stats.errors++; }
    }

    // Busca por termos
    for (const term of this.searchTerms) {
      try {
        const catSlug = 'busca-' + term.toLowerCase().replace(/\s+/g, '-');
        const catId = await this.upsertCategory('Busca: ' + term, catSlug);
        await this.scrapeGQLSearch(term, catId);
        await this.delay(300);
      } catch (e) { this.stats.errors++; }
    }
  }

  async scrapeGQLCategory(cat, categoryId) {
    let page = 1, totalPages = 1;
    while (page <= totalPages && page <= 50) {
      try {
        const filter = cat.id ? `filter: { category_id: { eq: "${cat.id}" } }` : `filter: { category_url_path: { eq: "${cat.slug}" } }`;
        const data = await this.gqlQuery(`{
          products(${filter}, pageSize: ${this.pageSize}, currentPage: ${page}, sort: { position: ASC }) {
            total_count page_info { total_pages }
            items { sku name url_key
              price_range { minimum_price { regular_price { value currency } final_price { value currency } discount { percent_off } } }
              image { url } small_image { url } media_gallery { url } stock_status
            }
          }
        }`);
        const items = data.products?.items || [];
        totalPages = data.products?.page_info?.total_pages || 1;
        if (!items.length) break;
        console.log(`[${this.storeSlug}] ${cat.name} p${page}/${totalPages}: ${items.length} (total: ${data.products?.total_count})`);
        for (const p of items) await this.processGQLProduct(p, categoryId);
        page++;
      } catch (e) { this.stats.errors++; break; }
    }
  }

  async scrapeGQLSearch(term, categoryId) {
    try {
      const data = await this.gqlQuery(`{
        products(search: "${term}", pageSize: ${this.pageSize}) {
          total_count items { sku name url_key
            price_range { minimum_price { regular_price { value currency } final_price { value currency } discount { percent_off } } }
            image { url } small_image { url } stock_status
          }
        }
      }`);
      const items = data.products?.items || [];
      console.log(`[${this.storeSlug}] Busca "${term}": ${items.length} (total: ${data.products?.total_count})`);
      for (const p of items) await this.processGQLProduct(p, categoryId);
    } catch (e) { this.stats.errors++; }
  }

  async processGQLProduct(p, categoryId) {
    const pr = p.price_range?.minimum_price;
    const fp = pr?.final_price?.value;
    const rp = pr?.regular_price?.value;
    const disc = pr?.discount?.percent_off;
    const imgs = (p.media_gallery || []).map(m => m.url).filter(Boolean);

    await this.upsertProduct({
      name: p.name, slug: p.url_key, external_id: p.sku,
      price_usd: fp, price_original: rp > fp ? rp : null,
      discount_percent: disc > 0 ? Math.round(disc) : null,
      currency: pr?.final_price?.currency || 'USD',
      brand: this.extractBrand(p.name),
      image_url: p.image?.url || p.small_image?.url || imgs[0] || '',
      images: imgs,
      product_url: `${this.baseUrl}/${p.url_key}`,
      category_id: categoryId, in_stock: p.stock_status === 'IN_STOCK',
      is_promo: disc > 0, promo_label: disc > 0 ? `-${Math.round(disc)}%` : null,
      sku: p.sku, specs: {},
    });
  }

  // ======== HTML MODE (fallback) ========
  async scrapeViaHTML() {
    console.log(`[${this.storeSlug}] Modo HTML via FlareSolverr`);

    for (const cat of this.categories) {
      try {
        const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
        await this.scrapeHTMLCategory(cat, catId);
        await this.delay(1500);
      } catch (e) { this.stats.errors++; }
    }

    for (const term of this.searchTerms) {
      try {
        const catSlug = 'busca-' + term.toLowerCase().replace(/\s+/g, '-');
        const catId = await this.upsertCategory('Busca: ' + term, catSlug);
        const result = await solveUrl(`${this.baseUrl}/catalogsearch/result/?q=${encodeURIComponent(term)}`);
        const products = this.parseHTML(result.html, catId);
        console.log(`[${this.storeSlug}] Busca "${term}": ${products.length}`);
        for (const p of products) await this.upsertProduct(p);
      } catch (e) { this.stats.errors++; }
    }
  }

  async scrapeHTMLCategory(cat, categoryId) {
    let page = 1, hasMore = true;
    while (hasMore && page <= 20) {
      try {
        const url = page > 1 ? `${this.baseUrl}${cat.path}?p=${page}` : `${this.baseUrl}${cat.path}`;
        const result = await solveUrl(url);
        const products = this.parseHTML(result.html, categoryId);
        if (!products.length) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.name} p${page}: ${products.length}`);
        for (const p of products) await this.upsertProduct(p);
        const $ = cheerio.load(result.html);
        hasMore = $('a.next, a[rel="next"]').length > 0 || products.length >= 20;
        page++;
      } catch (e) { this.stats.errors++; hasMore = false; }
    }
  }

  parseHTML(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();

    $('.product-item, .product-card, .product, [class*="product-item"]').each((_, el) => {
      const $card = $(el);
      const $link = $card.find('a[href*="/"]').first();
      const href = $link.attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      let name = $card.find('.product-item-name, .product-name, h3, h4').first().text().trim();
      if (!name) name = $card.find('img').attr('alt') || '';
      if (!name || name.length < 3) return;

      const priceText = $card.find('.price, .special-price, .final-price').first().text();
      const m = priceText.match(/[\d.,]+/);
      let price = null;
      if (m) { let v = m[0]; if (v.includes('.') && v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); else if (v.includes(',')) v = v.replace(',', '.'); price = parseFloat(v) || null; }

      let img = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src') || '';

      products.push({
        name: name.substring(0, 500), slug: href.split('/').pop(),
        external_id: href.split('/').pop(),
        price_usd: price, price_original: null, discount_percent: null,
        currency: 'USD', brand: this.extractBrand(name),
        image_url: img, product_url: href,
        category_id: categoryId, in_stock: true, specs: {},
      });
    });

    return products;
  }

  extractBrand(name) {
    const brands = ['APPLE','SAMSUNG','XIAOMI','MOTOROLA','JBL','SONY','BOSE','LG','CANON','NIKON','GOPRO','DJI',
      'GARMIN','ASUS','MSI','ACER','LENOVO','DELL','HP','CORSAIR','LOGITECH','RAZER',
      'PLAYSTATION','NINTENDO','XBOX','AMAZON','CAROLINA HERRERA','PACO RABANNE','CALVIN KLEIN','HUGO BOSS',
      'TP-LINK','SANDISK','KINGSTON','EPSON','BROTHER','GREE','PHILIPS'];
    const upper = name.toUpperCase();
    for (const b of brands.sort((a, b) => b.length - a.length)) {
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[\\s/\\-.(_])' + esc + '([\\s/\\-.).,_]|$)').test(upper)) return b;
    }
    return null;
  }
}

module.exports = FlareSolverrScraper;
