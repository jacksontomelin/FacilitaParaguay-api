const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');
const { scrapeTxtList } = require('./TxtBooster');

/**
 * Mobile Zone - OpenCart platform
 * Search: /index.php?route=product/search&search=TERM
 * Categories: sidebar com APPLE, AUTOMOTIVO, BEBIDAS, CAMERAS, etc
 * Pagination: &page=N&limit=96
 * Lista TXT: mobilezone.com.br/lista
 */
class MobileZoneScraper extends BaseScraper {
  constructor() {
    super('mobile-zone');
    this.baseUrl = 'http://www.mobilezone.com.br';

    // Categorias extraídas do menu OpenCart real
    this.categories = [
      // Apple
      { name: 'iPhone', slug: 'iphone', path: '/cat_celulares' },
      { name: 'iPad', slug: 'ipad', path: '/index.php?route=product/search&search=ipad' },
      { name: 'MacBook', slug: 'macbook', path: '/index.php?route=product/search&search=macbook' },
      { name: 'Apple Watch', slug: 'apple-watch', path: '/index.php?route=product/search&search=apple+watch' },
      // Automotivo
      { name: 'Automotivo', slug: 'automotivo', path: '/index.php?route=product/category&path=82' },
      // Bebidas
      { name: 'Bebidas', slug: 'bebidas', path: '/index.php?route=product/category&path=99' },
      // Câmeras
      { name: 'Câmeras', slug: 'cameras', path: '/index.php?route=product/category&path=66' },
      // Casa ou Escritório
      { name: 'Casa ou Escritório', slug: 'casa-escritorio', path: '/index.php?route=product/category&path=92' },
      // Cosméticos
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/index.php?route=product/category&path=112' },
      // Eletrodomésticos
      { name: 'Eletrodomésticos', slug: 'eletrodomesticos', path: '/index.php?route=product/category&path=95' },
      // Eletrônicos
      { name: 'Eletrônicos', slug: 'eletronicos', path: '/index.php?route=product/category&path=62' },
      // Games
      { name: 'Games', slug: 'games', path: '/index.php?route=product/category&path=68' },
      // Informática
      { name: 'Informática', slug: 'informatica', path: '/index.php?route=product/category&path=63' },
      // Perfumaria
      { name: 'Perfumaria', slug: 'perfumaria', path: '/index.php?route=product/category&path=97' },
      // Telefonia
      { name: 'Telefonia', slug: 'telefonia', path: '/index.php?route=product/category&path=60' },
    ];

    this.searchTerms = [
      'samsung galaxy', 'xiaomi', 'motorola', 'jbl', 'sony',
      'garmin', 'gopro', 'dji drone', 'notebook', 'smart tv',
      'air fryer', 'perfume', 'playstation', 'nintendo switch',
    ];
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // 1. Lista TXT se disponível
      try {
        await scrapeTxtList(this, page, 'http://mobilezone.com.br/lista');
      } catch (_) {}

      // 2. Scrape por categorias
      console.log(`[${this.storeSlug}] Scraping ${this.categories.length} categorias...`);
      for (const cat of this.categories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCategory(page, cat, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro cat ${cat.name}: ${err.message}`);
          this.stats.errors++;
        }
      }

      // 3. Busca por termos
      console.log(`[${this.storeSlug}] Buscando ${this.searchTerms.length} termos...`);
      for (const term of this.searchTerms) {
        try {
          const searchPath = `/index.php?route=product/search&search=${encodeURIComponent(term)}`;
          const catSlug = `busca-${term.toLowerCase().replace(/\s+/g, '-')}`;
          const catId = await this.upsertCategory(`Busca: ${term}`, catSlug, null, this.baseUrl + searchPath);
          await this.scrapeCategory(page, { path: searchPath, slug: catSlug }, catId);
          await this.delay(2000 + Math.random() * 1500);
        } catch (err) {
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
    const limit = 96; // OpenCart max

    while (hasMore && currentPage <= 20) {
      try {
        const sep = cat.path.includes('?') ? '&' : '?';
        const url = `${this.baseUrl}${cat.path}${sep}page=${currentPage}&limit=${limit}&sort=p.sort_order&order=ASC`;

        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.delay(2000);

        const html = await page.content();
        const products = this.parseProducts(html, categoryId);

        if (products.length === 0) { hasMore = false; break; }

        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);

        for (const p of products) {
          await this.upsertProduct(p);
        }

        // OpenCart mostra "Página X de Y" ou pagination links
        const $ = cheerio.load(html);
        const nextPage = $('a:contains(">")', '.pagination').length > 0 ||
                         $('a[href*="page=' + (currentPage + 1) + '"]').length > 0;
        hasMore = nextPage || products.length >= limit * 0.8;
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

    // OpenCart: .product-layout, .product-thumb, ou grid items
    const selectors = ['.product-layout', '.product-thumb', '.product-grid', '.product-list'];
    let $items = $();
    for (const sel of selectors) {
      $items = $(sel);
      if ($items.length > 0) break;
    }

    if ($items.length > 0) {
      $items.each((_, el) => {
        const p = this.extractFromCard($, $(el), categoryId);
        if (p && !seen.has(p.product_url)) {
          seen.add(p.product_url);
          products.push(p);
        }
      });
    }

    // Fallback: links com imagem
    if (products.length === 0) {
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href.includes('product_id=') && !href.includes('/product/')) return;
        if (seen.has(href)) return;

        const $el = $(el);
        const name = $el.find('img').attr('alt') || $el.text().trim().split('\n')[0];
        if (!name || name.length < 5) return;

        seen.add(href);
        const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
        const parentText = $el.closest('div, li').text();

        products.push({
          name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
          slug: href.match(/product_id=(\d+)/)?.[1] || href.split('/').pop(),
          external_id: href.match(/product_id=(\d+)/)?.[1] || '',
          price_usd: this.parsePrice(parentText),
          price_original: null,
          discount_percent: null,
          currency: 'USD',
          brand: this.extractBrand(name),
          image_url: $el.find('img').attr('src') || '',
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
    const $link = $card.find('.caption a, .product-name a, h4 a, .name a, a[href*="product"]').first();
    const href = $link.attr('href');
    if (!href) return null;

    const fullUrl = href.startsWith('http') ? href : this.baseUrl + href;
    let name = $link.text().trim() || $card.find('img').attr('alt') || '';
    if (!name || name.length < 3) return null;

    // OpenCart preço: .price, .price-new, .price-old
    let priceUsd = null, priceOriginal = null, discountPercent = null;
    const newPrice = $card.find('.price-new, .special-price').first().text();
    const oldPrice = $card.find('.price-old, .old-price').first().text();

    if (newPrice) priceUsd = this.parsePrice(newPrice);
    if (oldPrice) priceOriginal = this.parsePrice(oldPrice);
    if (!priceUsd) priceUsd = this.parsePrice($card.find('.price').first().text());

    if (priceOriginal && priceUsd && priceOriginal > priceUsd) {
      discountPercent = Math.round((1 - priceUsd / priceOriginal) * 100);
    }

    let imageUrl = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src') || '';
    const productId = href.match(/product_id=(\d+)/)?.[1] || href.split('/').pop();

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug: productId,
      external_id: productId,
      price_usd: priceUsd,
      price_original: priceOriginal,
      discount_percent: discountPercent,
      currency: 'USD',
      brand: this.extractBrand(name),
      image_url: imageUrl,
      product_url: fullUrl,
      category_id: categoryId,
      in_stock: !$card.find('.out-of-stock, .outofstock').length,
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
      'TP-LINK', 'SANDISK', 'KINGSTON', 'EPSON', 'BROTHER',
      'SONOFF', 'MULTILASER',
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

module.exports = MobileZoneScraper;
