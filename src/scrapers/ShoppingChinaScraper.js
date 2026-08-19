const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class ShoppingChinaScraper extends BaseScraper {
  constructor() {
    super('shopping-china');
    this.baseUrl = 'https://www.shoppingchina.com.br';
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // 1. Extrair categorias da home
      console.log(`[${this.storeSlug}] Extraindo categorias...`);
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await this.delay(2000);

      const html = await page.content();
      const categories = this.parseCategories(html);
      console.log(`[${this.storeSlug}] ${categories.length} categorias encontradas`);

      // 2. Iterar por cada categoria/subcategoria
      for (const cat of categories) {
        try {
          const categoryId = await this.upsertCategory(cat.name, cat.slug, null, cat.url);

          for (const sub of cat.subcategories) {
            try {
              const subId = await this.upsertCategory(sub.name, sub.slug, categoryId, sub.url);
              await this.scrapeCategory(page, sub.url, subId);
              await this.delay(1500 + Math.random() * 1000);
            } catch (err) {
              console.error(`[${this.storeSlug}] Erro subcategoria ${sub.name}: ${err.message}`);
              this.stats.errors++;
            }
          }
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro categoria ${cat.name}: ${err.message}`);
          this.stats.errors++;
        }
      }
    } finally {
      await page.close();
    }
  }

  parseCategories(html) {
    const $ = cheerio.load(html);
    const categories = [];

    // O site tem categorias no menu lateral com links tipo /categoria/subcategoria
    $('ul li a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const name = $(el).text().trim();

      if (!href || !name || href === '#') return;
      if (!href.startsWith(this.baseUrl + '/') && !href.startsWith('/')) return;

      const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
      const path = fullUrl.replace(this.baseUrl, '');

      // Ignorar links não-categoria
      const ignorePaths = ['/institucional', '/sc-blogs', '/baixar-app', '/faq', '/garantia',
        '/privacidade', '/termos-de-uso', '/sitemap', '/filiais', '/produto/', '/marcas/',
        '/site/search', '/promos/', '/oportunidades', '/novidades'];
      if (ignorePaths.some(p => path.startsWith(p))) return;

      const parts = path.split('/').filter(Boolean);
      if (parts.length === 1) {
        // Categoria principal
        let existing = categories.find(c => c.slug === parts[0]);
        if (!existing) {
          categories.push({
            name,
            slug: parts[0],
            url: fullUrl,
            subcategories: [],
          });
        }
      } else if (parts.length === 2) {
        // Subcategoria
        let parent = categories.find(c => c.slug === parts[0]);
        if (!parent) {
          parent = { name: parts[0], slug: parts[0], url: `${this.baseUrl}/${parts[0]}`, subcategories: [] };
          categories.push(parent);
        }
        if (!parent.subcategories.find(s => s.slug === parts[1])) {
          parent.subcategories.push({
            name,
            slug: parts[1],
            url: fullUrl,
          });
        }
      }
    });

    return categories.filter(c => c.subcategories.length > 0);
  }

  async scrapeCategory(page, url, categoryId) {
    let currentUrl = url;
    let pageNum = 1;
    let hasMore = true;

    while (hasMore && pageNum <= 50) {
      try {
        const navUrl = pageNum > 1 ? `${currentUrl}?page=${pageNum}` : currentUrl;
        await page.goto(navUrl, { waitUntil: 'domcontentloaded' });
        await this.delay(1500);

        const html = await page.content();
        const products = this.parseProducts(html, categoryId);

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`[${this.storeSlug}] Página ${pageNum}: ${products.length} produtos`);

        for (const product of products) {
          await this.upsertProduct(product);
        }

        // Checar se tem próxima página
        const $ = cheerio.load(html);
        const hasNextPage = $('a[rel="next"], .pagination .next, a:contains("Siguiente"), a:contains("Próximo")').length > 0;
        hasMore = hasNextPage && products.length >= 12;
        pageNum++;

      } catch (err) {
        console.error(`[${this.storeSlug}] Erro página ${pageNum} de ${url}: ${err.message}`);
        this.stats.errors++;
        hasMore = false;
      }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];

    // Seletor de produtos - baseado na estrutura observada
    // Shopping China usa links tipo /produto/SLUG-ID
    $('a[href*="/produto/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (!href) return;

      const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;

      // Extrair nome do produto
      let name = '';
      // O nome geralmente está em vários formatos
      const $parent = $el.closest('.product-card, .card, [class*="product"]');
      if ($parent.length) {
        name = $parent.find('.product-name, .card-title, h3, h4, .title').first().text().trim();
      }
      if (!name) {
        // Tentar pegar o texto dentro do link, excluindo preço
        const texts = [];
        $el.contents().each((_, node) => {
          if (node.type === 'text') {
            const t = $(node).text().trim();
            if (t && !t.match(/^[U$\d.,\s%]+$/)) texts.push(t);
          }
        });
        name = texts.join(' ').trim();
      }
      if (!name) {
        // Fallback: extrair do alt da imagem
        name = $el.find('img').attr('alt') || '';
      }
      if (!name || name.length < 3) return;

      // Evitar duplicatas
      if (products.find(p => p.product_url === fullUrl)) return;

      // Extrair preço
      const priceText = $el.text();
      let priceUsd = null;
      let priceOriginal = null;
      let discountPercent = null;

      // Preço em USD (U$ ou $)
      const usdMatch = priceText.match(/U\$\s*([\d.,]+)/i) || priceText.match(/\$\s*([\d.,]+)/);
      if (usdMatch) {
        priceUsd = parseFloat(usdMatch[1].replace('.', '').replace(',', '.'));
      }

      // Preço original (riscado)
      const origMatch = priceText.match(/\$\s*([\d.,]+).*?U\$\s*([\d.,]+)/);
      if (origMatch) {
        priceOriginal = parseFloat(origMatch[1].replace('.', '').replace(',', '.'));
        priceUsd = parseFloat(origMatch[2].replace('.', '').replace(',', '.'));
      }

      // Desconto
      const discMatch = priceText.match(/-(\d+)\s*%/);
      if (discMatch) {
        discountPercent = parseInt(discMatch[1]);
      }

      // Imagem
      let imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = this.baseUrl + imageUrl;
      }

      // Slug e ID externo
      const slugMatch = fullUrl.match(/\/produto\/(.+)$/);
      const slug = slugMatch ? slugMatch[1] : '';
      const idMatch = slug.match(/-(\d+)$/);
      const externalId = idMatch ? idMatch[1] : slug;

      // Marca (tentativa)
      const brand = this.extractBrand(name);

      // Limpar nome: remover preços, descontos e textos residuais
      let cleanName = name
        .replace(/-?\d+\s*%/g, '')           // remove "-27 %"
        .replace(/U?\$\s*[\d.,]+/g, '')      // remove "U$ 460,00" ou "$ 110,00"
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanName.length < 3) return;

      products.push({
        name: cleanName,
        slug,
        external_id: externalId,
        price_usd: priceUsd,
        price_original: priceOriginal,
        discount_percent: discountPercent,
        currency: 'USD',
        brand,
        image_url: imageUrl,
        product_url: fullUrl,
        category_id: categoryId,
        in_stock: true,
        specs: {},
      });
    });

    return products;
  }

  extractBrand(name) {
    const brands = [
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'JBL', 'SONY', 'LG', 'BOSE',
      'NIKE', 'ADIDAS', 'PUMA', 'GARMIN', 'HUAWEI', 'CANON', 'NIKON', 'GOPRO',
      'KITCHENAID', 'CUISINART', 'DYSON', 'PHILIPS', 'BRAUN', 'SHISEIDO',
      'LANCOME', 'DIOR', 'CHANEL', 'GUCCI', 'PRADA', 'VERSACE', 'DOLCE',
      'RAY-BAN', 'OAKLEY', 'MICHAEL KORS', 'COACH', 'TOMMY HILFIGER',
      'LACOSTE', 'POLO', 'RALPH LAUREN', 'CALVIN KLEIN', 'HUGO BOSS',
      'DEWALT', 'MAKITA', 'BOSCH', 'STANLEY', 'BLACK+DECKER',
      'SHIMANO', 'MARINE', 'SUMAX', 'TRIXIE', 'BUBA', 'CONDOR',
      'LOGITECH', 'RAZER', 'CORSAIR', 'HYPERX', 'ASUS', 'MSI',
      'INTEL', 'AMD', 'NVIDIA', 'DELL', 'HP', 'LENOVO', 'ACER',
      'INSTA360', 'DJI', 'ECOFLOW', 'MEDICUBE', 'BIOTOP',
      'THAMEEN', 'MONTBLANC', 'CARTIER', 'BULGARI', 'HERMES',
      'JOHNNIE WALKER', 'JACK DANIELS', 'MACALLAN', 'HENNESSY',
      'PLAYSTATION', 'NINTENDO', 'XBOX', 'SEGA',
    ];

    const upperName = name.toUpperCase();
    for (const brand of brands) {
      if (upperName.includes(brand)) return brand;
    }

    // Tentar primeira palavra se for sigla/marca conhecida (>= 2 chars uppercase)
    const firstWord = name.split(' ')[0];
    if (firstWord.length >= 2 && firstWord === firstWord.toUpperCase() && /^[A-Z]/.test(firstWord)) {
      return firstWord;
    }

    return null;
  }
}

module.exports = ShoppingChinaScraper;
