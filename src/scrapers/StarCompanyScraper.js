const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class StarCompanyScraper extends BaseScraper {
  constructor() {
    super('star-company');
    this.baseUrl = 'https://www.starcompany-py.com';
    // PrestaShop: /ID-slug
    this.categories = [
      { name: 'Perfumes', slug: 'perfumes', path: '/6-perfumes' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/100-cosmeticos' },
      { name: 'Celulares', slug: 'celulares', path: '/101-celular' },
      { name: 'Eletrônicos', slug: 'eletronicos', path: '/107-eletronicos' },
      { name: 'Informática', slug: 'informatica', path: '/108-informatica' },
      { name: 'Motos / Scooters', slug: 'motos', path: '/109-motos-scooters' },
      { name: 'Suplementos', slug: 'suplementos', path: '/110-suplementos' },
      { name: 'Vaper', slug: 'vaper', path: '/111-vaper' },
    ];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      for (const cat of this.categories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapePrestashopCategory(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro ${cat.name}: ${err.message}`);
          this.stats.errors++;
        }
      }
    } finally { await page.close(); }
  }

  async scrapePrestashopCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;
    while (hasMore && currentPage <= 30) {
      try {
        const url = currentPage > 1 ? `${this.baseUrl}${cat.path}?page=${currentPage}` : `${this.baseUrl}${cat.path}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.delay(2000);
        const html = await page.content();
        const products = this.parseProducts(html, categoryId);
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);
        for (const p of products) await this.upsertProduct(p);
        const $ = cheerio.load(html);
        hasMore = $('a[rel="next"], .next a, a:contains("Siguiente")').length > 0 || products.length >= 12;
        currentPage++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();
    // PrestaShop: links /CATEGORIA/ID-slug.html com preço U$ e "In Stock"
    $('a[href$=".html"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes(this.baseUrl) && !href.startsWith('/')) return;
      const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
      if (seen.has(fullUrl) || !fullUrl.match(/\/\d+-[^/]+\.html$/)) return;
      seen.add(fullUrl);

      const $ctx = $(el).closest('div, li, article');
      let name = $ctx.find('h3, h4, .product-title, .product-name').first().text().trim();
      if (!name) name = $(el).find('img').attr('alt') || $(el).attr('title') || '';
      if (!name || name.length < 3) return;

      const text = $ctx.text();
      const priceMatch = text.match(/U\$\s*([\d.,]+)/i);
      let priceUsd = null;
      if (priceMatch) {
        let v = priceMatch[1];
        if (v.includes(',')) v = v.replace(',', '.');
        priceUsd = parseFloat(v) || null;
      }
      const brandMatch = text.match(/^([A-Z][A-Z\s&']+)\s*·/m);
      const brand = brandMatch ? brandMatch[1].trim() : this.extractBrand(name);
      const inStock = /In Stock/i.test(text) && !/Out of stock/i.test(text);
      const refMatch = text.match(/Referência\s*(\d+)/i) || fullUrl.match(/\/(\d+)-/);
      const extId = refMatch ? refMatch[1] : fullUrl.split('/').pop().replace('.html', '');
      let img = $ctx.find('img').first().attr('src') || '';

      products.push({
        name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
        slug: fullUrl.split('/').pop().replace('.html', ''),
        external_id: extId,
        price_usd: priceUsd, price_original: null, discount_percent: null,
        currency: 'USD', brand,
        image_url: img, product_url: fullUrl,
        category_id: categoryId, in_stock: inStock, specs: {},
      });
    });
    return products;
  }

  extractBrand(name) {
    const brands = ['APPLE','SAMSUNG','XIAOMI','MOTOROLA','JBL','SONY','CANON','NIKON','GARMIN',
      'LATTAFA','ARMAF','AL WATANIAH','MAISON ALHAMBRA','BHARARA','VERSACE','HUGO BOSS',
      'CAROLINA HERRERA','PACO RABANNE','CALVIN KLEIN','CHANEL','DIOR','DAVIDOFF',
      'VICTORIA SECRET','FRAGRANCE WORLD','CHRISTIAN DIOR','YVES SAINT LAURENT','AUX'];
    const upper = name.toUpperCase();
    const sorted = [...brands].sort((a, b) => b.length - a.length);
    for (const b of sorted) {
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[\\s/\\-.(_])' + esc + '([\\s/\\-.).,_]|$)', 'i').test(upper)) return b;
    }
    return null;
  }
}
module.exports = StarCompanyScraper;
