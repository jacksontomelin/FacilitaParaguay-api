const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class NisseiScraper extends BaseScraper {
  constructor() {
    super('nissei');
    this.baseUrl = 'https://nissei.com';
    this.lang = '/br';

    // Categorias principais extraídas da estrutura real do site (Magento)
    this.mainCategories = [
      { name: 'Informatica', path: '/br/informatica' },
      { name: 'Eletrônica', path: '/br/eletronica' },
      { name: 'Casa & Cozinha', path: '/br/casa' },
      { name: 'Fotografia e Filmagem', path: '/br/fotografia-e-filmagem' },
      { name: 'Beleza e Saude', path: '/br/beleza-e-saude' },
      { name: 'Hogar, Jardín y Exteriores', path: '/br/hogar-jardin' },
      { name: 'Ferretería y Construcción', path: '/br/ferreteria-construccion' },
      { name: 'Acessórios para Carros', path: '/br/carro-pneus-accesorios' },
      { name: 'Moda', path: '/br/ropas-calzados-accesorios' },
      { name: 'Moveis', path: '/br/muebles' },
      { name: 'Bebês e crianças', path: '/br/bebes-y-ni-os-peque-os' },
      { name: 'Juguetes', path: '/br/juguetes' },
    ];

    // Subcategorias chave pra focar (eletrônicos, foto, etc)
    this.priorityPaths = [
      '/br/informatica/notebooks',
      '/br/informatica/accesorios-y-componentes/componentes',
      '/br/informatica/accesorios-y-componentes/monitores',
      '/br/informatica/redes-e-internet',
      '/br/eletronica/celulares-tabletas',
      '/br/eletronica/tabletas',
      '/br/eletronica/relogios-smartwatch',
      '/br/audio',
      '/br/eletronica/entretenimiento-imagen-y-gaming',
      '/br/eletronica/smart-home',
      '/br/gps-y-navegacion',
      '/br/camaras-y-filmadoras/camaras',
      '/br/fotografia-e-filmagem/drones-y-estabilizacion',
      '/br/fotografia-e-filmagem/lentes',
      '/br/casa/climatizacion',
      '/br/casa/refrigeracion',
      '/br/casa/peque-os-electrodomesticos',
      '/br/casa/cocinas-hornos',
    ];
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // 1. Scrape categorias prioritárias (eletrônicos, tech)
      console.log(`[${this.storeSlug}] Scraping ${this.priorityPaths.length} categorias prioritárias...`);

      for (const catPath of this.priorityPaths) {
        try {
          const catSlug = catPath.replace('/br/', '').replace(/\//g, '-');
          const catName = catPath.split('/').pop().replace(/-/g, ' ');
          const catId = await this.upsertCategory(catName, catSlug, null, this.baseUrl + catPath);

          await this.scrapeListingPage(page, this.baseUrl + catPath, catId);
          await this.delay(2000 + Math.random() * 2000);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro em ${catPath}: ${err.message}`);
          this.stats.errors++;
        }
      }

      // 2. Busca por termos populares pra pegar o que faltou
      const searchTerms = [
        'iphone', 'samsung galaxy', 'macbook', 'airpods', 'ipad',
        'playstation', 'nintendo switch', 'xbox', 'gopro', 'dji',
        'garmin', 'jbl', 'sony', 'canon', 'nikon',
        'perfume', 'notebook gamer', 'air fryer', 'drone',
      ];

      console.log(`[${this.storeSlug}] Buscando por ${searchTerms.length} termos...`);
      for (const term of searchTerms) {
        try {
          const searchUrl = `${this.baseUrl}/br/catalogsearch/result/index/?q=${encodeURIComponent(term)}`;
          const catSlug = `busca-${term.toLowerCase().replace(/\s+/g, '-')}`;
          const catId = await this.upsertCategory(`Busca: ${term}`, catSlug, null, searchUrl);

          await this.scrapeListingPage(page, searchUrl, catId);
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

  async scrapeListingPage(page, url, categoryId) {
    let currentPage = 1;
    let hasMore = true;

    while (hasMore && currentPage <= 20) {
      try {
        // Magento usa ?p=N pra paginação
        const pageUrl = currentPage > 1 ? `${url}${url.includes('?') ? '&' : '?'}p=${currentPage}` : url;
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await this.delay(2500);

        const html = await page.content();
        const products = this.parseProducts(html, categoryId);

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        const shortUrl = url.replace(this.baseUrl, '');
        console.log(`[${this.storeSlug}] ${shortUrl} p${currentPage}: ${products.length} produtos`);

        for (const p of products) {
          await this.upsertProduct(p);
        }

        // Magento: checar paginação
        const $ = cheerio.load(html);
        const hasNextBtn = $('a.action.next, .pages-item-next a, a[title="Próximo"], a[title="Next"]').length > 0;
        hasMore = hasNextBtn && products.length >= 12;
        currentPage++;
      } catch (err) {
        console.error(`[${this.storeSlug}] Erro p${currentPage} ${url}: ${err.message}`);
        this.stats.errors++;
        hasMore = false;
      }
    }
  }

  parseProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();

    // Seletores Magento padrão
    const productSelectors = [
      '.product-item',
      '.product-item-info',
      '.item.product.product-item',
      'li.product-item',
      'ol.products li',
    ];

    let $items = $();
    for (const sel of productSelectors) {
      $items = $(sel);
      if ($items.length > 0) break;
    }

    // Fallback: qualquer link de produto
    if ($items.length === 0) {
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        // Nissei usa URLs limpas tipo /br/PRODUTO-SLUG.html ou /br/categoria/produto
        if (!href.includes('.html') && !href.match(/\/[a-z0-9-]+-\d+$/)) return;
        if (href.includes('/checkout') || href.includes('/customer') || href.includes('/catalogsearch')) return;

        const product = this.extractProductFromLink($, $(el), categoryId);
        if (product && !seen.has(product.product_url)) {
          seen.add(product.product_url);
          products.push(product);
        }
      });
      return products;
    }

    $items.each((_, el) => {
      try {
        const $item = $(el);
        const product = this.extractProductFromCard($, $item, categoryId);
        if (product && !seen.has(product.product_url)) {
          seen.add(product.product_url);
          products.push(product);
        }
      } catch (err) {
        this.stats.errors++;
      }
    });

    return products;
  }

  extractProductFromCard($, $card, categoryId) {
    // Link do produto
    const $link = $card.find('a.product-item-link, a.product-item-photo, .product-item-name a, a[href]').first();
    const href = $link.attr('href');
    if (!href) return null;

    const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
    if (!fullUrl.includes(this.baseUrl) && !fullUrl.includes('nissei.com')) return null;

    // Nome
    let name = $card.find('.product-item-name a, .product-item-link, .product.name a').first().text().trim();
    if (!name) name = $card.find('img').attr('alt') || '';
    if (!name || name.length < 3) return null;

    // Preço - Magento tem .price-final_price, .price, .special-price etc
    let priceUsd = null;
    let priceOriginal = null;
    let discountPercent = null;

    // Preço especial (com desconto)
    const specialPrice = $card.find('.special-price .price, .price-final_price .price, [data-price-type="finalPrice"] .price').first().text();
    const oldPrice = $card.find('.old-price .price, [data-price-type="oldPrice"] .price').first().text();

    if (specialPrice) {
      priceUsd = this.parsePrice(specialPrice);
    }
    if (oldPrice) {
      priceOriginal = this.parsePrice(oldPrice);
    }

    // Se não achou preço especial, pegar o preço normal
    if (!priceUsd) {
      const normalPrice = $card.find('.price, .price-wrapper .price').first().text();
      priceUsd = this.parsePrice(normalPrice);
    }

    // Calcular desconto
    if (priceOriginal && priceUsd && priceOriginal > priceUsd) {
      discountPercent = Math.round((1 - priceUsd / priceOriginal) * 100);
    }

    // Imagem
    let imageUrl = $card.find('img.product-image-photo, .product-image-wrapper img, img').first().attr('src')
      || $card.find('img').first().attr('data-src')
      || $card.find('img').first().attr('data-original')
      || '';

    // Slug
    const slug = fullUrl.split('/').pop().replace('.html', '');

    // Marca
    const brand = this.extractBrand(name);

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug,
      external_id: slug,
      price_usd: priceUsd,
      price_original: priceOriginal,
      discount_percent: discountPercent,
      currency: 'USD',
      brand,
      image_url: imageUrl,
      product_url: fullUrl,
      category_id: categoryId,
      in_stock: !$card.find('.out-of-stock, .unavailable').length,
      specs: {},
    };
  }

  extractProductFromLink($, $el, categoryId) {
    const href = $el.attr('href');
    if (!href) return null;

    const fullUrl = href.startsWith('/') ? this.baseUrl + href : href;
    const name = $el.find('img').attr('alt') || $el.text().trim().split('\n')[0] || '';
    if (!name || name.length < 3) return null;

    const priceText = $el.closest('.product-item, .product').text() || $el.parent().text();
    const priceUsd = this.parsePrice(priceText);

    let imageUrl = $el.find('img').attr('src') || '';

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug: fullUrl.split('/').pop().replace('.html', ''),
      external_id: fullUrl.split('/').pop().replace('.html', ''),
      price_usd: priceUsd,
      price_original: null,
      discount_percent: null,
      currency: 'USD',
      brand: this.extractBrand(name),
      image_url: imageUrl,
      product_url: fullUrl,
      category_id: categoryId,
      in_stock: true,
      specs: {},
    };
  }

  parsePrice(text) {
    if (!text) return null;
    // Nissei usa USD - formatos: "U$S 460,00", "US$ 1.299,00", "$ 460", "460,00"
    const patterns = [
      /U\$S?\s*([\d.,]+)/i,
      /US\$\s*([\d.,]+)/i,
      /\$\s*([\d.,]+)/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Formato BR: 1.299,00 -> 1299.00
        let val = match[1];
        // Se tem ponto E vírgula, ponto é milhar
        if (val.includes('.') && val.includes(',')) {
          val = val.replace(/\./g, '').replace(',', '.');
        } else if (val.includes(',')) {
          val = val.replace(',', '.');
        }
        const num = parseFloat(val);
        if (!isNaN(num) && num > 0) return num;
      }
    }
    return null;
  }

  extractBrand(name) {
    const brands = [
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'HUAWEI', 'OPPO', 'REALME',
      'JBL', 'SONY', 'BOSE', 'HARMAN KARDON', 'MARSHALL',
      'CANON', 'NIKON', 'FUJIFILM', 'GOPRO', 'DJI', 'INSTA360',
      'GARMIN', 'FITBIT', 'AMAZFIT',
      'ASUS', 'MSI', 'ACER', 'LENOVO', 'DELL', 'HP',
      'INTEL', 'AMD', 'NVIDIA', 'CORSAIR', 'LOGITECH', 'RAZER',
      'LG', 'PHILIPS', 'DYSON', 'KITCHENAID', 'CUISINART',
      'PLAYSTATION', 'NINTENDO', 'XBOX',
      'NIKE', 'ADIDAS', 'PUMA', 'LACOSTE', 'TOMMY',
      'DEWALT', 'MAKITA', 'BOSCH', 'STANLEY',
      'CAROLINA HERRERA', 'PACO RABANNE', 'CALVIN KLEIN',
      'HUGO BOSS', 'CHANEL', 'DIOR', 'RALPH LAUREN',
      'CASE LOGIC', 'THULE', 'WESTERN DIGITAL', 'SANDISK',
      'WHIRLPOOL', 'ELECTROLUX', 'BRASTEMP',
    ];

    const upperName = name.toUpperCase();
    const sorted = [...brands].sort((a, b) => b.length - a.length);
    for (const brand of sorted) {
      const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('(^|[\\s/\\-.(_])' + escaped + '([\\s/\\-.).,_]|$)', 'i');
      if (regex.test(upperName)) return brand;
    }

    // Primeira palavra uppercase como possível marca
    const first = name.split(' ')[0];
    if (first.length >= 2 && first === first.toUpperCase() && /^[A-Z]/.test(first)) {
      return first;
    }
    return null;
  }
}

module.exports = NisseiScraper;
