const FlareSolverrScraper = require('./FlareSolverrScraper');
const cheerio = require('cheerio');

class MadridCenterScraper extends FlareSolverrScraper {
  constructor(storeSlug, config={}) {
    super(storeSlug || 'madrid-center', {
      baseUrl: 'https://madridcenterimportados.com',
      useGraphQL: false,
      ...config,
    });
    this.categories = [
      {name:'TV e Vídeo',slug:'tv-e-video-629'},
      {name:'Eletroportáteis',slug:'eletroportateis-630'},
      {name:'Ar Condicionado',slug:'ar-condicionado-488'},
      {name:'Celulares',slug:'celulares-e-telefones-632'},
      {name:'Informática',slug:'informatica-634'},
      {name:'Perfumes',slug:'perfumes-936'},
      {name:'Automotivo',slug:'automotivo-628'},
    ];
    this.searchTerms = ['iphone','samsung','xiaomi','macbook','jbl','sony','garmin','playstation','notebook','perfume','air fryer','smart tv'];
  }

  async scrape() {
    const { solveUrl } = require('../flaresolverr');
    console.log(`[${this.storeSlug}] Modo FlareSolverr HTML`);

    // Home
    try {
      const home = await solveUrl(this.baseUrl+'/home');
      const homeCatId = await this.upsertCategory('Destaques','destaques',null,this.baseUrl);
      const prods = this.parseMadridProducts(home.html, homeCatId);
      console.log(`[${this.storeSlug}] Home: ${prods.length}`);
      for(const p of prods) await this.upsertProduct(p);
    } catch(e) { console.error(`[${this.storeSlug}] Home erro: ${e.message}`); }

    // Categorias
    for (const cat of this.categories) {
      try {
        const catId = await this.upsertCategory(cat.name, cat.slug, null, `${this.baseUrl}/categoria/${cat.slug}`);
        const result = await solveUrl(`${this.baseUrl}/categoria/${cat.slug}`);
        const prods = this.parseMadridProducts(result.html, catId);
        console.log(`[${this.storeSlug}] ${cat.name}: ${prods.length}`);
        for(const p of prods) await this.upsertProduct(p);
        await this.delay(2000);
      } catch(e) { this.stats.errors++; }
    }

    // Busca
    for (const term of this.searchTerms) {
      try {
        const catSlug = 'busca-'+term.replace(/\s+/g,'-');
        const catId = await this.upsertCategory('Busca: '+term, catSlug);
        const result = await solveUrl(`${this.baseUrl}/buscar?q=${encodeURIComponent(term)}&limit=48`);
        const prods = this.parseMadridProducts(result.html, catId);
        console.log(`[${this.storeSlug}] Busca "${term}": ${prods.length}`);
        for(const p of prods) await this.upsertProduct(p);
        await this.delay(1500);
      } catch(e) { this.stats.errors++; }
    }
  }

  parseMadridProducts(html, categoryId) {
    const products=[]; const seen=new Set();
    const text = cheerio.load(html).text();
    // Padrão: MARCA\nCod: XXXXXX\nNome do produto\n$ XXX.XX
    const blocks = text.split(/(?=[A-Z]{2,}\s*\nCod:)/);
    for (const block of blocks) {
      const codMatch = block.match(/Cod:\s*(\d+)/);
      if (!codMatch || seen.has(codMatch[1])) continue;
      seen.add(codMatch[1]);
      const lines = block.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
      let brand='',name='',price=null;
      for (const line of lines) {
        if (line.match(/^Cod:/)) continue;
        if (line.match(/^\$\s*([\d.,]+)/)) {
          const m=line.match(/\$\s*([\d.,]+)/);
          if(m){let v=m[1].replace(/,/g,'');price=parseFloat(v);} continue;
        }
        if (line.match(/^R\$|^AR\$|^₲/)) continue;
        if (line.match(/^Veja|^Ver/i)) continue;
        if (!brand && line.length<25 && line===line.toUpperCase()) { brand=line; continue; }
        if (!name && line.length>15) name=line;
      }
      if (!name || !price) continue;
      products.push({
        name:name.substring(0,500),slug:codMatch[1],external_id:codMatch[1],
        price_usd:price,price_original:null,discount_percent:null,currency:'USD',
        brand:brand||null,image_url:'',
        product_url:`${this.baseUrl}/produto/${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${codMatch[1]}`,
        category_id:categoryId,in_stock:true,specs:{},
      });
    }
    return products;
  }
}
module.exports = MadridCenterScraper;
