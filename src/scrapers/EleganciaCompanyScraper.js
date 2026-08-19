const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class EleganciaCompanyScraper extends BaseScraper {
  constructor() {
    super('elegancia-company');
    this.baseUrl = 'http://www.eleganciacompany.com';
    // Custom: /productos/CATEGORIA/ID
    this.categories = [
      { name: 'Perfumes', slug: 'perfumes', path: '/productos/perfumes' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/productos/cosmeticos' },
      { name: 'Maquiagem', slug: 'maquiagem', path: '/productos/maquillaje' },
      { name: 'Skincare', slug: 'skincare', path: '/productos/skincare' },
      { name: 'Bolsas', slug: 'bolsas', path: '/productos/bolsas' },
      { name: 'Acessórios', slug: 'acessorios', path: '/productos/accesorios' },
      { name: 'Relógios', slug: 'relogios', path: '/productos/relojes' },
    ];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      for (const cat of this.categories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCategory(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) { this.stats.errors++; }
      }
    } finally { await page.close(); }
  }

  async scrapeCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;
    while (hasMore && currentPage <= 30) {
      try {
        const url = currentPage > 1 ? `${this.baseUrl}${cat.path}?page=${currentPage}` : `${this.baseUrl}${cat.path}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await this.delay(2500);
        const html = await page.content();
        const $ = cheerio.load(html);
        const products = [];
        const seen = new Set();
        $('a[href*="/productos/"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
          if (seen.has(fullUrl)) return;
          // Produto tem ID numérico no final
          if (!href.match(/\/\d+$/)) return;
          seen.add(fullUrl);
          const $ctx = $(el).closest('div, li') || $(el).parent();
          let name = $(el).find('img').attr('alt') || $ctx.find('h3, h4, .name').first().text().trim() || $(el).text().trim().split('\n')[0];
          if (!name || name.length < 3) return;
          const text = $ctx.text();
          const m = text.match(/U?\$\s*([\d.,]+)/i);
          let priceUsd = null;
          if (m) { let v = m[1]; if (v.includes(',')) v = v.replace(',', '.'); priceUsd = parseFloat(v) || null; }
          let img = $ctx.find('img').first().attr('src') || '';
          if (img && !img.startsWith('http')) img = this.baseUrl + img;
          products.push({
            name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
            slug: href.split('/').pop(), external_id: href.split('/').pop(),
            price_usd: priceUsd, price_original: null, discount_percent: null,
            currency: 'USD', brand: null, image_url: img, product_url: fullUrl,
            category_id: categoryId, in_stock: true, specs: {},
          });
        });
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);
        for (const p of products) await this.upsertProduct(p);
        hasMore = $('a[rel="next"], .next, a:contains("Siguiente")').length > 0 || products.length >= 12;
        currentPage++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }
}
module.exports = EleganciaCompanyScraper;
