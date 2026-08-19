const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

/**
 * One Click - Plataforma custom
 * URL categorias: /categoria/SLUG ou /categoria/SLUG/ID
 * URL marcas: /categoria/SLUG (apple, samsung, garmin, xiaomi)
 * Tem busca
 */
class OneClickScraper extends BaseScraper {
  constructor() {
    super('one-click');
    this.baseUrl = 'https://oneclick.com.py';

    this.categories = [
      { name: 'Celulares', slug: 'celulares', path: '/categoria/celulares/celulares' },
      { name: 'Eletrônicos', slug: 'eletronicos', path: '/categoria/eletronicos' },
      { name: 'Informática', slug: 'informatica', path: '/categoria/informatica/40' },
      { name: 'Apple', slug: 'apple', path: '/categoria/apple' },
      { name: 'Samsung', slug: 'samsung', path: '/categoria/samsung' },
      { name: 'Xiaomi', slug: 'xiaomi', path: '/categoria/xiaomi' },
      { name: 'Garmin', slug: 'garmin', path: '/categoria/garmin' },
      { name: 'Câmeras', slug: 'cameras', path: '/categoria/camaras' },
      { name: 'Drones', slug: 'drones', path: '/categoria/drones' },
      { name: 'Smart Watch', slug: 'smartwatch', path: '/categoria/smart-watch' },
      { name: 'Fones de Ouvido', slug: 'fones', path: '/categoria/fones-de-ouvido' },
      { name: 'Caixas de Som', slug: 'caixas-som', path: '/categoria/caixas-de-som' },
      { name: 'Games', slug: 'games', path: '/categoria/games' },
      { name: 'Notebooks', slug: 'notebooks', path: '/categoria/notebooks' },
      { name: 'Monitores', slug: 'monitores', path: '/categoria/monitores' },
      { name: 'TVs', slug: 'tvs', path: '/categoria/tvs' },
      { name: 'Perfumes', slug: 'perfumes', path: '/categoria/perfumes' },
      { name: 'Skincare', slug: 'skincare', path: '/categoria/skincare' },
      { name: 'Casa', slug: 'casa', path: '/categoria/casa' },
      { name: 'Automotivo', slug: 'automotivo', path: '/categoria/automotivo' },
    ];
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // Descobrir categorias do menu
      console.log(`[${this.storeSlug}] Acessando ${this.baseUrl}...`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this.delay(3000);

      const discovered = await page.evaluate((base) => {
        const cats = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/categoria/"]').forEach(a => {
          const href = a.href;
          const text = a.textContent.trim();
          if (!text || text.length < 2 || seen.has(href)) return;
          seen.add(href);
          const path = href.replace(base, '');
          if (path.split('/').filter(Boolean).length > 3) return;
          cats.push({ name: text.substring(0, 100), slug: path.replace(/\//g, '-').replace(/^-/, ''), path });
        });
        return cats;
      }, this.baseUrl);

      // Merge
      const allCats = new Map();
      for (const c of this.categories) allCats.set(c.slug, c);
      for (const c of discovered) {
        if (!allCats.has(c.slug)) allCats.set(c.slug, c);
      }
      const categories = Array.from(allCats.values());

      console.log(`[${this.storeSlug}] Scraping ${categories.length} categorias...`);

      for (const cat of categories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCategory(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro cat ${cat.name}: ${err.message}`);
          this.stats.errors++;
        }
      }
    } finally {
      await page.close();
    }
  }

  async scrapeCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;

    while (hasMore && currentPage <= 30) {
      try {
        const sep = cat.path.includes('?') ? '&' : '?';
        const url = `${this.baseUrl}${cat.path}${currentPage > 1 ? sep + 'page=' + currentPage : ''}`;

        await page.goto(url, { waitUntil: 'networkidle' });
        await this.delay(2500);

        // Esperar produtos
        try {
          await page.waitForSelector('a[href*="/producto/"], a[href*="/product/"], .product', { timeout: 8000 });
        } catch (_) {}

        const html = await page.content();
        const products = this.parseProducts(html, categoryId);

        if (products.length === 0) { hasMore = false; break; }

        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);

        for (const p of products) {
          await this.upsertProduct(p);
        }

        const $ = cheerio.load(html);
        const nextExists = $('a[rel="next"], .pagination .next, a:contains("Próx"), a:contains("Siguiente")').length > 0;
        hasMore = nextExists || products.length >= 15;
        currentPage++;
      } catch (err) {
        this.stats.errors++;
        hasMore = false;
      }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();

    // Tentar cards de produto
    const cardSel = ['.product-card', '.product-item', '.product', '[class*="product"]', '.card'];
    let $cards = $();
    for (const sel of cardSel) {
      $cards = $(sel);
      if ($cards.length > 0) break;
    }

    if ($cards.length > 0) {
      $cards.each((_, el) => {
        const p = this.extractFromCard($, $(el), categoryId);
        if (p && !seen.has(p.product_url)) {
          seen.add(p.product_url);
          products.push(p);
        }
      });
    }

    // Fallback: links de produto
    if (products.length === 0) {
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        // One Click: /producto/CODE/slug ou links com product_id
        if (!href.match(/\/produc?to\//) && !href.includes('product_id=')) return;
        if (href.includes('/categoria/')) return;

        const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);

        const $el = $(el);
        const name = $el.find('img').attr('alt') || $el.text().trim().split('\n')[0] || '';
        if (!name || name.length < 5) return;

        const $ctx = $el.closest('div, li, article') || $el.parent();
        const text = $ctx.text();

        products.push({
          name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
          slug: fullUrl.split('/').pop() || '',
          external_id: fullUrl.match(/\/(\d+)\//)?.[1] || fullUrl.split('/').pop() || '',
          price_usd: this.parsePrice(text),
          price_original: null,
          discount_percent: null,
          currency: 'USD',
          brand: this.extractBrand(name),
          image_url: $el.find('img').attr('src') || $ctx.find('img').first().attr('src') || '',
          product_url: fullUrl,
          category_id: categoryId,
          in_stock: true,
          specs: {},
        });
      });
    }

    return products;
  }

  extractFromCard($, $card, categoryId) {
    const $link = $card.find('a[href*="/produc"], a[href*="product"]').first();
    if (!$link.length) return null;
    const href = $link.attr('href');
    if (!href) return null;

    const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
    let name = $card.find('h3, h4, .product-name, .name, .title, a').first().text().trim();
    if (!name) name = $card.find('img').attr('alt') || '';
    if (!name || name.length < 3) return null;

    let priceUsd = null, priceOriginal = null, discountPercent = null;
    const specialText = $card.find('.special-price, .price-new, .price-sale').first().text();
    const oldText = $card.find('.old-price, .price-old, .price-regular').first().text();

    if (specialText) priceUsd = this.parsePrice(specialText);
    if (oldText) priceOriginal = this.parsePrice(oldText);
    if (!priceUsd) priceUsd = this.parsePrice($card.text());

    if (priceOriginal && priceUsd && priceOriginal > priceUsd) {
      discountPercent = Math.round((1 - priceUsd / priceOriginal) * 100);
    }

    let imageUrl = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src') || '';

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug: fullUrl.split('/').pop() || '',
      external_id: fullUrl.match(/\/(\d+)\//)?.[1] || fullUrl.split('/').pop() || '',
      price_usd: priceUsd,
      price_original: priceOriginal,
      discount_percent: discountPercent,
      currency: 'USD',
      brand: this.extractBrand(name),
      image_url: imageUrl,
      product_url: fullUrl,
      category_id: categoryId,
      in_stock: !$card.find('.out-of-stock, .unavailable').length,
      specs: {},
    };
  }

  parsePrice(text) {
    if (!text) return null;
    const m = text.match(/US?\$\s*([\d.,]+)/i) || text.match(/\$\s*([\d.,]+)/);
    if (!m) return null;
    let val = m[1];
    if (val.includes('.') && val.includes(',')) {
      val = val.indexOf(',') < val.indexOf('.') ? val.replace(/,/g, '') : val.replace(/\./g, '').replace(',', '.');
    } else if (val.includes(',')) val = val.replace(',', '.');
    const num = parseFloat(val);
    return (!isNaN(num) && num > 0 && num < 100000) ? num : null;
  }

  extractBrand(name) {
    const brands = [
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'REALME', 'NOKIA', 'HUAWEI',
      'JBL', 'SONY', 'BOSE', 'LG', 'CANON', 'NIKON', 'GOPRO', 'DJI',
      'GARMIN', 'ASUS', 'MSI', 'ACER', 'LENOVO', 'DELL', 'HP',
      'CORSAIR', 'LOGITECH', 'RAZER', 'PLAYSTATION', 'NINTENDO', 'XBOX',
      'CAROLINA HERRERA', 'PACO RABANNE', 'CALVIN KLEIN', 'HUGO BOSS',
      'TP-LINK', 'SANDISK', 'KINGSTON',
    ];
    const upper = name.toUpperCase();
    const sorted = [...brands].sort((a, b) => b.length - a.length);
    for (const b of sorted) {
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[\\s/\\-.(_])' + esc + '([\\s/\\-.).,_]|$)', 'i').test(upper)) return b;
    }
    const first = name.split(' ')[0];
    if (first.length >= 2 && first === first.toUpperCase() && /^[A-Z]/.test(first)) return first;
    return null;
  }
}

module.exports = OneClickScraper;
