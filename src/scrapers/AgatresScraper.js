const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class AgatresScraper extends BaseScraper {
  constructor() {
    super('agatres');
    this.baseUrl = 'https://agatres.co';
    // WooCommerce com /pt/ prefix
    this.categories = [
      { name: 'Perfumes', slug: 'perfumes', path: '/pt/categoria-produto/perfumes/' },
      { name: 'Perfumes Masculinos', slug: 'perfumes-masculinos', path: '/pt/categoria-produto/perfumes/masculinos/' },
      { name: 'Perfumes Femininos', slug: 'perfumes-femininos', path: '/pt/categoria-produto/perfumes/femininos/' },
      { name: 'Perfumes Unisex', slug: 'perfumes-unisex', path: '/pt/categoria-produto/perfumes/unisex/' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/pt/categoria-produto/cosmeticos/' },
      { name: 'Skincare', slug: 'skincare', path: '/pt/categoria-produto/skincare/' },
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
        } catch (err) { this.stats.errors++; }
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
        const $ = cheerio.load(html);
        const products = [];
        const seen = new Set();
        $('li.product, .product, .type-product').each((_, el) => {
          const $card = $(el);
          const $link = $card.find('a.woocommerce-LoopProduct-link, a[href*="/produto/"], a[href*="/product/"]').first();
          const href = $link.attr('href');
          if (!href || seen.has(href)) return;
          if (href.includes('/categoria-produto/')) return;
          seen.add(href);
          let name = $card.find('.woocommerce-loop-product__title, h2, h3').first().text().trim();
          if (!name) name = $card.find('img').attr('alt') || '';
          if (!name || name.length < 3) return;
          const priceText = $card.find('.price, .woocommerce-Price-amount').first().text();
          const m = priceText.match(/\$\s*([\d.,]+)/);
          let priceUsd = null;
          if (m) { let v = m[1]; if (v.includes(',')) v = v.replace(',', '.'); priceUsd = parseFloat(v) || null; }
          let img = $card.find('img').first().attr('src') || '';
          const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
          products.push({
            name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
            slug: fullUrl.split('/').filter(Boolean).pop(),
            external_id: fullUrl.split('/').filter(Boolean).pop(),
            price_usd: priceUsd, price_original: null, discount_percent: null,
            currency: 'USD', brand: null, image_url: img, product_url: fullUrl,
            category_id: categoryId, in_stock: true, specs: {},
          });
        });
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length}`);
        for (const p of products) await this.upsertProduct(p);
        hasMore = $('a.next, a.page-numbers.next').length > 0;
        currentPage++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }
}
module.exports = AgatresScraper;
