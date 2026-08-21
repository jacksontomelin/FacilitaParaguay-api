const BaseScraper = require('./BaseScraper');

class OneClickScraper extends BaseScraper {
  constructor() {
    super('one-click');
    this.baseUrl = 'https://oneclick.com.py';
    this.categoryUrls = [
      {name:'Celulares',path:'/categoria/celulares'},
      {name:'Smartphones',path:'/categoria/celulares/smartphones'},
      {name:'Acessórios Celular',path:'/categoria/celulares/acessorios-celular'},
      {name:'Eletrônicos',path:'/categoria/eletronicos'},
      {name:'Audio Video',path:'/categoria/eletronicos/audio-video'},
      {name:'Drones',path:'/categoria/eletronicos/drones'},
      {name:'Fones',path:'/categoria/eletronicos/fone-de-ouvido'},
      {name:'GPS',path:'/categoria/eletronicos/gps-navigacion'},
      {name:'Informática',path:'/categoria/informatica'},
      {name:'Notebooks',path:'/categoria/informatica/notebook'},
      {name:'Componentes',path:'/categoria/informatica/componentes'},
      {name:'Monitores',path:'/categoria/informatica/monitores'},
      {name:'Periféricos',path:'/categoria/informatica/perifricos'},
      {name:'Repuestos',path:'/categoria/peas-de-reposio'},
      {name:'Câmeras',path:'/categoria/eletronicos/cameras'},
      {name:'Relógios',path:'/categoria/eletronicos/relogios'},
    ];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      // 1. Home - tem destaques
      console.log(`[${this.storeSlug}] Scraping home...`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this.delay(4000);
      const homeCatId = await this.upsertCategory('Destaques', 'destaques', null, this.baseUrl);
      await this.parseProducts(page, homeCatId);

      // 2. Categorias
      for (const cat of this.categoryUrls) {
        try {
          const catId = await this.upsertCategory(cat.name, cat.path.split('/').pop(), null, this.baseUrl + cat.path);
          await page.goto(this.baseUrl + cat.path, { waitUntil: 'networkidle' });
          await this.delay(3000);
          // Scroll
          for (let i = 0; i < 8; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await this.delay(1000);
          }
          await this.parseProducts(page, catId);
          await this.delay(2000);
        } catch (e) {
          console.error(`[${this.storeSlug}] Erro ${cat.name}: ${e.message}`);
          this.stats.errors++;
        }
      }
    } finally { await page.close(); }
  }

  async parseProducts(page, categoryId) {
    const products = await page.evaluate((baseUrl) => {
      const items = [];
      const seen = new Set();
      const text = document.body.innerText;

      // Pattern: REF: XXXXX\nNome do produto\nPreço: U$$ XXX
      const blocks = text.split(/(?=REF:\s*\d)/);
      for (const block of blocks) {
        const refMatch = block.match(/REF:\s*(\d+)/);
        if (!refMatch || seen.has(refMatch[1])) continue;
        seen.add(refMatch[1]);

        const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let name = '', price = null;

        for (const line of lines) {
          if (line.startsWith('REF:')) continue;
          if (line.match(/^Pre[cç]io?:\s*U?\$\$?\s*([\d.,]+)/i)) {
            const m = line.match(/([\d.,]+)/g);
            if (m) { let v = m[m.length-1].replace(/,/g,''); price = parseFloat(v); }
            continue;
          }
          if (line.match(/^U?\$\$?\s*[\d]/)) {
            const m = line.match(/([\d.,]+)/);
            if (m) { let v = m[1].replace(/,/g,''); price = parseFloat(v); }
            continue;
          }
          if (!name && line.length > 15 && !line.match(/^(Ver |Agregar|Añadir|Comprar|OFERTA)/i)) {
            name = line;
          }
        }

        if (!name || name.length < 10 || !price || price <= 0) continue;

        items.push({ ref: refMatch[1], name: name.substring(0, 500), price });
      }

      // Também pegar imagens por REF
      const imgMap = {};
      document.querySelectorAll('img[src]').forEach(img => {
        const src = img.src || '';
        const alt = img.alt || '';
        // Associar imagem ao produto se possível
        const parent = img.closest('a, div');
        const parentText = parent?.textContent || '';
        const ref = parentText.match(/REF:\s*(\d+)/);
        if (ref) imgMap[ref[1]] = src;
      });

      return items.map(p => ({ ...p, image: imgMap[p.ref] || '' }));
    }, this.baseUrl);

    console.log(`[${this.storeSlug}] ${products.length} produtos`);
    for (const p of products) {
      await this.upsertProduct({
        name: p.name, slug: p.ref, external_id: p.ref,
        price_usd: p.price, price_original: null, discount_percent: null,
        currency: 'USD', brand: this.extractBrand(p.name),
        image_url: p.image, product_url: `${this.baseUrl}/producto/${p.ref}`,
        category_id: categoryId, in_stock: true, specs: {},
      });
    }
  }

  extractBrand(name) {
    const brands = ['APPLE','SAMSUNG','XIAOMI','MOTOROLA','JBL','SONY','BOSE','LG','CANON','NIKON','GOPRO','DJI',
      'GARMIN','ASUS','MSI','ACER','LENOVO','DELL','HP','CORSAIR','LOGITECH','RAZER',
      'PLAYSTATION','NINTENDO','INSTA360','SENNHEISER','BOSE','ANKER'];
    const upper = name.toUpperCase();
    for (const b of brands.sort((a,b)=>b.length-a.length)) {
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if (new RegExp('(^|[\\s/\\-.(_])'+esc+'([\\s/\\-.).,_]|$)').test(upper)) return b;
    }
    return null;
  }
}
module.exports = OneClickScraper;
