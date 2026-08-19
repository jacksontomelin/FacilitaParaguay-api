const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

/**
 * Scraper genérico para lojas do Paraguai
 * Funciona com a maioria dos e-commerces (VTEX, WooCommerce, Magento, custom)
 * Configurável por parâmetros de seletores
 */
class GenericStoreScraper extends BaseScraper {
  constructor(storeSlug, config = {}) {
    super(storeSlug);
    this.config = {
      baseUrl: config.baseUrl || '',
      // Seletores CSS customizáveis
      selectors: {
        categoryLinks: config.selectors?.categoryLinks || 'nav a[href], .menu a[href], .categories a[href]',
        productCard: config.selectors?.productCard || '.product-card, .product-item, [class*="product"], .shelf-item',
        productLink: config.selectors?.productLink || 'a[href*="/p/"], a[href*="/product"], a[href*="/produto"]',
        productName: config.selectors?.productName || '.product-name, .product-title, h3, h4, .name',
        productPrice: config.selectors?.productPrice || '.price, .product-price, [class*="price"]',
        productImage: config.selectors?.productImage || 'img',
        pagination: config.selectors?.pagination || 'a[rel="next"], .next, .pagination .next',
        ...config.selectors,
      },
      // Padrões de URL a ignorar
      ignorePaths: config.ignorePaths || [
        'login', 'register', 'cart', 'checkout', 'account',
        'faq', 'contact', 'about', 'privacy', 'terms',
      ],
      // Padrão de URL de produto
      productUrlPattern: config.productUrlPattern || /\/(p|product|produto)\//,
      // Máximo de páginas por categoria
      maxPages: config.maxPages || 30,
      // Delay entre requests (ms)
      delayMin: config.delayMin || 2000,
      delayMax: config.delayMax || 4000,
      // Pesquisa por termos populares como fallback
      searchTerms: config.searchTerms || [],
      searchUrl: config.searchUrl || null,
    };
  }

  async scrape() {
    const page = await this.createPage();

    try {
      console.log(`[${this.storeSlug}] Acessando ${this.config.baseUrl}...`);
      await page.goto(this.config.baseUrl, { waitUntil: 'domcontentloaded' });
      await this.delay(3000);

      const html = await page.content();

      // Tentar extrair categorias
      const categories = this.extractCategories(html);
      console.log(`[${this.storeSlug}] ${categories.length} categorias encontradas`);

      if (categories.length > 0) {
        for (const cat of categories) {
          try {
            const categoryId = await this.upsertCategory(cat.name, cat.slug, null, cat.url);
            await this.scrapeCategory(page, cat.url, categoryId);
            await this.randomDelay();
          } catch (err) {
            console.error(`[${this.storeSlug}] Erro cat ${cat.name}: ${err.message}`);
            this.stats.errors++;
          }
        }
      }

      // Fallback: buscar por termos populares
      if (this.config.searchTerms.length > 0 && this.config.searchUrl) {
        console.log(`[${this.storeSlug}] Buscando por termos populares...`);
        for (const term of this.config.searchTerms) {
          try {
            const searchFullUrl = this.config.searchUrl.replace('{QUERY}', encodeURIComponent(term));
            const catId = await this.upsertCategory(term, `search-${term.toLowerCase().replace(/\s+/g, '-')}`, null, searchFullUrl);
            await this.scrapeCategory(page, searchFullUrl, catId);
            await this.randomDelay();
          } catch (err) {
            console.error(`[${this.storeSlug}] Erro busca "${term}": ${err.message}`);
            this.stats.errors++;
          }
        }
      }
    } finally {
      await page.close();
    }
  }

  extractCategories(html) {
    const $ = cheerio.load(html);
    const categories = [];
    const seen = new Set();

    $(this.config.selectors.categoryLinks).each((_, el) => {
      const href = $(el).attr('href');
      const name = $(el).text().trim();
      if (!href || !name || name.length < 2) return;

      const fullUrl = this.resolveUrl(href);
      if (!fullUrl || !fullUrl.includes(this.config.baseUrl)) return;

      const path = fullUrl.replace(this.config.baseUrl, '').replace(/\/$/, '');
      if (this.config.ignorePaths.some(i => path.toLowerCase().includes(i))) return;
      if (this.config.productUrlPattern.test(path)) return;

      const parts = path.split('/').filter(Boolean);
      if (parts.length < 1 || parts.length > 2) return;

      const slug = parts.join('-');
      if (seen.has(slug)) return;
      seen.add(slug);

      categories.push({ name, slug, url: fullUrl });
    });

    return categories;
  }

  async scrapeCategory(page, url, categoryId) {
    let pageNum = 1;
    let hasMore = true;

    while (hasMore && pageNum <= this.config.maxPages) {
      try {
        const navUrl = pageNum > 1 ? this.buildPageUrl(url, pageNum) : url;
        await page.goto(navUrl, { waitUntil: 'domcontentloaded' });
        await this.delay(2000);

        const html = await page.content();
        const products = this.parseProducts(html, categoryId);

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`[${this.storeSlug}] ${url} p${pageNum}: ${products.length} produtos`);

        for (const p of products) {
          await this.upsertProduct(p);
        }

        const $ = cheerio.load(html);
        hasMore = $(this.config.selectors.pagination).length > 0 && products.length >= 8;
        pageNum++;
        await this.randomDelay();
      } catch (err) {
        console.error(`[${this.storeSlug}] Erro ${url} p${pageNum}: ${err.message}`);
        this.stats.errors++;
        hasMore = false;
      }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();

    // Tentar seletores de card primeiro
    let $cards = $(this.config.selectors.productCard);

    if ($cards.length > 0) {
      $cards.each((_, el) => {
        const product = this.extractFromCard($, $(el), categoryId);
        if (product && !seen.has(product.product_url)) {
          seen.add(product.product_url);
          products.push(product);
        }
      });
    }

    // Fallback: links de produto
    if (products.length === 0) {
      $(this.config.selectors.productLink).each((_, el) => {
        const product = this.extractFromLink($, $(el), categoryId);
        if (product && !seen.has(product.product_url)) {
          seen.add(product.product_url);
          products.push(product);
        }
      });
    }

    return products;
  }

  extractFromCard($, $card, categoryId) {
    const $link = $card.find('a[href]').first();
    const href = $link.attr('href');
    if (!href) return null;

    const fullUrl = this.resolveUrl(href);
    if (!fullUrl) return null;

    const name = $card.find(this.config.selectors.productName).first().text().trim()
      || $card.find('img').attr('alt') || '';
    if (!name || name.length < 3) return null;

    const priceUsd = this.extractPrice($card.text());
    let imageUrl = $card.find(this.config.selectors.productImage).attr('src')
      || $card.find(this.config.selectors.productImage).attr('data-src') || '';
    if (imageUrl) imageUrl = this.resolveUrl(imageUrl) || imageUrl;

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug: fullUrl.split('/').pop(),
      external_id: fullUrl.split('/').pop(),
      price_usd: priceUsd,
      price_original: null,
      discount_percent: null,
      currency: 'USD',
      brand: null,
      image_url: imageUrl,
      product_url: fullUrl,
      category_id: categoryId,
      in_stock: true,
      specs: {},
    };
  }

  extractFromLink($, $el, categoryId) {
    const href = $el.attr('href');
    if (!href) return null;

    const fullUrl = this.resolveUrl(href);
    if (!fullUrl) return null;

    const name = $el.find('img').attr('alt') || $el.text().trim().split('\n')[0] || '';
    if (!name || name.length < 3) return null;

    const priceUsd = this.extractPrice($el.parent().text());
    let imageUrl = $el.find('img').attr('src') || '';
    if (imageUrl) imageUrl = this.resolveUrl(imageUrl) || imageUrl;

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug: fullUrl.split('/').pop(),
      external_id: fullUrl.split('/').pop(),
      price_usd: priceUsd,
      price_original: null,
      discount_percent: null,
      currency: 'USD',
      brand: null,
      image_url: imageUrl,
      product_url: fullUrl,
      category_id: categoryId,
      in_stock: true,
      specs: {},
    };
  }

  extractPrice(text) {
    const matches = [
      text.match(/U\$\s*([\d.,]+)/i),
      text.match(/USD\s*([\d.,]+)/i),
      text.match(/\$\s*([\d.,]+)/),
    ];
    for (const m of matches) {
      if (m) return parseFloat(m[1].replace('.', '').replace(',', '.'));
    }
    return null;
  }

  resolveUrl(href) {
    if (!href) return null;
    if (href.startsWith('http')) return href;
    if (href.startsWith('/')) return this.config.baseUrl + href;
    return this.config.baseUrl + '/' + href;
  }

  buildPageUrl(baseUrl, pageNum) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}page=${pageNum}`;
  }

  async randomDelay() {
    const ms = this.config.delayMin + Math.random() * (this.config.delayMax - this.config.delayMin);
    return this.delay(ms);
  }
}

module.exports = GenericStoreScraper;
