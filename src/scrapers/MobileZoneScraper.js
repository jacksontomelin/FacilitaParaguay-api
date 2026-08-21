const BaseScraper = require('./BaseScraper');
const cheerio = require('cheerio');

class MobileZoneScraper extends BaseScraper {
  constructor() {
    super('mobile-zone');
    this.baseUrl = 'https://www.mobilezone.com.br';
    this.categories = [
      {id:22,name:'Apple'},{id:103,name:'Automotriz'},{id:138,name:'Bebidas'},
      {id:221,name:'Belleza'},{id:80,name:'Camaras'},{id:137,name:'Celulares'},
      {id:170,name:'Cosméticos'},{id:85,name:'Deportes'},{id:139,name:'Electrodomésticos'},
      {id:118,name:'Electronicos'},{id:5,name:'Games'},{id:136,name:'Informatica'},
      {id:200,name:'Funko'},{id:140,name:'Hobby'},{id:261,name:'Camping'},
      {id:79,name:'Casa y Escritorio'},{id:176,name:'Comestibles'},
    ];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      // Home pra pegar produtos em destaque
      console.log(`[${this.storeSlug}] Acessando home...`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this.delay(4000);
      const homeCatId = await this.upsertCategory('Destaques', 'destaques', null, this.baseUrl);
      await this.parsePageProducts(page, homeCatId);

      // Categorias via /query/JSON
      for (const cat of this.categories) {
        try {
          const queryUrl = `${this.baseUrl}/query/${encodeURIComponent(JSON.stringify({id_category:cat.id,category:cat.name}))}`;
          const catId = await this.upsertCategory(cat.name, cat.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'), null, queryUrl);
          console.log(`[${this.storeSlug}] Categoria: ${cat.name}...`);
          await page.goto(queryUrl, { waitUntil: 'networkidle' });
          await this.delay(4000);
          // Scroll pra carregar lazy products
          for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await this.delay(1500);
          }
          await this.parsePageProducts(page, catId);
          await this.delay(2000);
        } catch (e) {
          console.error(`[${this.storeSlug}] Erro ${cat.name}: ${e.message}`);
          this.stats.errors++;
        }
      }
    } finally { await page.close(); }
  }

  async parsePageProducts(page, categoryId) {
    const products = await page.evaluate((baseUrl) => {
      const items = [];
      const seen = new Set();
      // Buscar cards de produto pelo texto com CÓD: e preço $
      document.querySelectorAll('*').forEach(el => {
        const text = el.textContent || '';
        if (!text.includes('CÓD:') || !text.includes('$')) return;
        // Pegar o container do produto
        const container = el.closest('div') || el;
        const codMatch = text.match(/CÓD:\s*(\d+)/);
        if (!codMatch || seen.has(codMatch[1])) return;
        seen.add(codMatch[1]);

        // Nome: texto maior antes do CÓD
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10);
        let name = '';
        for (const line of lines) {
          if (line.includes('CÓD:') || line.match(/^[R$\$\d.,\s]+$/) || line.includes('Ver m')) continue;
          if (line.length > name.length && line.length < 300) name = line;
        }
        if (!name || name.length < 10) return;

        // Preço USD: $ XXX.XX (sem R$)
        const priceMatch = text.match(/\$\s*([\d.,]+)/g);
        let priceUsd = null;
        if (priceMatch) {
          for (const p of priceMatch) {
            if (p.includes('R$')) continue;
            const m = p.match(/([\d.,]+)/);
            if (m) {
              let v = m[1].replace(/,/g, '');
              priceUsd = parseFloat(v);
              if (priceUsd > 0 && priceUsd < 50000) break;
              priceUsd = null;
            }
          }
        }

        // Imagem
        const img = container.querySelector('img');
        const imgSrc = img ? (img.src || img.getAttribute('data-src') || '') : '';

        items.push({
          code: codMatch[1],
          name: name.substring(0, 500),
          price: priceUsd,
          image: imgSrc,
        });
      });
      return items;
    }, this.baseUrl);

    console.log(`[${this.storeSlug}] ${products.length} produtos encontrados na página`);
    for (const p of products) {
      await this.upsertProduct({
        name: p.name, slug: p.code, external_id: p.code,
        price_usd: p.price, price_original: null, discount_percent: null,
        currency: 'USD', brand: this.extractBrand(p.name),
        image_url: p.image, product_url: `${this.baseUrl}/product/${p.code}`,
        category_id: categoryId, in_stock: true, specs: {},
      });
    }
  }

  extractBrand(name) {
    const brands = ['APPLE','SAMSUNG','XIAOMI','MOTOROLA','JBL','SONY','BOSE','LG','CANON','NIKON','GOPRO','DJI',
      'GARMIN','ASUS','MSI','ACER','LENOVO','DELL','HP','TCL','XION','HAIER','BRITANIA',
      'CORSAIR','LOGITECH','RAZER','PLAYSTATION','NINTENDO','XBOX','TP-LINK','SANDISK','KINGSTON','SONOFF'];
    const upper = name.toUpperCase();
    for (const b of brands.sort((a,b)=>b.length-a.length)) {
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if (new RegExp('(^|[\\s/\\-.(_])'+esc+'([\\s/\\-.).,_]|$)').test(upper)) return b;
    }
    return null;
  }
}
module.exports = MobileZoneScraper;
