const BaseScraper = require('./BaseScraper');

/**
 * Scraper para lojas que disponibilizam lista de preços em TXT/HTML simples.
 * Muitas lojas do Paraguai publicam listas em formato texto plano.
 * Formato típico: CODIGO | NOME DO PRODUTO | PREÇO USD
 */
class TxtListScraper extends BaseScraper {
  constructor(storeSlug, config = {}) {
    super(storeSlug);
    this.config = {
      baseUrl: config.baseUrl || '',
      listUrl: config.listUrl || null,
      siteUrl: config.siteUrl || config.baseUrl,
      // Separadores comuns: tab, pipe, semicolon
      separator: config.separator || /\t|\|/,
      // Índices das colunas (varia por loja)
      codeIndex: config.codeIndex ?? 0,
      nameIndex: config.nameIndex ?? 1,
      priceIndex: config.priceIndex ?? 2,
      // Também scrape HTML se disponível
      htmlCategories: config.htmlCategories || [],
    };
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // 1. Se tem lista TXT, parsear
      if (this.config.listUrl) {
        console.log(`[${this.storeSlug}] Baixando lista de preços: ${this.config.listUrl}`);
        try {
          await page.goto(this.config.listUrl, { waitUntil: 'domcontentloaded' });
          await this.delay(2000);

          const content = await page.evaluate(() => document.body.innerText);
          const catId = await this.upsertCategory('Lista de Preços', 'lista-precos', null, this.config.listUrl);
          const products = this.parseTxtList(content, catId);

          console.log(`[${this.storeSlug}] ${products.length} produtos na lista TXT`);
          for (const p of products) {
            await this.upsertProduct(p);
          }
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro na lista TXT: ${err.message}`);
          this.stats.errors++;
        }
      }

      // 2. Scrape categorias HTML se configuradas
      for (const cat of this.config.htmlCategories) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.slug, null, this.config.baseUrl + cat.path);
          await this.scrapeHtmlCategory(page, cat, catId);
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

  parseTxtList(content, categoryId) {
    const lines = content.split('\n');
    const products = [];
    const seen = new Set();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 10) continue;

      const parts = trimmed.split(this.config.separator).map(s => s.trim());
      if (parts.length < 2) continue;

      const code = parts[this.config.codeIndex] || '';
      const name = parts[this.config.nameIndex] || '';
      let priceStr = parts[this.config.priceIndex] || '';

      if (!name || name.length < 5) continue;
      // Ignorar headers
      if (/^(codigo|nome|produto|price|preco|descrip)/i.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      // Parsear preço
      let priceUsd = null;
      const priceMatch = priceStr.match(/([\d.,]+)/);
      if (priceMatch) {
        let val = priceMatch[1];
        if (val.includes('.') && val.includes(',')) {
          if (val.indexOf(',') < val.indexOf('.')) {
            val = val.replace(/,/g, '');
          } else {
            val = val.replace(/\./g, '').replace(',', '.');
          }
        } else if (val.includes(',')) {
          val = val.replace(',', '.');
        }
        priceUsd = parseFloat(val);
        if (isNaN(priceUsd) || priceUsd <= 0) priceUsd = null;
      }

      const slug = code || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 100);

      products.push({
        name: name.substring(0, 500),
        slug,
        external_id: code || slug,
        price_usd: priceUsd,
        price_original: null,
        discount_percent: null,
        currency: 'USD',
        brand: this.extractBrand(name),
        image_url: '',
        product_url: `${this.config.siteUrl}/${slug}`,
        category_id: categoryId,
        in_stock: true,
        specs: {},
      });
    }

    return products;
  }

  async scrapeHtmlCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;

    while (hasMore && currentPage <= 20) {
      try {
        const sep = cat.path.includes('?') ? '&' : '?';
        const url = `${this.config.baseUrl}${cat.path}${currentPage > 1 ? sep + 'page=' + currentPage : ''}`;

        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.delay(2500);

        const products = await page.evaluate((baseUrl) => {
          const items = [];
          const seen = new Set();

          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.href;
            const img = a.querySelector('img');
            const name = img?.alt || a.textContent?.trim().split('\n')[0] || '';
            if (!name || name.length < 5 || seen.has(href)) return;
            if (href.includes('/category/') || href.includes('/brand/') || href.includes('javascript')) return;

            const parent = a.closest('div, li, article') || a.parentElement;
            const text = parent?.textContent || '';
            const priceMatch = text.match(/U?S?\$\s*([\d.,]+)/i);
            if (!priceMatch && !img) return;

            seen.add(href);
            items.push({
              name: name.substring(0, 500),
              url: href,
              image: img?.src || '',
              price: priceMatch ? priceMatch[1] : null,
            });
          });

          return items;
        }, this.config.baseUrl);

        if (products.length === 0) { hasMore = false; break; }

        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);

        for (const p of products) {
          let priceUsd = null;
          if (p.price) {
            let val = p.price;
            if (val.includes(',') && val.includes('.')) val = val.replace(/,/g, '');
            else if (val.includes(',')) val = val.replace(',', '.');
            priceUsd = parseFloat(val) || null;
          }

          await this.upsertProduct({
            name: p.name,
            slug: p.url.split('/').pop() || '',
            external_id: p.url.split('/').pop() || '',
            price_usd: priceUsd,
            price_original: null,
            discount_percent: null,
            currency: 'USD',
            brand: this.extractBrand(p.name),
            image_url: p.image,
            product_url: p.url,
            category_id: categoryId,
            in_stock: true,
            specs: {},
          });
        }

        hasMore = products.length >= 12;
        currentPage++;
      } catch (err) {
        this.stats.errors++;
        hasMore = false;
      }
    }
  }

  extractBrand(name) {
    const brands = [
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'REALME', 'NOKIA', 'HUAWEI',
      'JBL', 'SONY', 'BOSE', 'LG', 'CANON', 'NIKON', 'GOPRO', 'DJI',
      'GARMIN', 'ASUS', 'MSI', 'ACER', 'LENOVO', 'DELL', 'HP',
      'INTEL', 'AMD', 'NVIDIA', 'CORSAIR', 'LOGITECH', 'RAZER',
      'PLAYSTATION', 'NINTENDO', 'XBOX',
      'NIKE', 'ADIDAS', 'PUMA', 'TOMMY HILFIGER', 'CALVIN KLEIN',
      'CAROLINA HERRERA', 'PACO RABANNE', 'HUGO BOSS', 'CHANEL', 'DIOR',
      'SANDISK', 'KINGSTON', 'TP-LINK', 'EPSON', 'BROTHER',
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

module.exports = TxtListScraper;
