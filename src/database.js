const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        base_url VARCHAR(500) NOT NULL,
        logo_url VARCHAR(500),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        url VARCHAR(500),
        product_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(store_id, slug)
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        external_id VARCHAR(255),
        name VARCHAR(500) NOT NULL,
        slug VARCHAR(500),
        description TEXT,
        price_usd DECIMAL(12,2),
        price_original DECIMAL(12,2),
        discount_percent INTEGER,
        currency VARCHAR(10) DEFAULT 'USD',
        brand VARCHAR(255),
        image_url VARCHAR(1000),
        images JSONB DEFAULT '[]',
        product_url VARCHAR(1000),
        in_stock BOOLEAN DEFAULT true,
        is_promo BOOLEAN DEFAULT false,
        promo_label VARCHAR(255),
        sku VARCHAR(255),
        specs JSONB DEFAULT '{}',
        first_seen_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(store_id, product_url)
      );

      CREATE TABLE IF NOT EXISTS price_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        price_usd DECIMAL(12,2),
        price_original DECIMAL(12,2),
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scrape_logs (
        id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        products_found INTEGER DEFAULT 0,
        products_new INTEGER DEFAULT 0,
        products_updated INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        duration_ms INTEGER,
        error_message TEXT,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
      CREATE INDEX IF NOT EXISTS idx_products_price ON products(price_usd);
      CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
      CREATE INDEX IF NOT EXISTS idx_categories_store ON categories(store_id);
      CREATE INDEX IF NOT EXISTS idx_scrape_logs_store ON scrape_logs(store_id);
    `);

    // Tentar criar extensão pg_trgm e index (falha silenciosa se não disponível)
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops)`);
    } catch (e) {
      console.log('[DB] pg_trgm não disponível, busca textual usará ILIKE');
    }

    // Inserir lojas padrão
    await client.query(`
      INSERT INTO stores (slug, name, base_url) VALUES
        ('shopping-china', 'Shopping China', 'https://www.shoppingchina.com.br'),
        ('newzone', 'New Zone Importados', 'https://newzone.com.br'),
        ('nissei', 'Nissei', 'https://nissei.com'),
        ('cellshop', 'CellShop', 'https://cellshop.com'),
        ('mega-eletronicos', 'Mega Eletrônicos', 'https://megaeletronicos.com'),
        ('casa-bo', 'Casa Bo', 'https://www.casabo.com.py'),
        ('star-company', 'Star Company', 'https://www.starcompany-py.com'),
        ('atacado-connect', 'Atacado Connect', 'https://www.atacadoconnect.com'),
        ('mobile-zone', 'Mobile Zone', 'http://www.mobilezone.com.br'),
        ('elegancia-company', 'Elegancia Company', 'http://www.eleganciacompany.com'),
        ('la-petisquera', 'La Petisquera', 'https://lapetisquera.com.py'),
        ('multipass', 'MultiPass', 'https://multipass.com.py'),
        ('visaovip', 'Visãovip', 'http://www.visaovip.com'),
        ('flytec-computers', 'Flytec Computers', 'http://www.flytec.com.py'),
        ('intershop-importados', 'Intershop Importados', 'https://intershop.com.py'),
        ('one-click', 'One Click', 'https://oneclick.com.py'),
        ('madrid-center', 'Madrid Center', 'https://www.madridcenter.com'),
        ('pontocom', 'Pontocom', 'http://www.pontocom.com'),
        ('topdek-informatica', 'Topdek Informática', 'https://topdekinformatica.com.br'),
        ('agatres', 'Agatres', 'https://agatres.co')
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        base_url = EXCLUDED.base_url,
        updated_at = NOW()
    `);

    console.log('[DB] Schema inicializado com sucesso');
  } finally {
    client.release();
  }
}

// Advisory lock para evitar execuções concorrentes
async function acquireLock(lockId) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) as acquired', [lockId]);
    if (!result.rows[0].acquired) {
      client.release();
      return null;
    }
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

async function releaseLock(client, lockId) {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase, acquireLock, releaseLock };

// Adicionar índices de busca e pg_trgm
async function addSearchIndexes() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_is_promo ON products (is_promo) WHERE is_promo = true`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_store_id ON products (store_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_price ON products (price_usd)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id, recorded_at DESC)`);
    console.log('[DB] Índices de busca criados');
  } catch (err) {
    console.error('[DB] Erro criando índices:', err.message);
  }
}

module.exports.addSearchIndexes = addSearchIndexes;
