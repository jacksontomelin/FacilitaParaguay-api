const BaseScraper = require('./BaseScraper');

/**
 * Scraper via Magento GraphQL API.
 * Bypassa Cloudflare porque é HTTP POST direto, sem browser.
 */
class MagentoGraphQLScraper extends BaseScraper {
  constructor(storeSlug, config = {}) {
    super(storeSlug);
    this.gqlUrl = config.gqlUrl || config.baseUrl + '/graphql';
    this.baseUrl = config.baseUrl || '';
    this.storeCode = config.storeCode || 'default';
    this.categories = config.categories || [];
    this.searchTerms = config.searchTerms || [];
    this.pageSize = config.pageSize || 48;
  }

  async gqlQuery(query, variables = {}) {
    const response = await fetch(this.gqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Store': this.storeCode,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`GraphQL ${response.status}: ${response.statusText}`);
    const data = await response.json();
    if (data.errors) throw new Error('GraphQL error: ' + data.errors.map(e => e.message).join(', '));
    return data.data;
  }

  async scrape() {
    console.log(`[${this.storeSlug}] Usando GraphQL API: ${this.gqlUrl}`);

    // 1. Buscar categorias se não configuradas
    if (this.categories.length === 0) {
      try {
        await this.discoverCategories();
      } catch (e) {
        console.error(`[${this.storeSlug}] Erro descobrindo categorias: ${e.message}`);
      }
    }

    // 2. Scrape por categorias
    for (const cat of this.categories) {
      try {
        const catId = await this.upsertCategory(cat.name, cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'), null, `${this.baseUrl}/${cat.slug || ''}`);
        await this.scrapeCategory(cat, catId);
        await this.delay(1000 + Math.random() * 1000);
      } catch (e) {
        console.error(`[${this.storeSlug}] Erro cat ${cat.name}: ${e.message}`);
        this.stats.errors++;
      }
    }

    // 3. Busca por termos
    for (const term of this.searchTerms) {
      try {
        const catSlug = 'busca-' + term.toLowerCase().replace(/\s+/g, '-');
        const catId = await this.upsertCategory('Busca: ' + term, catSlug, null, `${this.baseUrl}/catalogsearch/result/?q=${encodeURIComponent(term)}`);
        await this.scrapeSearch(term, catId);
        await this.delay(800 + Math.random() * 800);
      } catch (e) {
        this.stats.errors++;
      }
    }
  }

  async discoverCategories() {
    console.log(`[${this.storeSlug}] Descobrindo categorias via GraphQL...`);
    const data = await this.gqlQuery(`{
      categories(filters: {}) {
        items {
          id name url_path product_count
          children {
            id name url_path product_count
          }
        }
      }
    }`);

    const cats = [];
    for (const item of (data.categories?.items || [])) {
      if (item.product_count > 0) {
        cats.push({ id: item.id, name: item.name, slug: item.url_path });
      }
      for (const child of (item.children || [])) {
        if (child.product_count > 0) {
          cats.push({ id: child.id, name: child.name, slug: child.url_path });
        }
      }
    }
    this.categories = cats;
    console.log(`[${this.storeSlug}] ${cats.length} categorias descobertas`);
  }

  async scrapeCategory(cat, categoryId) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 50) {
      try {
        const filter = cat.id
          ? `filter: { category_id: { eq: "${cat.id}" } }`
          : `filter: { category_url_path: { eq: "${cat.slug}" } }`;

        const data = await this.gqlQuery(`{
          products(${filter}, pageSize: ${this.pageSize}, currentPage: ${page}, sort: { position: ASC }) {
            total_count
            page_info { total_pages current_page }
            items {
              sku name url_key
              price_range {
                minimum_price {
                  regular_price { value currency }
                  final_price { value currency }
                  discount { percent_off amount_off }
                }
              }
              image { url label }
              small_image { url }
              media_gallery { url label }
              stock_status
              ... on ConfigurableProduct { variants { product { sku name } } }
            }
          }
        }`);

        const products = data.products?.items || [];
        totalPages = data.products?.page_info?.total_pages || 1;

        if (products.length === 0) break;

        console.log(`[${this.storeSlug}] ${cat.name} p${page}/${totalPages}: ${products.length} produtos (total: ${data.products?.total_count})`);

        for (const p of products) {
          await this.processProduct(p, categoryId);
        }

        page++;
      } catch (e) {
        console.error(`[${this.storeSlug}] GQL erro ${cat.name} p${page}: ${e.message}`);
        this.stats.errors++;
        break;
      }
    }
  }

  async scrapeSearch(term, categoryId) {
    try {
      const data = await this.gqlQuery(`{
        products(search: "${term}", pageSize: ${this.pageSize}, currentPage: 1) {
          total_count
          items {
            sku name url_key
            price_range {
              minimum_price {
                regular_price { value currency }
                final_price { value currency }
                discount { percent_off amount_off }
              }
            }
            image { url label }
            small_image { url }
            stock_status
          }
        }
      }`);

      const products = data.products?.items || [];
      console.log(`[${this.storeSlug}] Busca "${term}": ${products.length} (total: ${data.products?.total_count})`);

      for (const p of products) {
        await this.processProduct(p, categoryId);
      }
    } catch (e) {
      this.stats.errors++;
    }
  }

  async processProduct(p, categoryId) {
    const pricing = p.price_range?.minimum_price;
    const finalPrice = pricing?.final_price?.value;
    const regularPrice = pricing?.regular_price?.value;
    const discount = pricing?.discount?.percent_off;

    const images = (p.media_gallery || []).map(m => m.url).filter(Boolean);
    const imageUrl = p.image?.url || p.small_image?.url || images[0] || '';

    await this.upsertProduct({
      name: p.name,
      slug: p.url_key,
      external_id: p.sku,
      price_usd: finalPrice,
      price_original: regularPrice > finalPrice ? regularPrice : null,
      discount_percent: discount > 0 ? Math.round(discount) : null,
      currency: pricing?.final_price?.currency || 'USD',
      brand: this.extractBrandFromName(p.name),
      image_url: imageUrl,
      images: images,
      product_url: `${this.baseUrl}/${p.url_key}`,
      category_id: categoryId,
      in_stock: p.stock_status === 'IN_STOCK',
      is_promo: discount > 0,
      promo_label: discount > 0 ? `-${Math.round(discount)}%` : null,
      sku: p.sku,
      specs: {},
    });
  }

  extractBrandFromName(name) {
    const brands = [
      'APPLE','SAMSUNG','XIAOMI','MOTOROLA','REALME','NOKIA','HUAWEI','HONOR',
      'JBL','SONY','BOSE','LG','CANON','NIKON','GOPRO','DJI',
      'GARMIN','ASUS','MSI','ACER','LENOVO','DELL','HP',
      'INTEL','AMD','NVIDIA','CORSAIR','LOGITECH','RAZER',
      'PLAYSTATION','NINTENDO','XBOX','AMAZON',
      'CAROLINA HERRERA','PACO RABANNE','CALVIN KLEIN','HUGO BOSS',
      'CHANEL','DIOR','VERSACE','GUCCI','ARMANI',
      'TP-LINK','SANDISK','KINGSTON','EPSON','BROTHER',
    ];
    const upper = name.toUpperCase();
    const sorted = [...brands].sort((a, b) => b.length - a.length);
    for (const b of sorted) {
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[\\s/\\-.(_])' + esc + '([\\s/\\-.).,_]|$)').test(upper)) return b;
    }
    return null;
  }

  // Override: não precisa de browser
  async init() {
    try {
      this.lockClient = await require('../database').acquireLock(this.lockId);
    } catch (_) { this.lockClient = null; }

    const result = await require('../database').pool.query('SELECT * FROM stores WHERE slug = $1', [this.storeSlug]);
    if (!result.rows.length) throw new Error(`Loja não encontrada: ${this.storeSlug}`);
    this.store = result.rows[0];

    // Testar GraphQL
    console.log(`[${this.storeSlug}] Testando GraphQL em ${this.gqlUrl}...`);
    const test = await this.gqlQuery('{ storeConfig { store_name base_currency_code } }');
    console.log(`[${this.storeSlug}] Loja: ${test.storeConfig?.store_name}, Moeda: ${test.storeConfig?.base_currency_code}`);
  }

  async createPage() { return null; } // Não usa browser
  async cleanup() {
    if (this.lockClient) {
      await require('../database').releaseLock(this.lockClient, this.lockId);
    }
    // Sem browser pra fechar
  }
}

module.exports = MagentoGraphQLScraper;
