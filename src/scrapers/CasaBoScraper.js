const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class CasaBoScraper extends BaseScraper {
  constructor() {
    super('casa-bo');
    this.baseUrl = 'https://www.casabo.com.py';

    // Categorias mapeadas da estrutura real (plataforma custom PHP)
    // URL: /category/SLUG ou /category/SLUG/SUBSLUG
    this.categories = [
      // Celulares
      { name: 'Smartphones iPhone', slug: 'smartphones-iphone', path: '/category/Celulares/SmartPhones/iphone' },
      { name: 'Smartphones Samsung', slug: 'smartphones-samsung', path: '/category/Celulares/SmartPhones/samsung-smartphone' },
      { name: 'Smartphones Xiaomi', slug: 'smartphones-xiaomi', path: '/category/Celulares/SmartPhones/xiaomi' },
      { name: 'Smartphones Motorola', slug: 'smartphones-motorola', path: '/category/Celulares/SmartPhones/motorola' },
      { name: 'Smartphones Realme', slug: 'smartphones-realme', path: '/category/Celulares/SmartPhones/realme' },
      { name: 'Smartphones Sony', slug: 'smartphones-sony', path: '/category/Celulares/SmartPhones/sony' },
      { name: 'Smartphones Nokia', slug: 'smartphones-nokia', path: '/category/Celulares/SmartPhones/nokia' },
      { name: 'Celulares', slug: 'celulares', path: '/category/Celulares' },

      // Games
      { name: 'Games Consoles', slug: 'games-consoles', path: '/category/games/consoles' },
      { name: 'Games Acessórios', slug: 'games-acessorios', path: '/category/games/accesorios-games' },
      { name: 'Games Jogos', slug: 'games-jogos', path: '/category/games/juegos' },

      // Informática
      { name: 'Informatica Componentes', slug: 'informatica-componentes', path: '/category/informatica/componentes' },
      { name: 'Informatica Monitor', slug: 'informatica-monitor', path: '/category/informatica/accesorios-informatica/monitor' },
      { name: 'Informatica Roteadores', slug: 'informatica-roteadores', path: '/category/informatica/roteadores' },
      { name: 'Impressoras', slug: 'impressoras', path: '/category/informatica/impressoras-e-cartuchos' },
      { name: 'Projetores', slug: 'projetores', path: '/category/informatica/projetores' },

      // Relógios
      { name: 'Smartwatch', slug: 'smartwatch', path: '/category/relogios/smartwatch' },
      { name: 'Relógio Masculino', slug: 'relogio-masculino', path: '/category/relogios/relogio-masculino' },
      { name: 'Relógio Feminino', slug: 'relogio-feminino', path: '/category/relogios/relogio-feminino' },

      // Perfumaria e Cosméticos
      { name: 'Perfume Feminino', slug: 'perfume-feminino', path: '/category/perfumeria-cosmeticos/perfumes/perfume-feminino' },
      { name: 'Perfume Masculino', slug: 'perfume-masculino', path: '/category/perfumeria-cosmeticos/perfumes/perfume-masculino' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/category/perfumeria-cosmeticos/cosmeticos' },
      { name: 'Maquiagem', slug: 'maquiagem', path: '/category/perfumeria-cosmeticos/maquiagem' },

      // Outros
      { name: 'Receptor', slug: 'receptor', path: '/category/receptor' },
      { name: 'Utilidades domésticas', slug: 'utilidades-domesticas', path: '/category/utilidades-domesticas' },
      { name: 'Eletroportáteis', slug: 'eletroportateis', path: '/category/eletroportateis' },
      { name: 'Tabacaria', slug: 'tabacaria', path: '/category/tabacaria' },
    ];

    // Marcas principais para scraping complementar
    this.brands = [
      'apple', 'samsung', 'xiaomi', 'motorola', 'sony', 'jbl',
      'garmin', 'asus', 'logitech', 'canon', 'nikon',
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

      // Scrape por marcas
      console.log(`[${this.storeSlug}] Scraping ${this.brands.length} marcas...`);
      for (const brand of this.brands) {
        try {
          const catSlug = `marca-${brand}`;
          const catId = await this.upsertCategory(`Marca: ${brand}`, catSlug, null, `${this.baseUrl}/brand/${brand}`);
          await this.scrapeCategory(page, { path: `/brand/${brand}`, slug: catSlug }, catId);
          await this.delay(2000 + Math.random() * 1500);
        } catch (err) {
          console.error(`[${this.storeSlug}] Erro marca ${brand}: ${err.message}`);
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
    const perPage = 100; // Casa Bo suporta 25, 50, 75, 100

    while (hasMore && currentPage <= 30) {
      try {
        const sep = cat.path.includes('?') ? '&' : '?';
        const pageUrl = `${this.baseUrl}${cat.path}${sep}page=${currentPage}&limit=${perPage}`;

        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await this.delay(2500);

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

        hasMore = products.length >= perPage * 0.8;
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

    // Casa Bo: produtos mostram código numérico, imagem, botão "Comprar"
    // Tentar seletores de card de produto
    const cardSelectors = [
      '.product-card', '.product-item', '.product',
      '[class*="product"]', '.card', '.item',
    ];

    let $cards = $();
    for (const sel of cardSelectors) {
      $cards = $(sel);
      if ($cards.length > 0) break;
    }

    if ($cards.length > 0) {
      $cards.each((_, el) => {
        const product = this.extractFromCard($, $(el), categoryId);
        if (product && !seen.has(product.product_url)) {
          seen.add(product.product_url);
          products.push(product);
        }
      });
    }

    // Fallback: parsear links com imagens de produto
    if (products.length === 0) {
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        // Ignorar links de navegação
        if (href.includes('/category/') || href.includes('/brand/') ||
            href.includes('/index.php') || href.includes('whatsapp') ||
            href.includes('facebook') || href.includes('instagram') ||
            href === '/' || href === '#') return;

        const fullUrl = href.startsWith('/') ? this.baseUrl + href :
                        href.startsWith('http') ? href : this.baseUrl + '/' + href;
        if (!fullUrl.includes('casabo.com.py')) return;
        if (seen.has(fullUrl)) return;

        // Checar se tem imagem (indica produto)
        const $el = $(el);
        const hasImg = $el.find('img').length > 0 || $el.is('img');
        const parentText = $el.parent().text();
        const hasPrice = /\$|USD|U\$/i.test(parentText) || /Comprar|Carrinho/i.test(parentText);

        if (!hasImg && !hasPrice) return;

        const name = $el.find('img').attr('alt') || $el.text().trim().split('\n')[0] || '';
        if (!name || name.length < 3) return;

        seen.add(fullUrl);
        const priceUsd = this.parsePrice(parentText);
        let imageUrl = $el.find('img').attr('src') || '';
        if (imageUrl && !imageUrl.startsWith('http')) imageUrl = this.baseUrl + imageUrl;

        products.push({
          name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
          slug: fullUrl.split('/').pop() || '',
          external_id: fullUrl.split('/').pop() || '',
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
        });
      });
    }

    return products;
  }

  extractFromCard($, $card, categoryId) {
    const $link = $card.find('a[href]').first();
    const href = $link.attr('href');
    if (!href) return null;

    const fullUrl = href.startsWith('/') ? this.baseUrl + href :
                    href.startsWith('http') ? href : this.baseUrl + '/' + href;
    if (!fullUrl.includes('casabo.com.py')) return null;

    let name = $card.find('h3, h4, .product-name, .product-title, .name, .title').first().text().trim();
    if (!name) name = $card.find('img').attr('alt') || '';
    if (!name || name.length < 3) return null;

    const priceUsd = this.parsePrice($card.text());
    let imageUrl = $card.find('img').first().attr('src') || '';
    if (imageUrl && !imageUrl.startsWith('http')) imageUrl = this.baseUrl + imageUrl;

    return {
      name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
      slug: fullUrl.split('/').pop() || '',
      external_id: fullUrl.split('/').pop() || '',
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
    const patterns = [
      /US\$\s*([\d.,]+)/i,
      /U\$\s*([\d.,]+)/i,
      /USD\s*([\d.,]+)/i,
      /\$\s*([\d.,]+)/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        let val = m[1];
        if (val.includes('.') && val.includes(',')) {
          if (val.indexOf(',') < val.indexOf('.')) {
            val = val.replace(/,/g, '');
          } else {
            val = val.replace(/\./g, '').replace(',', '.');
          }
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
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'REALME', 'NOKIA', 'HUAWEI',
      'LG', 'SONY', 'JBL', 'CAT', 'ZTE', 'IPRO', 'MOX', 'SKY',
      'PLAYSTATION', 'NINTENDO', 'XBOX', 'TUCANO',
      'ASUS', 'ACER', 'DELL', 'HP', 'LENOVO', 'MSI',
      'TP-LINK', 'NETIS', 'MULTILASER',
      'LOGITECH', 'CORSAIR', 'RAZER',
      'CANON', 'NIKON', 'GOPRO', 'DJI',
      'GARMIN', 'CASIO', 'JULIUS',
      "VICTORIA'S SECRET", "L'OREAL", 'MAC',
      'CAROLINA HERRERA', 'PACO RABANNE', 'CALVIN KLEIN',
      'HUGO BOSS', 'CHANEL', 'DIOR', 'VERSACE', 'GUCCI',
      'SANDISK', 'KINGSTON',
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

module.exports = CasaBoScraper;
