const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');
const { scrapeTxtList } = require('./TxtBooster');

class MadridCenterScraper extends BaseScraper {
  constructor() {
    super('madrid-center');
    this.baseUrl = 'https://www.madridcenter.com';
    this.categories = [
      { name: 'Receptores', slug: 'receptores', path: '/produtos/receptor' },
      { name: 'Celulares', slug: 'celulares', path: '/produtos/celulares' },
      { name: 'Informática', slug: 'informatica', path: '/produtos/informatica' },
      { name: 'Automotivo', slug: 'automotivo', path: '/produtos/automotivo' },
      { name: 'TV & Vídeo', slug: 'tv-video', path: '/produtos/tv-video' },
      { name: 'Games', slug: 'games', path: '/produtos/games' },
      { name: 'Áudio', slug: 'audio', path: '/produtos/audio' },
      { name: 'Relógio', slug: 'relogio', path: '/produtos/relogio' },
      { name: 'Beleza & Saúde', slug: 'beleza-saude', path: '/produtos/beleza-saude' },
      { name: 'Eletroportáteis', slug: 'eletroportateis', path: '/produtos/eletroportateis' },
      { name: 'Câmeras & Filmadoras', slug: 'cameras', path: '/produtos/cameras-filmadoras' },
      { name: 'Segurança', slug: 'seguranca', path: '/produtos/seguranca' },
      { name: 'Bebidas', slug: 'bebidas', path: '/produtos/bebidas' },
      { name: 'Brinquedos', slug: 'brinquedos', path: '/produtos/brinquedos-e-outros' },
      { name: 'Iluminação', slug: 'iluminacao', path: '/produtos/iluminacao-leds' },
    ];
  }
  async scrape() {
    const page = await this.createPage();
    try {
      await scrapeTxtList(this, page, `${this.baseUrl}/lista-txt`);
      for (const cat of this.categories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCat(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) { this.stats.errors++; }
      }
    } finally { await page.close(); }
  }
  async scrapeCat(page, cat, categoryId) {
    let p = 1, hasMore = true;
    while (hasMore && p <= 30) {
      try {
        const url = p > 1 ? `${this.baseUrl}${cat.path}?page=${p}` : `${this.baseUrl}${cat.path}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' }); await this.delay(2500);
        const html = await page.content(); const $ = cheerio.load(html);
        const products = []; const seen = new Set();
        $('a[href*="/produto/"]').each((_, el) => {
          const href = $(el).attr('href') || ''; if (seen.has(href)) return; seen.add(href);
          const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
          const $ctx = $(el).closest('div, li') || $(el).parent();
          let name = $ctx.find('h3, h4, .nome, .name').first().text().trim() || $(el).find('img').attr('alt') || '';
          if (!name || name.length < 5) return;
          const text = $ctx.text();
          const pm = text.match(/U?\$\s*([\d.,]+)/i);
          let price = null;
          if (pm) { let v = pm[1]; if (v.includes(',')) v = v.replace(',', '.'); price = parseFloat(v) || null; }
          const codMatch = text.match(/Cod:\s*(\d+)/i) || href.match(/(\d{5,})/);
          let img = $ctx.find('img').first().attr('src') || '';
          products.push({ name: name.substring(0,500), slug: codMatch?.[1] || href.split('/').pop(), external_id: codMatch?.[1] || '',
            price_usd: price, price_original: null, discount_percent: null, currency: 'USD', brand: null,
            image_url: img, product_url: fullUrl, category_id: categoryId, in_stock: true, specs: {} });
        });
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${p}: ${products.length}`);
        for (const pr of products) await this.upsertProduct(pr);
        hasMore = $('a[rel="next"], .next, a:contains("Próx")').length > 0 || products.length >= 12; p++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }
}
module.exports = MadridCenterScraper;
