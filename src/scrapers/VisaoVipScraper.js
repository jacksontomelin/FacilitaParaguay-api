const FlareSolverrScraper = require('./FlareSolverrScraper');
const cheerio = require('cheerio');

class VisaoVipScraper extends FlareSolverrScraper {
  constructor(storeSlug, config = {}) {
    super(storeSlug || 'visaovip', {
      baseUrl: 'https://www.visaovip.com',
      useGraphQL: false,
      ...config,
    });
    this.categories = [
      {name:'Apple',slug:'apple',id:19},
      {name:'Notebook e Computador',slug:'notebook-e-computador',id:20},
      {name:'Armazenamento',slug:'armazenamento',id:21},
      {name:'Placa Mãe',slug:'placa-mae',id:22},
      {name:'Placa de Vídeo',slug:'placa-de-video',id:23},
      {name:'Processadores',slug:'processadores',id:24},
      {name:'Cooler',slug:'cooler',id:25},
      {name:'Fonte de Alimentação',slug:'fonte-de-alimentacao',id:26},
      {name:'Monitor',slug:'monitor',id:27},
      {name:'Gabinete',slug:'gabinete',id:28},
      {name:'Impressoras',slug:'impressoras-e-suprimentos',id:29},
      {name:'Periféricos',slug:'perifericos',id:30},
      {name:'Rede e Internet',slug:'rede-e-internet',id:31},
      {name:'Celulares e Tablets',slug:'celulares-e-tablets',id:32},
      {name:'Eletrônicos',slug:'eletronicos',id:33},
    ];
  }

  async scrape() {
    console.log(`[${this.storeSlug}] Modo HTML via FlareSolverr`);

    // Home
    try {
      const { solveUrl } = require('../flaresolverr');
      const homeResult = await solveUrl(this.baseUrl);
      const homeCatId = await this.upsertCategory('Destaques', 'destaques', null, this.baseUrl);
      const homeProds = this.parseVisaoProducts(homeResult.html, homeCatId);
      console.log(`[${this.storeSlug}] Home: ${homeProds.length} produtos`);
      for (const p of homeProds) await this.upsertProduct(p);
    } catch (e) {
      console.error(`[${this.storeSlug}] Erro home: ${e.message}`);
    }

    // Categorias via /busca/categoria/SLUG/ID/
    const { solveUrl } = require('../flaresolverr');
    for (const cat of this.categories) {
      try {
        const catId = await this.upsertCategory(cat.name, cat.slug, null, `${this.baseUrl}/busca/categoria/${cat.slug}/${cat.id}/`);
        const url = `${this.baseUrl}/busca/categoria/${cat.slug}/${cat.id}/`;
        console.log(`[${this.storeSlug}] ${cat.name}...`);
        const result = await solveUrl(url);
        const products = this.parseVisaoProducts(result.html, catId);
        console.log(`[${this.storeSlug}] ${cat.name}: ${products.length} produtos`);
        for (const p of products) await this.upsertProduct(p);
        await this.delay(2000);
      } catch (e) {
        console.error(`[${this.storeSlug}] Erro ${cat.name}: ${e.message}`);
        this.stats.errors++;
      }
    }

    // Busca Destaques e Promoções
    for (const path of ['/busca/destaques/','/busca/promocoes/']) {
      try {
        const catSlug = path.includes('destaque') ? 'destaques-busca' : 'promocoes';
        const catId = await this.upsertCategory(path.includes('destaque') ? 'Destaques' : 'Promoções', catSlug, null, this.baseUrl + path);
        const result = await solveUrl(this.baseUrl + path);
        const products = this.parseVisaoProducts(result.html, catId);
        console.log(`[${this.storeSlug}] ${catSlug}: ${products.length}`);
        for (const p of products) await this.upsertProduct(p);
      } catch (e) { this.stats.errors++; }
    }
  }

  parseVisaoProducts(html, categoryId) {
    const $ = cheerio.load(html);
    const products = [];
    const seen = new Set();
    const text = $.text();

    // Pattern: Código: XXXXX + nome + U$ XXX,XX
    const blocks = text.split(/(?=Código:\s*\d)/i);
    for (const block of blocks) {
      const codeMatch = block.match(/Código:\s*(\d+)/i);
      if (!codeMatch || seen.has(codeMatch[1])) continue;
      seen.add(codeMatch[1]);

      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let name = '', priceUsd = null, priceOriginal = null;

      for (const line of lines) {
        if (line.match(/^Código:/i)) continue;
        // Preço: U$ XXX,XX
        const pm = line.match(/U\$\s*([\d.,]+)/);
        if (pm) {
          let v = pm[1]; if (v.includes('.') && v.includes(',')) v = v.replace(/\./g,'').replace(',','.'); else if (v.includes(',')) v = v.replace(',','.');
          const p = parseFloat(v);
          if (p > 0) {
            if (!priceOriginal && priceUsd) priceOriginal = priceUsd;
            priceUsd = p;
          }
          continue;
        }
        if (!name && line.length > 15 && !line.match(/^(OFERTA|Ver|Comprar|Adicionar|G\$|R\$)/i)) {
          name = line;
        }
      }

      if (!name || name.length < 10) continue;

      const discount = priceOriginal && priceUsd < priceOriginal
        ? Math.round((1 - priceUsd / priceOriginal) * 100) : null;

      products.push({
        name: name.substring(0, 500), slug: codeMatch[1], external_id: codeMatch[1],
        price_usd: priceUsd, price_original: priceOriginal,
        discount_percent: discount,
        currency: 'USD', brand: this.extractBrand(name),
        image_url: '', product_url: `${this.baseUrl}/produto/${codeMatch[1]}`,
        category_id: categoryId, in_stock: true,
        is_promo: discount > 0, promo_label: discount ? `-${discount}%` : null,
        specs: {},
      });
    }

    // Tentar pegar imagens
    $('img[src]').each((_, img) => {
      const src = $(img).attr('src') || '';
      if (src.includes('produto') || src.includes('product')) {
        // Associar ao primeiro produto sem imagem
        const p = products.find(pr => !pr.image_url);
        if (p) p.image_url = src;
      }
    });

    return products;
  }
}
module.exports = VisaoVipScraper;
