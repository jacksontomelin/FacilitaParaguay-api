const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class MegaScraper extends BaseScraper {
  constructor() {
    super('mega-eletronicos');
    this.baseUrl = 'https://megaeletronicos.com';

    // Categorias com IDs extraídos da estrutura real
    this.categories = [
      { name: 'Celulares', slug: 'celular', path: '/producto/categoria/celular/110101' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/producto/categoria/cosmeticos/17' },
      { name: 'Perfumaria', slug: 'perfumaria', path: '/producto/categoria/perfume/18' },
      { name: 'Notebooks', slug: 'notebook', path: '/producto/categoria/notebook/20401' },
      { name: 'Som & Áudio', slug: 'eletronicos', path: '/producto/categoria/eletronicos/106' },
      { name: 'Televisões', slug: 'tv', path: '/producto/categoria/tv/10706' },
      { name: 'Casa & Cozinha', slug: 'casa', path: '/producto/categoria/casa/3' },
      { name: 'Ar Condicionado', slug: 'ar-condicionado', path: '/producto/categoria/ar-condicionado/30204' },
      { name: 'Eletroportáteis', slug: 'eletroportateis', path: '/eletroportateis' },
      { name: 'Skincare', slug: 'skincare', path: '/skincare' },
      { name: 'Games', slug: 'games', path: '/producto/categoria/games/10707' },
      { name: 'Informática', slug: 'informatica', path: '/producto/categoria/informatica/204' },
      { name: 'Automotivo', slug: 'automotivo', path: '/producto/categoria/automotivo/302' },
      { name: 'Bebidas', slug: 'bebidas', path: '/producto/categoria/bebidas/303' },
      { name: 'Esporte & Lazer', slug: 'esporte', path: '/producto/categoria/esporte/304' },
      { name: 'Pet Shop', slug: 'pet-shop', path: '/producto/categoria/pet-shop/305' },
      { name: 'Fotografia & Vídeo', slug: 'fotografia', path: '/producto/categoria/fotografia/205' },
      { name: 'Saúde & Beleza', slug: 'saude-beleza', path: '/producto/categoria/saude-beleza/306' },
      { name: 'Telefonia', slug: 'telefonia', path: '/producto/categoria/telefonia/1101' },
    ];

    // Busca via URL: /producto/buscar/?search=TERM&available=yes&order_by=desc
    this.searchTerms = [
      'iphone 17', 'samsung galaxy', 'xiaomi', 'macbook', 'airpods',
      'playstation', 'nintendo switch', 'garmin', 'jbl', 'gopro', 'dji drone',
      'air fryer', 'aspirador robot', 'smartwatch',
    ];
  }

  async scrape() {
    const page = await this.createPage();

    try {
      console.log(`[${this.storeSlug}] Scraping ${this.categories.length} categorias...`);

      for (const cat of this.categories) {
        try {
          const categoryId = await this.upsertCategory(cat.name, cat.slug, null, this.baseUrl + cat.path);
          await this.scrapeCategory(page, cat, categoryId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro cat ${cat.name}: ${err.message}`);
          this.stats.errors++;
        }
      }

      // Páginas de promoção/destaques
      const promoPages = [
        { name: 'Destaques', slug: 'destaques', path: '/producto/destaques' },
        { name: 'Refurbished', slug: 'refurbished', path: '/refurbished' },
      ];
      console.log(`[${this.storeSlug}] Scraping ${promoPages.length} páginas de promoção...`);
      for (const promo of promoPages) {
        try {
          const catId = await this.upsertCategory(promo.name, promo.slug, null, this.baseUrl + promo.path);
          await this.scrapeCategory(page, promo, catId, true);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) { this.stats.errors++; }
      }

      // Buscas complementares
      console.log(`[${this.storeSlug}] Buscando ${this.searchTerms.length} termos...`);
      for (const term of this.searchTerms) {
        try {
          const searchUrl = `${this.baseUrl}/producto/buscar/?search=${encodeURIComponent(term)}&available=yes&order_by=desc`;
          const catSlug = `busca-${term.toLowerCase().replace(/\s+/g, '-')}`;
          const catId = await this.upsertCategory(`Busca: ${term}`, catSlug, null, searchUrl);
          await this.scrapeCategory(page, { path: `/producto/buscar/?search=${encodeURIComponent(term)}&available=yes&order_by=desc`, slug: catSlug }, catId);
          await this.delay(2000 + Math.random() * 1500);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro busca "${term}": ${err.message}`);
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

    while (hasMore && currentPage <= 50) {
      try {
        const sep = cat.path.includes('?') ? '&' : '?';
        const pageUrl = `${this.baseUrl}${cat.path}${sep}page=${currentPage}`;

        await page.goto(pageUrl, { waitUntil: 'networkidle' });
        await this.delay(2500);

        // Esperar produtos (site Vue.js, renderizado no client)
        try {
          await page.waitForSelector('a[href*="/producto/"]', { timeout: 10000 });
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

        // Checar próxima página
        const $ = cheerio.load(html);
        const nextExists = $('a[rel="next"], .pagination .next, button:contains("Siguiente"), button:contains("Próxim")').length > 0;
        hasMore = nextExists || products.length >= 15;
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

    // Links de produto: /producto/CODE/slug
    $('a[href*="/producto/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // Match: /producto/DIGITS/slug (não /producto/categoria/, /producto/marca/, /producto/buscar/)
      const match = href.match(/\/producto\/(\d{4,})\//);
      if (!match) return;

      const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
      if (seen.has(match[1])) return;
      seen.add(match[1]);

      const externalId = match[1];
      const $context = $(el).closest('div, li, article');
      const $el = $(el);

      // Nome
      let name = '';
      if ($context.length) {
        // Pegar texto mais longo que parece nome de produto
        $context.find('*').each((_, child) => {
          const t = $(child).text().trim();
          if (t.length > name.length && t.length > 10 && t.length < 300
            && !t.match(/^(U\$|R\$|Em estoque|Cód|Adicionar|Comprar|Consultar)/i)) {
            name = t;
          }
        });
      }
      if (!name) name = $el.find('img').attr('alt') || '';
      if (!name) {
        // Fallback: slug do URL
        const slugPart = href.split('/').pop();
        name = slugPart.replace(/-/g, ' ');
      }
      if (!name || name.length < 5) return;

      // Limpar nome
      name = name.replace(/\s+/g, ' ').replace(/Cód\.\s*\d+/g, '').replace(/Em estoque/gi, '').replace(/U\$\s*[\d.,]+/g, '').replace(/R\$\s*[\d.,]+/g, '').trim();
      if (name.length < 5) return;

      // Preço
      const contextText = $context.length ? $context.text() : $el.parent().text();
      const priceUsd = this.parsePrice(contextText);

      // Código
      const codeMatch = contextText.match(/Cód\.\s*(\d+)/);
      const code = codeMatch ? codeMatch[1] : externalId;

      // Imagem principal
      let imageUrl = $context.find('img').first().attr('src')
        || $el.find('img').attr('src')
        || '';

      // Capturar todas as imagens do contexto
      const images = [];
      $context.find('img[src]').each((_, img) => {
        const src = $(img).attr('src');
        if (src && src.includes('resource.megaeletronicos.com') && !images.includes(src)) {
          images.push(src);
        }
      });

      // Em estoque
      const inStock = !contextText.includes('Sin Stock') && !contextText.includes('Consultar prec');

      // Desconto
      let discountPercent = null;
      const discMatch = contextText.match(/-(\d+)%\s*OFF/i);
      if (discMatch) discountPercent = parseInt(discMatch[1]);

      const brand = this.extractBrand(name);
      const slug = href.split('/').filter(Boolean).pop() || externalId;

      products.push({
        name: name.substring(0, 500),
        slug,
        external_id: code,
        price_usd: priceUsd,
        price_original: null,
        discount_percent: discountPercent,
        currency: 'USD',
        brand,
        image_url: imageUrl,
        images,
        product_url: fullUrl,
        category_id: categoryId,
        in_stock: inStock,
        is_promo: discountPercent > 0,
        promo_label: discountPercent ? `-${discountPercent}% OFF` : null,
        specs: {},
      });
    });

    return products;
  }

  parsePrice(text) {
    if (!text) return null;
    // Mega usa "U$ 49.00" (formato US com ponto decimal)
    const match = text.match(/U\$\s*([\d.,]+)/i);
    if (!match) return null;

    let val = match[1];
    // Mega usa formato US: 2,030.00 (vírgula é milhar, ponto é decimal)
    // Mas se tem só vírgula sem ponto: formato BR
    if (val.includes(',') && val.includes('.')) {
      // Checar qual é milhar: se vírgula vem antes do ponto, é formato US
      if (val.indexOf(',') < val.indexOf('.')) {
        val = val.replace(/,/g, ''); // remove vírgula milhar
      } else {
        val = val.replace(/\./g, '').replace(',', '.');
      }
    } else if (val.includes(',') && !val.includes('.')) {
      // Só vírgula: pode ser milhar ou decimal
      // Se tem 3 dígitos depois da vírgula, é milhar
      if (val.match(/,\d{3}$/)) {
        val = val.replace(',', '');
      } else {
        val = val.replace(',', '.');
      }
    }

    const num = parseFloat(val);
    return (!isNaN(num) && num > 0 && num < 100000) ? num : null;
  }

  extractBrand(name) {
    const brands = [
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'REALME', 'INFINIX', 'ITEL',
      'BLACKVIEW', 'FOSSIBOT', 'HOTWAV', 'ULEFONE', 'HONOR', 'HUAWEI', 'OPPO',
      'JBL', 'SONY', 'BOSE', 'AIWA', 'AUDISAT', 'MARSHALL',
      'CANON', 'NIKON', 'FUJIFILM', 'GOPRO', 'DJI', 'INSTA360',
      'GARMIN', 'AMAZFIT', 'CASIO',
      'ASUS', 'MSI', 'ACER', 'LENOVO', 'DELL', 'HP',
      'INTEL', 'AMD', 'NVIDIA', 'CORSAIR', 'LOGITECH', 'RAZER',
      'GREE', 'LG', 'PHILIPS', 'DYSON', 'KITCHENAID',
      'PLAYSTATION', 'NINTENDO', 'XBOX', 'MICROSOFT', 'AMAZON',
      'NIKE', 'ADIDAS', 'PUMA',
      'CAROLINA HERRERA', 'PACO RABANNE', 'CALVIN KLEIN', 'HUGO BOSS',
      'DOLCE&GABBANA', 'DOLCE GABBANA', 'GUCCI', 'VERSACE', 'CHANEL', 'DIOR',
      'ARMANI', 'GIVENCHY', 'JEAN PAUL GAULTIER', 'TOM FORD',
      'LATTAFA', 'ARMAF', 'AL HARAMAIN', 'MAISON',
      'ANTONIO BANDERAS', 'ANIMALE', 'HALLOWEEN',
      'MEDICUBE', 'REJURAN', 'ANUA', 'TIRTIR', 'EUCERIN', 'KARSEELL',
      'SANDISK', 'KINGSTON', 'TP-LINK',
    ];

    const upperName = name.toUpperCase();
    const sorted = [...brands].sort((a, b) => b.length - a.length);
    for (const brand of sorted) {
      const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('(^|[\\s/\\-.(_])' + escaped + '([\\s/\\-.).,_]|$)', 'i');
      if (regex.test(upperName)) return brand;
    }

    const first = name.split(' ')[0];
    if (first.length >= 2 && first === first.toUpperCase() && /^[A-Z]/.test(first)) {
      return first;
    }
    return null;
  }
}

module.exports = MegaScraper;
