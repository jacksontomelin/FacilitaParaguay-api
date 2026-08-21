const BaseScraper = require('./BaseScraper');

class FlytecScraper extends BaseScraper {
  constructor() {
    super('flytec-computers');
    this.baseUrl = 'https://www.flytec.com.py';
  }

  async scrape() {
    const page = await this.createPage();
    try {
      // Páginas especiais
      const specials = [
        {name:'Destaques',path:'/destaque'},
        {name:'Novos Produtos',path:'/novos-produtos'},
        {name:'Baixaram de Preço',path:'/produtos-baixaram'},
      ];
      for (const sp of specials) {
        try {
          const catId = await this.upsertCategory(sp.name, sp.name.toLowerCase().replace(/\s+/g,'-'), null, this.baseUrl+sp.path);
          await page.goto(this.baseUrl+sp.path, {waitUntil:'networkidle'});
          await this.delay(3000);
          await this.parseProducts(page, catId);
        } catch(e) { this.stats.errors++; }
      }

      // Descobrir categorias do menu
      await page.goto(this.baseUrl, {waitUntil:'networkidle'});
      await this.delay(3000);
      const cats = await page.evaluate((base) => {
        const items=[];const seen=new Set();
        document.querySelectorAll('a[href*="/classificacao/"]').forEach(a => {
          const href=a.href;if(seen.has(href))return;seen.add(href);
          items.push({name:a.textContent.trim(),url:href});
        });
        return items.filter(c=>c.name.length>2).slice(0,40);
      }, this.baseUrl);

      console.log(`[${this.storeSlug}] ${cats.length} categorias do menu`);
      for (const cat of cats) {
        try {
          const slug = cat.name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
          const catId = await this.upsertCategory(cat.name, slug, null, cat.url);
          await page.goto(cat.url, {waitUntil:'networkidle'});
          await this.delay(3000);
          await this.parseProducts(page, catId);
          await this.delay(1500);
        } catch(e) { this.stats.errors++; }
      }

      // Busca
      const terms = ['notebook','placa video','processador','monitor','ssd','rtx','ryzen','fonte','gabinete','cooler','roteador','switch'];
      for (const term of terms) {
        try {
          const catSlug = 'busca-'+term.replace(/\s+/g,'-');
          const catId = await this.upsertCategory('Busca: '+term, catSlug);
          await page.goto(`${this.baseUrl}/busca?q=${encodeURIComponent(term)}`, {waitUntil:'networkidle'});
          await this.delay(3000);
          await this.parseProducts(page, catId);
          await this.delay(1000);
        } catch(e) { this.stats.errors++; }
      }
    } finally { await page.close(); }
  }

  async parseProducts(page, categoryId) {
    const products = await page.evaluate((baseUrl) => {
      const items=[]; const seen=new Set();
      // Links de produto com /classificacao/ ou /produto/
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href;
        if (!href.includes(baseUrl)) return;
        if (!href.includes('/classificacao/') && !href.includes('/produto/')) return;
        // Pegar container
        const card = a.closest('div, li, article') || a.parentElement;
        if (!card) return;
        const text = card.textContent;
        const img = card.querySelector('img');

        // Código
        const codMatch = text.match(/Cód[:\s]*(\d+)/i) || text.match(/cod[:\s]*(\d+)/i);
        const code = codMatch?.[1] || href.match(/\/(\d{4,})\//)?.[1] || '';
        if (!code || seen.has(code)) return;
        seen.add(code);

        // Nome
        const lines = text.split('\n').map(l=>l.trim()).filter(l=>l.length>10 && l.length<300);
        let name = '';
        for (const l of lines) {
          if (l.match(/^(Cód|US\$|R\$|Ver|Adicionar|Comprar)/i)) continue;
          if (l.length > name.length) name = l;
        }
        if (!name) name = img?.alt || '';
        if (!name || name.length < 5) return;

        // Preço
        const pm = text.match(/US\$\s*([\d.,]+)/i) || text.match(/\$\s*([\d.,]+)/);
        let price = null;
        if (pm) { let v=pm[1]; if(v.includes('.') && v.includes(',')) v=v.replace(/\./g,'').replace(',','.'); else if(v.includes(',')) v=v.replace(',','.'); price=parseFloat(v)||null; }

        items.push({ code, name:name.substring(0,500), price, image:img?.src||'', url:href });
      });
      return items;
    }, this.baseUrl);

    console.log(`[${this.storeSlug}] ${products.length} produtos`);
    for (const p of products) {
      await this.upsertProduct({
        name:p.name, slug:p.code, external_id:p.code,
        price_usd:p.price, price_original:null, discount_percent:null,
        currency:'USD', brand:null, image_url:p.image,
        product_url:p.url, category_id:categoryId, in_stock:true, specs:{},
      });
    }
  }
}
module.exports = FlytecScraper;
