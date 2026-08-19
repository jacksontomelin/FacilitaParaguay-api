const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class NewZoneScraper extends BaseScraper {
  constructor() {
    super('newzone');
    this.baseUrl = 'https://newzone.com.br';
    // Categorias conhecidas do site (e-commerce lançado 18/08/2026)
    this.categories = [
      { name: 'Perfumaria', slug: 'perfumaria', path: '/perfumaria' },
      { name: 'Eletrônicos', slug: 'eletronicos', path: '/eletronicos' },
      { name: 'Moda', slug: 'moda', path: '/moda' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/cosmeticos' },
      { name: 'Maquiagem', slug: 'maquiagem', path: '/maquiagem' },
      { name: 'Skincare', slug: 'skincare', path: '/skincare' },
      { name: 'Cama Mesa Banho', slug: 'cama-mesa-banho', path: '/cama-mesa-banho' },
      { name: 'Beleza', slug: 'beleza', path: '/beleza' },
      { name: 'Saúde', slug: 'saude', path: '/saude' },
      { name: 'Casa', slug: 'casa', path: '/casa' },
      { name: 'Eletrodomésticos', slug: 'eletrodomesticos', path: '/eletrodomesticos' },
      { name: 'Informática', slug: 'informatica', path: '/informatica' },
      { name: 'Computadores', slug: 'computadores', path: '/computadores' },
    ];
    // Itens por página (máx suportado pelo site)
    this.itemsPerPage = 60;
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // Aceitar cookies pra evitar bloqueio
      console.log(`[${this.storeSlug}] Acessando ${this.baseUrl}...`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this.delay(3000);

      // Tentar aceitar cookies
      try {
        await page.click('button:has-text("Aceitar"), .accept-cookies, [data-accept-cookies]', { timeout: 3000 });
        await this.delay(1000);
      } catch (_) {}

      // Descobrir categorias dinamicamente do menu
      const discoveredCats = await this.discoverCategories(page);
      const allCategories = this.mergeCategories(discoveredCats);
      console.log(`[${this.storeSlug}] ${allCategories.length} categorias para processar`);

      // Iterar por cada categoria
      for (const cat of allCategories) {
        try {
          const categoryId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCategory(page, cat, categoryId);
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

  async discoverCategories(page) {
    try {
      const cats = await page.evaluate((baseUrl) => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const categories = [];
        const seen = new Set();
        const ignore = ['login', 'cadastro', 'carrinho', 'checkout', 'pagina/', 'fale-conosco',
          'politica', 'quem-somos', 'trocas', 'envios', 'dashboard', 'marketplace'];

        for (const a of links) {
          const href = a.href;
          const text = a.textContent.trim();
          if (!href || !text || text.length < 2) continue;
          if (!href.startsWith(baseUrl)) continue;

          const path = href.replace(baseUrl, '');
          if (ignore.some(i => path.includes(i))) continue;
          // Produto: termina com -pNNN
          if (path.match(/-p\d+$/)) continue;
          // Categoria: path simples /SLUG ou /SLUG/SUBSLUG
          const parts = path.split('/').filter(Boolean);
          if (parts.length < 1 || parts.length > 2) continue;

          const slug = parts.join('-');
          if (seen.has(slug)) continue;
          seen.add(slug);

          categories.push({ name: text.substring(0, 100), slug, path });
        }
        return categories;
      }, this.baseUrl);

      return cats;
    } catch (err) {
      console.error(`[${this.storeSlug}] Erro ao descobrir categorias: ${err.message}`);
      return [];
    }
  }

  mergeCategories(discovered) {
    const merged = new Map();

    // Adicionar categorias fixas primeiro
    for (const cat of this.categories) {
      merged.set(cat.slug, cat);
    }

    // Adicionar descobertas
    for (const cat of discovered) {
      if (!merged.has(cat.slug)) {
        merged.set(cat.slug, cat);
      }
    }

    return Array.from(merged.values());
  }

  async scrapeCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;

    while (hasMore && currentPage <= 30) {
      try {
        // Paginação New Zone: ?qtdPag=60&pag=N&ordem=score&categorias=SLUG
        const params = new URLSearchParams({
          qtdPag: this.itemsPerPage.toString(),
          pag: currentPage.toString(),
          ordem: 'score',
          categorias: cat.slug,
        });
        const pageUrl = `${this.baseUrl}${cat.path}?${params}`;

        await page.goto(pageUrl, { waitUntil: 'networkidle' });
        await this.delay(2500);

        // Esperar produtos carregarem (JS-heavy)
        try {
          await page.waitForSelector('[class*="product"], [class*="card"], a[href*="-p"]', { timeout: 8000 });
        } catch (_) {}

        const html = await page.content();
        const products = this.parseProducts(html, categoryId);

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`[${this.storeSlug}] ${cat.slug} p${currentPage}: ${products.length} produtos`);

        for (const p of products) {
          await this.upsertProduct(p);
        }

        hasMore = products.length >= this.itemsPerPage * 0.8; // se veio menos de 80% da página, provavelmente é a última
        currentPage++;
      } catch (err) {
        console.error(`[${this.storeSlug}] Erro ${cat.slug} p${currentPage}: ${err.message}`);
        this.stats.errors++;
        hasMore = false;
      }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();

    // Padrão New Zone: produto com link tipo /SLUG-pID
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // Detectar link de produto: termina com -pNNN
      const productMatch = href.match(/\/([^\/]+-p(\d+))$/);
      if (!productMatch) return;

      const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);

      const slug = productMatch[1];
      const externalId = productMatch[2];

      // Extrair dados do card pai
      const $card = $(el).closest('[class*="product"], [class*="card"], [class*="item"], div, li');
      const $context = $card.length ? $card : $(el);

      // Nome
      let name = '';
      if ($card.length) {
        name = $card.find('[class*="name"], [class*="title"], h2, h3, h4').first().text().trim();
      }
      if (!name) {
        name = $(el).find('img').attr('alt') || '';
      }
      if (!name) {
        // Extrair do slug: remove -pID e troca - por espaço
        name = slug.replace(/-p\d+$/, '').replace(/-/g, ' ');
      }
      if (!name || name.length < 3) return;

      // Preço (USD)
      const priceText = $context.text();
      let priceUsd = this.parsePrice(priceText);

      // Imagem
      let imageUrl = $context.find('img').first().attr('src')
        || $context.find('img').first().attr('data-src')
        || $(el).find('img').attr('src')
        || '';
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = this.baseUrl + imageUrl;
      }

      // Marca
      const brand = this.extractBrand(name);

      products.push({
        name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
        slug,
        external_id: externalId,
        price_usd: priceUsd,
        price_original: null,
        discount_percent: null,
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

  parsePrice(text) {
    if (!text) return null;
    // New Zone usa "US$ 15,00" ou "U$ 15,00"
    const patterns = [
      /US\$\s*([\d.,]+)/i,
      /U\$\s*([\d.,]+)/i,
      /\$\s*([\d.,]+)/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        let val = m[1];
        if (val.includes('.') && val.includes(',')) {
          val = val.replace(/\./g, '').replace(',', '.');
        } else if (val.includes(',')) {
          val = val.replace(',', '.');
        }
        const num = parseFloat(val);
        if (!isNaN(num) && num > 0 && num < 100000) return num;
      }
    }
    return null;
  }

  extractBrand(name) {
    const brands = [
      'CAROLINA HERRERA', 'PACO RABANNE', 'CALVIN KLEIN', 'HUGO BOSS',
      'CHANEL', 'DIOR', 'RALPH LAUREN', 'VERSACE', 'DOLCE & GABBANA',
      'GUCCI', 'PRADA', 'ARMANI', 'BURBERRY', 'GIVENCHY', 'YSL',
      'LANCOME', 'SHISEIDO', 'CLINIQUE', 'ESTEE LAUDER', 'MAC',
      'VICTORIA\'S SECRET', 'BATH & BODY WORKS', 'SOL DE JANEIRO',
      'MONTBLANC', 'BVLGARI', 'CARTIER', 'HERMES', 'TOM FORD',
      'JEAN PAUL GAULTIER', 'ISSEY MIYAKE', 'NARCISO RODRIGUEZ',
      'COACH', 'MICHAEL KORS', 'TOMMY HILFIGER', 'LACOSTE',
      'APPLE', 'SAMSUNG', 'XIAOMI', 'JBL', 'SONY', 'BOSE',
      'NIKE', 'ADIDAS', 'PUMA', 'NEW BALANCE',
      'DYSON', 'PHILIPS', 'BRAUN',
    ];

    const upperName = name.toUpperCase();
    for (const brand of brands) {
      if (upperName.includes(brand)) return brand;
    }

    const first = name.split(' ')[0];
    if (first.length >= 2 && first === first.toUpperCase() && /^[A-Z]/.test(first)) {
      return first;
    }
    return null;
  }
}

module.exports = NewZoneScraper;
