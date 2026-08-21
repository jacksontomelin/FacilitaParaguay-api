const BaseScraper = require('./BaseScraper');

class EleganciaCompanyScraper extends BaseScraper {
  constructor() {
    super('elegancia-company');
    this.baseUrl = 'http://www.eleganciacompany.com';
    this.menus = ['perfumes','nicho','cosmeticos','maquillaje','outlet','arabes'];
  }

  async scrape() {
    const page = await this.createPage();
    try {
      // Home
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this.delay(4000);
      const homeCatId = await this.upsertCategory('Destaques','destaques',null,this.baseUrl);
      await this.parseProducts(page, homeCatId);

      // Categorias via ?menu_id=
      for (const menu of this.menus) {
        try {
          const url = `${this.baseUrl}/productos?menu_id=${menu}`;
          const catId = await this.upsertCategory(menu.charAt(0).toUpperCase()+menu.slice(1), menu, null, url);
          await page.goto(url, { waitUntil: 'networkidle' });
          await this.delay(4000);
          for (let i=0;i<10;i++){await page.evaluate(()=>window.scrollBy(0,window.innerHeight));await this.delay(1000);}
          await this.parseProducts(page, catId);
          await this.delay(2000);
        } catch(e) { this.stats.errors++; console.error(`[${this.storeSlug}] Erro ${menu}: ${e.message}`); }
      }
    } finally { await page.close(); }
  }

  async parseProducts(page, categoryId) {
    const products = await page.evaluate(() => {
      const items=[]; const seen=new Set(); const text=document.body.innerText;
      const blocks = text.split(/(?=Codigo:\s*\d)/i);
      for (const block of blocks) {
        const codeMatch = block.match(/Codigo:\s*(\d+)/i);
        if (!codeMatch || seen.has(codeMatch[1])) continue;
        seen.add(codeMatch[1]);
        const lines = block.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
        let brand='',name='',price=null,priceOrig=null;
        for (const line of lines) {
          if (line.match(/^Codigo:/i)) continue;
          if (line.match(/^US\$\s*([\d.,]+)\s*SIN IVA/i)) {
            const m=line.match(/US\$\s*([\d.,]+)/i);
            if(m){let v=m[1].replace(/,/g,'');price=parseFloat(v);}
            continue;
          }
          if (line.match(/^US\$\s*([\d.,]+)$/)) {
            const m=line.match(/US\$\s*([\d.,]+)/);
            if(m){let v=m[1].replace(/,/g,'');priceOrig=parseFloat(v);}
            continue;
          }
          if (line.match(/^R\$/)) continue;
          if (line.match(/^Veja/i)) continue;
          if (!brand && line.length < 30 && line === line.toUpperCase()) { brand=line; continue; }
          if (!name && line.length > 10) { name=line; }
        }
        if (!name || !price) continue;
        items.push({code:codeMatch[1],brand,name:name.substring(0,500),price,priceOrig});
      }
      return items;
    });

    console.log(`[${this.storeSlug}] ${products.length} produtos`);
    for (const p of products) {
      const disc = p.priceOrig && p.price < p.priceOrig ? Math.round((1-p.price/p.priceOrig)*100) : null;
      await this.upsertProduct({
        name: p.name, slug: p.code, external_id: p.code,
        price_usd: p.price, price_original: p.priceOrig,
        discount_percent: disc, currency:'USD', brand: p.brand||null,
        image_url:'', product_url:`${this.baseUrl}/producto/${p.code}`,
        category_id: categoryId, in_stock:true,
        is_promo: disc>0, promo_label: disc?`-${disc}%`:null, specs:{},
      });
    }
  }
}
module.exports = EleganciaCompanyScraper;
