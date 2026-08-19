const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class MultiPassScraper extends BaseScraper {
  constructor() {
    super('multipass');
    this.baseUrl = 'https://multipass.com.py';
    this.searchTerms = [
      'iphone', 'samsung', 'xiaomi', 'macbook', 'ipad', 'airpods',
      'playstation', 'nintendo', 'xbox', 'jbl', 'sony', 'garmin',
      'gopro', 'dji', 'perfume', 'notebook', 'smart tv', 'air fryer',
    ];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      // Descobrir categorias do menu
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this.delay(3000);
      const cats = await page.evaluate((base) => {
        const items = [];
        const seen = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.href;
          const text = a.textContent.trim();
          if (!text || text.length < 2 || !href.includes(base)) return;
          const path = href.replace(base, '');
          const ignore = ['login','register','cart','checkout','account','contact','faq','about','privacy','terms'];
          if (ignore.some(i => path.includes(i))) return;
          const parts = path.split('/').filter(Boolean);
          if (parts.length < 1 || parts.length > 2) return;
          const slug = parts.join('-');
          if (seen.has(slug)) return;
          seen.add(slug);
          items.push({ name: text.substring(0, 100), slug, path });
        });
        return items;
      }, this.baseUrl);

      console.log(`[${this.storeSlug}] ${cats.length} categorias descobertas`);
      for (const cat of cats) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCategory(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) { this.stats.errors++; }
      }

      // Busca por termos
      for (const term of this.searchTerms) {
        try {
          const path = `/search?q=${encodeURIComponent(term)}`;
          const catSlug = `busca-${term.replace(/\s+/g, '-')}`;
          const catId = await this.upsertCategory(`Busca: ${term}`, catSlug, null, this.baseUrl + path);
          await this.scrapeCategory(page, { path, slug: catSlug }, catId);
          await this.delay(2000 + Math.random() * 1500);
        } catch (err) { this.stats.errors++; }
      }
    } finally { await page.close(); }
  }

  async scrapeCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;
    while (hasMore && currentPage <= 20) {
      try {
        const sep = cat.path.includes('?') ? '&' : '?';
        const url = `${this.baseUrl}${cat.path}${currentPage > 1 ? sep + 'page=' + currentPage : ''}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await this.delay(2500);
        try { await page.waitForSelector('a[href] img, .product', { timeout: 8000 }); } catch (_) {}
        const products = await page.evaluate((base) => {
          const items = [];
          const seen = new Set();
          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.href;
            const img = a.querySelector('img');
            if (!img) return;
            const name = img.alt || a.textContent?.trim().split('\n')[0] || '';
            if (!name || name.length < 5 || seen.has(href)) return;
            if (href.includes('/category') || href.includes('/search') || href.includes('javascript')) return;
            seen.add(href);
            const parent = a.closest('div, li, article') || a.parentElement;
            const text = parent?.textContent || '';
            const pm = text.match(/U?S?\$\s*([\d.,]+)/i);
            items.push({ name: name.substring(0, 500), url: href, image: img.src || '', price: pm ? pm[1] : null });
          });
          return items;
        }, this.baseUrl);

        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length}`);
        for (const p of products) {
          let priceUsd = null;
          if (p.price) { let v = p.price; if (v.includes(',') && v.includes('.')) v = v.replace(/,/g, ''); else if (v.includes(',')) v = v.replace(',', '.'); priceUsd = parseFloat(v) || null; }
          await this.upsertProduct({
            name: p.name, slug: p.url.split('/').pop(), external_id: p.url.split('/').pop(),
            price_usd: priceUsd, price_original: null, discount_percent: null,
            currency: 'USD', brand: null, image_url: p.image, product_url: p.url,
            category_id: categoryId, in_stock: true, specs: {},
          });
        }
        hasMore = products.length >= 12;
        currentPage++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }
}
module.exports = MultiPassScraper;
