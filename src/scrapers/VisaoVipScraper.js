const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class VisaoVipScraper extends BaseScraper {
  constructor() {
    super('visaovip');
    this.baseUrl = 'https://www.visaovip.com';
    // URLs: /lista-produtos/categoria/SLUG/ID/PAGE e /busca/categoria/SLUG/ID/
    this.categories = [
      { name: 'Notebooks', slug: 'notebooks', path: '/lista-produtos/categoria/notebook-e-computador/20/0' },
      { name: 'Placa de Vídeo', slug: 'placa-video', path: '/lista-produtos/categoria/placa-de-video/23/0' },
      { name: 'Processadores', slug: 'processadores', path: '/lista-produtos/categoria/processadores/24/0' },
      { name: 'Memória RAM', slug: 'memoria-ram', path: '/lista-produtos/categoria/memoria-ram/25/0' },
      { name: 'SSD e HD', slug: 'ssd-hd', path: '/lista-produtos/categoria/ssd-e-hd/26/0' },
      { name: 'Monitores', slug: 'monitores', path: '/lista-produtos/categoria/monitores/27/0' },
      { name: 'Periféricos', slug: 'perifericos', path: '/lista-produtos/categoria/perifericos/28/0' },
      { name: 'Gabinetes', slug: 'gabinetes', path: '/lista-produtos/categoria/gabinetes/29/0' },
      { name: 'Fontes', slug: 'fontes', path: '/lista-produtos/categoria/fontes/30/0' },
      { name: 'Placa Mãe', slug: 'placa-mae', path: '/lista-produtos/categoria/placa-mae/31/0' },
      { name: 'Coolers', slug: 'coolers', path: '/lista-produtos/categoria/coolers/32/0' },
      { name: 'Eletrônicos', slug: 'eletronicos', path: '/lista-produtos/categoria/eletronicos/20/0' },
      { name: 'Variedades', slug: 'variedades', path: '/lista-produtos/categoria/variedades/15/0' },
      { name: 'Redes', slug: 'redes', path: '/lista-produtos/categoria/redes/33/0' },
    ];
    this.searchTerms = ['notebook gamer', 'rtx 4070', 'ryzen', 'macbook', 'monitor ultrawide', 'ssd nvme', 'corsair', 'logitech'];
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
      for (const term of this.searchTerms) {
        try {
          const path = `/lista-produtos/termo/${encodeURIComponent(term)}/1/0`;
          const catSlug = `busca-${term.toLowerCase().replace(/\s+/g, '-')}`;
          const catId = await this.upsertCategory(`Busca: ${term}`, catSlug, null, this.baseUrl + path);
          await this.scrapeCategory(page, { path, slug: catSlug }, catId);
          await this.delay(2000 + Math.random() * 1500);
        } catch (err) { this.stats.errors++; }
      }
    } finally { await page.close(); }
  }

  async scrapeCategory(page, cat, categoryId) {
    // VisãoVip: página no URL /SLUG/ID/PAGE (page = 0, 1, 2...)
    let pageNum = 0;
    let hasMore = true;
    while (hasMore && pageNum <= 20) {
      try {
        const url = pageNum === 0 ? `${this.baseUrl}${cat.path}` :
                    `${this.baseUrl}${cat.path.replace(/\/\d+$/, '/' + pageNum)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.delay(2500);
        const html = await page.content();
        const products = this.parseProducts(html, categoryId);
        if (products.length === 0) { hasMore = false; break; }
        console.log(`[${this.storeSlug}] ${cat.slug} p${pageNum}: ${products.length} produtos`);
        for (const p of products) await this.upsertProduct(p);
        const $ = cheerio.load(html);
        hasMore = $('a:contains("Próximo"), a.next, .pagination a').length > 0 || products.length >= 20;
        pageNum++;
      } catch (err) { this.stats.errors++; hasMore = false; }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();
    // VisãoVip: product cards com preço e link pro detalhe
    $('a[href*="/produto/"], a[href*="/product/"], .product-card a, .product a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
      if (seen.has(fullUrl)) return;
      if (href.includes('/lista-produtos/') || href.includes('/busca/') || href.includes('/categoria/')) return;
      seen.add(fullUrl);
      const $ctx = $(el).closest('div, li, article') || $(el).parent();
      let name = $ctx.find('h3, h4, .product-name, .name').first().text().trim();
      if (!name) name = $(el).find('img').attr('alt') || $(el).text().trim().split('\n')[0];
      if (!name || name.length < 5) return;
      const text = $ctx.text();
      const m = text.match(/\$\s*([\d.,]+)/);
      let priceUsd = null;
      if (m) { let v = m[1]; if (v.includes('.') && v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); else if (v.includes(',')) v = v.replace(',', '.'); priceUsd = parseFloat(v) || null; }
      let img = $ctx.find('img').first().attr('src') || '';
      products.push({
        name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
        slug: fullUrl.split('/').filter(Boolean).pop(),
        external_id: fullUrl.split('/').filter(Boolean).pop(),
        price_usd: priceUsd, price_original: null, discount_percent: null,
        currency: 'USD', brand: null, image_url: img, product_url: fullUrl,
        category_id: categoryId, in_stock: true, specs: {},
      });
    });
    return products;
  }
}
module.exports = VisaoVipScraper;
