const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class LaPetisqueraScraper extends BaseScraper {
  constructor() {
    super('la-petisquera');
    this.baseUrl = 'https://lapetisquera.com.py';
    // WooCommerce: /categoria-producto/SLUG/ e /tienda/SLUG/product-slug/
    this.categories = [
      { name: 'Perfumería', slug: 'perfumeria', path: '/categoria-producto/perfumeria/' },
      { name: 'Perfume Feminino', slug: 'perfume-feminino', path: '/categoria-producto/perfumeria/femenino/' },
      { name: 'Perfume Masculino', slug: 'perfume-masculino', path: '/categoria-producto/perfumeria/masculino/' },
      { name: 'Perfume Unisex', slug: 'perfume-unisex', path: '/categoria-producto/perfumeria/unisex/' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/categoria-producto/maquillajes/' },
      { name: 'Moda', slug: 'moda', path: '/categoria-producto/moda/' },
      { name: 'Eletrônicos', slug: 'eletronicos', path: '/categoria-producto/electronicos/' },
      { name: 'Celulares', slug: 'celulares', path: '/categoria-producto/electronicos/celulares/' },
      { name: 'Eletrodomésticos', slug: 'eletrodomesticos', path: '/categoria-producto/electrodomesticos/' },
      { name: 'Esportes', slug: 'esportes', path: '/categoria-producto/deporte/' },
      { name: 'Bebidas', slug: 'bebidas', path: '/categoria-producto/bebidas/' },
    ];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      for (const cat of this.categories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeWooCategory(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro ${cat.name}: ${err.message}`);
          this.stats.errors++;
        }
      }
    } finally { await page.close(); }
  }

  async scrapeWooCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;
    while (hasMore && currentPage <= 30) {
      try {
        const url = currentPage > 1 ? `${this.baseUrl}${cat.path}page/${currentPage}/` : `${this.baseUrl}${cat.path}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.delay(2000);
        const html = await page.content();
        const products = this.parseWooProducts(html, categoryId);
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);
        for (const p of products) await this.upsertProduct(p);
        const $ = cheerio.load(html);
        hasMore = $('a.next, a.page-numbers.next').length > 0;
        currentPage++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }

  parseWooProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();
    // WooCommerce: .product, .type-product, li.product
    $('li.product, .product, .type-product').each((_, el) => {
      const $card = $(el);
      const $link = $card.find('a[href*="/tienda/"], a.woocommerce-LoopProduct-link, a[href*="/producto/"]').first();
      const href = $link.attr('href');
      if (!href || seen.has(href)) return;
      if (href.includes('/categoria-producto/') || href.includes('/marca/')) return;
      seen.add(href);
      let name = $card.find('.woocommerce-loop-product__title, h2, h3, .product-title').first().text().trim();
      if (!name) name = $card.find('img').attr('alt') || '';
      if (!name || name.length < 3) return;

      let priceUsd = null;
      const priceText = $card.find('.price, .woocommerce-Price-amount').first().text();
      const m = priceText.match(/\$\s*([\d.,]+)/);
      if (m) { let v = m[1]; if (v.includes(',')) v = v.replace(',', '.'); priceUsd = parseFloat(v) || null; }

      let img = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src') || '';
      const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;

      products.push({
        name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
        slug: fullUrl.split('/').filter(Boolean).pop() || '',
        external_id: fullUrl.split('/').filter(Boolean).pop() || '',
        price_usd: priceUsd, price_original: null, discount_percent: null,
        currency: 'USD', brand: null,
        image_url: img, product_url: fullUrl,
        category_id: categoryId, in_stock: true, specs: {},
      });
    });
    return products;
  }
}
module.exports = LaPetisqueraScraper;
