const BaseScraper = require('./BaseScraper');
const { scrapeTxtList } = require('./TxtBooster');

class AtacadoConnectScraper extends BaseScraper {
  constructor() { super('atacado-connect'); this.baseUrl = 'https://www.atacadoconnect.com'; }
  async scrape() {
    const page = await this.createPage();
    try {
      await scrapeTxtList(this, page, 'https://www.atacadogames.com/lista-preco');
      const cats = ['celulares','games','informatica','eletronicos','audio','perfumes','cameras','tablets','acessorios'];
      for (const c of cats) {
        try {
          const catId = await this.upsertCategory(c, c, null, `${this.baseUrl}/${c}`);
          await this.scrapePage(page, `${this.baseUrl}/${c}`, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (_) { this.stats.errors++; }
      }
    } finally { await page.close(); }
  }
  async scrapePage(page, url, categoryId) {
    let p = 1, hasMore = true;
    while (hasMore && p <= 20) {
      try {
        await page.goto(p > 1 ? `${url}?page=${p}` : url, { waitUntil: 'networkidle' }); await this.delay(2500);
        const products = await page.evaluate(() => {
          const items = []; const seen = new Set();
          document.querySelectorAll('a[href]').forEach(a => {
            const img = a.querySelector('img'); if (!img) return;
            const name = img.alt || a.textContent?.trim().split('\n')[0]; if (!name || name.length < 5) return;
            if (seen.has(a.href) || a.href.includes('/category') || a.href.includes('/search')) return; seen.add(a.href);
            const ctx = a.closest('div, li') || a.parentElement;
            const pm = ctx?.textContent?.match(/U?S?\$\s*([\d.,]+)/i);
            items.push({ name: name.substring(0,500), url: a.href, image: img.src, price: pm?.[1] || null });
          });
          return items;
        });
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] p${p}: ${products.length}`);
        for (const pr of products) {
          let price = null;
          if (pr.price) { let v = pr.price; if (v.includes(',')&&v.includes('.')) v=v.replace(/,/g,''); else if(v.includes(',')) v=v.replace(',','.'); price = parseFloat(v)||null; }
          await this.upsertProduct({ name: pr.name, slug: pr.url.split('/').pop(), external_id: pr.url.split('/').pop(),
            price_usd: price, price_original: null, discount_percent: null, currency: 'USD', brand: null,
            image_url: pr.image, product_url: pr.url, category_id: categoryId, in_stock: true, specs: {} });
        }
        hasMore = products.length >= 12; p++;
      } catch (_) { this.stats.errors++; hasMore = false; }
    }
  }
}
module.exports = AtacadoConnectScraper;
