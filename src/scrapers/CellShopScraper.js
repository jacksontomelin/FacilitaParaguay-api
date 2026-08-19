const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');
const { scrapeTxtList } = require('./TxtBooster');

class CellShopScraper extends BaseScraper {
  constructor() {
    super('cellshop');
    this.baseUrl = 'https://cellshop.com';

    // Categorias mapeadas da estrutura real (Magento, ~49.500 produtos)
    // URL pattern: /todos-os-departamentos/DEPT/CAT/SUBCAT ou shortcut /SLUG
    this.categories = [
      // Tecnologia
      { name: 'Smartphones', slug: 'smartphones', path: '/todos-os-departamentos/tecnologia/celulares-telefonia/smartphones' },
      { name: 'Acessórios para Celulares', slug: 'acessorios-celulares', path: '/todos-os-departamentos/tecnologia/celulares-telefonia/acess-rios-para-celulares' },
      { name: 'Carregador de Parede', slug: 'carregador-parede', path: '/todos-os-departamentos/tecnologia/celulares-telefonia/carregador-de-parede' },
      { name: 'Carregador Portátil', slug: 'carregador-portatil', path: '/todos-os-departamentos/tecnologia/celulares-telefonia/carregador-portatil' },
      { name: 'Notebooks', slug: 'notebooks', path: '/todos-os-departamentos/tecnologia/informatica/notebooks' },
      { name: 'Tablets', slug: 'tablets', path: '/todos-os-departamentos/tecnologia/informatica/tablets' },
      { name: 'Monitores', slug: 'monitores', path: '/todos-os-departamentos/tecnologia/informatica/monitores' },
      { name: 'Componentes PC', slug: 'componentes-pc', path: '/todos-os-departamentos/tecnologia/informatica/componentes' },
      { name: 'Periféricos', slug: 'perifericos', path: '/todos-os-departamentos/tecnologia/informatica/perifericos' },
      { name: 'Redes e Wi-Fi', slug: 'redes-wifi', path: '/todos-os-departamentos/tecnologia/informatica/redes' },
      { name: 'TVs', slug: 'tvs', path: '/todos-os-departamentos/tecnologia/audio-video/televisores' },
      { name: 'Fones de Ouvido', slug: 'fones-ouvido', path: '/todos-os-departamentos/tecnologia/audio-video/fones-de-ouvido' },
      { name: 'Caixas de Som', slug: 'caixas-som', path: '/todos-os-departamentos/tecnologia/audio-video/caixas-de-som' },
      { name: 'Smartwatch', slug: 'smartwatch', path: '/todos-os-departamentos/tecnologia/smartwatch' },
      { name: 'Câmeras', slug: 'cameras', path: '/todos-os-departamentos/tecnologia/cameras' },
      { name: 'Drones', slug: 'drones', path: '/todos-os-departamentos/tecnologia/drones' },
      { name: 'Video Games', slug: 'games', path: '/todos-os-departamentos/tecnologia/games' },

      // Beleza / Perfumaria
      { name: 'Perfumes', slug: 'perfumes', path: '/perfumes' },
      { name: 'Perfume Feminino', slug: 'perfume-feminino', path: '/perfume-feminino' },
      { name: 'Perfume Masculino', slug: 'perfume-masculino', path: '/perfume-masculino' },
      { name: 'Cosméticos', slug: 'cosmeticos', path: '/todos-os-departamentos/beleza/cosmeticos' },
      { name: 'Maquiagem', slug: 'maquiagem', path: '/todos-os-departamentos/beleza/maquiagem' },

      // Bebidas
      { name: 'Bebidas', slug: 'bebidas', path: '/bebidas' },
      { name: 'Vinhos', slug: 'vinhos', path: '/bebidas/vinho' },
      { name: 'Whisky', slug: 'whisky', path: '/bebidas/whisky' },

      // Outros departamentos
      { name: 'Moda Casual', slug: 'moda-casual', path: '/todos-os-departamentos/moda-casual' },
      { name: 'Esportes', slug: 'esportes', path: '/todos-os-departamentos/esportes' },
      { name: 'Suplementos', slug: 'suplementos', path: '/todos-os-departamentos/suplementos' },
      { name: 'Casa e Decoração', slug: 'casa-decoracao', path: '/todos-os-departamentos/casa-e-decoracao' },
      { name: 'Pesca e Aventura', slug: 'pesca-aventura', path: '/todos-os-departamentos/pesca-e-aventura' },
      { name: 'Camping', slug: 'camping', path: '/todos-os-departamentos/camping' },
      { name: 'Brinquedos', slug: 'brinquedos', path: '/todos-os-departamentos/brinquedos' },
    ];
  }

  async scrape() {
    const page = await this.createPage();

    try {
      // 1. Lista TXT (rápido, pega tudo de uma vez)
      await scrapeTxtList(this, page, 'https://www.cellshop.com/labs/lista/arquivo/listagem_precos.txt');

      // 2. Scrape HTML por categorias (complementa com imagens e dados extras)
      console.log(`[${this.storeSlug}] Scraping ${this.categories.length} categorias HTML...`);

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
    } finally {
      await page.close();
    }
  }

  async scrapeCategory(page, cat, categoryId) {
    let currentPage = 1;
    let hasMore = true;
    const itemsPerPage = 36; // CellShop suporta 12, 24 ou 36

    while (hasMore && currentPage <= 50) {
      try {
        // Magento: ?p=N&product_list_limit=36
        const sep = cat.path.includes('?') ? '&' : '?';
        const pageUrl = `${this.baseUrl}${cat.path}${sep}p=${currentPage}&product_list_limit=${itemsPerPage}`;

        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await this.delay(2000);

        // Esperar grid de produtos carregar
        try {
          await page.waitForSelector('.product-item, .products-grid, .product-items', { timeout: 8000 });
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

        // Checar paginação Magento
        const $ = cheerio.load(html);
        const nextPage = $('a.action.next, .pages-item-next a, a[title="Próximo"], a[title="Next"]').length > 0;
        // Também checar pelo texto "Itens X-Y de Z"
        const totalMatch = html.match(/Itens\s+\d+-\d+\s+de\s+([\d.]+)/i);
        const totalItems = totalMatch ? parseInt(totalMatch[1].replace('.', '')) : 0;

        hasMore = nextPage || (totalItems > 0 && currentPage * itemsPerPage < totalItems);
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

    // Seletores Magento
    const $items = $('li.product-item, .product-item, .item.product');

    $items.each((_, el) => {
      try {
        const $item = $(el);

        // Link do produto
        const $link = $item.find('a.product-item-link, a.product-item-photo, .product-item-name a, a[href]').first();
        const href = $link.attr('href');
        if (!href || !href.includes('cellshop.com')) return;

        if (seen.has(href)) return;
        seen.add(href);

        // Nome
        let name = $item.find('.product-item-name a, a.product-item-link, .product.name a').first().text().trim();
        if (!name) name = $item.find('img').attr('alt') || '';
        if (!name || name.length < 3) return;

        // Preço - CellShop usa "US$ 1.299,00"
        let priceUsd = null;
        let priceOriginal = null;
        let discountPercent = null;

        const specialText = $item.find('.special-price .price, [data-price-type="finalPrice"] .price').first().text();
        const oldText = $item.find('.old-price .price, [data-price-type="oldPrice"] .price').first().text();

        if (specialText) {
          priceUsd = this.parsePrice(specialText);
        }
        if (oldText) {
          priceOriginal = this.parsePrice(oldText);
        }
        if (!priceUsd) {
          const normalText = $item.find('.price, .price-wrapper .price').first().text();
          priceUsd = this.parsePrice(normalText);
        }

        // Fallback: pegar do texto geral do card
        if (!priceUsd) {
          priceUsd = this.parsePrice($item.text());
        }

        if (priceOriginal && priceUsd && priceOriginal > priceUsd) {
          discountPercent = Math.round((1 - priceUsd / priceOriginal) * 100);
        }

        // Imagem
        let imageUrl = $item.find('img.product-image-photo').attr('src')
          || $item.find('img').first().attr('src')
          || $item.find('img').first().attr('data-src')
          || '';

        // Slug
        const urlParts = href.split('/');
        const slug = urlParts[urlParts.length - 1].replace('.html', '');

        // Marca
        const brand = this.extractBrand(name);

        products.push({
          name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
          slug,
          external_id: slug,
          price_usd: priceUsd,
          price_original: priceOriginal,
          discount_percent: discountPercent,
          currency: 'USD',
          brand,
          image_url: imageUrl,
          product_url: href,
          category_id: categoryId,
          in_stock: !$item.find('.out-of-stock, .unavailable, .outofstock').length,
          specs: {},
        });
      } catch (err) {
        this.stats.errors++;
      }
    });

    // Fallback: se não achou items Magento, parsear links com preço US$
    if (products.length === 0) {
      const priceRegex = /US\$\s*([\d.,]+)/gi;
      const lines = html.split(/US\$/);
      // Pegar links com texto de preço próximo
      $('a[href*="cellshop.com"]').each((_, el) => {
        const href = $(el).attr('href');
        const name = $(el).text().trim().split('\n')[0];
        if (!href || !name || name.length < 5) return;
        if (href.includes('/checkout') || href.includes('/customer') || href.includes('/catalogsearch')) return;
        if (seen.has(href)) return;

        const parentText = $(el).parent().text();
        const priceMatch = parentText.match(/US\$\s*([\d.,]+)/i);
        if (!priceMatch) return;

        seen.add(href);
        products.push({
          name: name.replace(/\s+/g, ' ').trim().substring(0, 500),
          slug: href.split('/').pop().replace('.html', ''),
          external_id: href.split('/').pop().replace('.html', ''),
          price_usd: this.parsePrice(priceMatch[0]),
          price_original: null,
          discount_percent: null,
          currency: 'USD',
          brand: this.extractBrand(name),
          image_url: '',
          product_url: href,
          category_id: categoryId,
          in_stock: true,
          specs: {},
        });
      });
    }

    return products;
  }

  parsePrice(text) {
    if (!text) return null;
    const match = text.match(/US\$\s*([\d.,]+)/i) || text.match(/\$\s*([\d.,]+)/);
    if (!match) return null;

    let val = match[1];
    if (val.includes('.') && val.includes(',')) {
      val = val.replace(/\./g, '').replace(',', '.');
    } else if (val.includes(',')) {
      val = val.replace(',', '.');
    }
    const num = parseFloat(val);
    return (!isNaN(num) && num > 0 && num < 100000) ? num : null;
  }

  extractBrand(name) {
    const brands = [
      'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'HUAWEI', 'HONOR', 'OPPO',
      'JBL', 'SONY', 'BOSE', 'MARSHALL', 'HARMAN KARDON',
      'CANON', 'NIKON', 'FUJIFILM', 'GOPRO', 'DJI', 'INSTA360',
      'GARMIN', 'AMAZFIT', 'FITBIT',
      'ASUS', 'MSI', 'ACER', 'LENOVO', 'DELL', 'HP',
      'INTEL', 'AMD', 'NVIDIA', 'CORSAIR', 'LOGITECH', 'RAZER', 'HYPERX',
      'LG', 'PHILIPS', 'DYSON', 'KITCHENAID',
      'PLAYSTATION', 'NINTENDO', 'XBOX',
      'NIKE', 'ADIDAS', 'PUMA', 'NEW BALANCE', 'UNDER ARMOUR',
      'TOMMY HILFIGER', 'RALPH LAUREN', 'LACOSTE', 'CALVIN KLEIN', 'HUGO BOSS',
      'CAROLINA HERRERA', 'PACO RABANNE', 'VERSACE', 'CHANEL', 'DIOR',
      'GUCCI', 'PRADA', 'ARMANI', 'GIVENCHY', 'BURBERRY', 'TOM FORD',
      'MONTBLANC', 'BVLGARI', 'CARTIER', 'HERMES',
      'MAISON FRANCIS KURKDJIAN', 'XERJOFF', 'PARFUMS DE MARLY', 'CREED',
      'JOHNNIE WALKER', 'JACK DANIELS', 'MACALLAN', 'HENNESSY', 'MOET',
      'VEUVE CLICQUOT', 'DOM PERIGNON',
      'DEWALT', 'MAKITA', 'BOSCH', 'STANLEY',
      'COOLER MASTER', 'THERMALTAKE',
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

module.exports = CellShopScraper;
