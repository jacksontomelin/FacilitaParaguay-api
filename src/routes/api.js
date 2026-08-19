const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { createScraper, getAvailableScrapers } = require('../scrapers');
const cache = require('../cache');
const tracker = require('../scrapeTracker');

// Middleware de cache
function cached(keyFn, ttl = 60000) {
  return (req, res, next) => {
    const key = typeof keyFn === 'function' ? keyFn(req) : req.originalUrl;
    const data = cache.get(key);
    if (data) return res.json(data);
    const origJson = res.json.bind(res);
    res.json = (body) => { cache.set(key, body); return origJson(body); };
    next();
  };
}

// ==================== HEALTH ====================

// GET /api/health - Status do sistema
router.get('/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW() as time, (SELECT COUNT(*) FROM products) as products, (SELECT COUNT(*) FROM stores) as stores');
    const lastScrapes = await pool.query(`
      SELECT s.slug, s.name, sl.status, sl.finished_at, sl.products_found, sl.duration_ms
      FROM stores s LEFT JOIN LATERAL (
        SELECT * FROM scrape_logs WHERE store_id = s.id ORDER BY finished_at DESC LIMIT 1
      ) sl ON true ORDER BY s.name
    `);
    const stale = lastScrapes.rows.filter(r =>
      !r.finished_at || (Date.now() - new Date(r.finished_at).getTime()) > 24 * 60 * 60 * 1000
    );
    res.json({
      status: stale.length > lastScrapes.rows.length / 2 ? 'degraded' : 'healthy',
      db_time: dbCheck.rows[0].time,
      total_products: parseInt(dbCheck.rows[0].products),
      total_stores: parseInt(dbCheck.rows[0].stores),
      scrapers: lastScrapes.rows.map(r => ({
        store: r.slug, name: r.name, last_status: r.status,
        last_run: r.finished_at, products_found: r.products_found,
        duration_ms: r.duration_ms,
        fresh: r.finished_at && (Date.now() - new Date(r.finished_at).getTime()) < 24 * 60 * 60 * 1000,
      })),
      stale_count: stale.length,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==================== STORES ====================

router.get('/stores', cached(null), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) as product_count,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_promo = true) as promo_count,
        (SELECT MAX(finished_at) FROM scrape_logs sl WHERE sl.store_id = s.id) as last_scrape
      FROM stores s ORDER BY s.name
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PRODUCTS ====================

router.get('/products', async (req, res) => {
  try {
    const { store, search, brand, category, min_price, max_price, in_stock, sort = 'updated', page = 1, limit = 50 } = req.query;
    const params = [];
    const conditions = [];
    let paramIdx = 1;

    if (store) { conditions.push(`s.slug = $${paramIdx++}`); params.push(store); }
    if (brand) { conditions.push(`p.brand ILIKE $${paramIdx++}`); params.push(`%${brand}%`); }
    if (category) { conditions.push(`c.slug = $${paramIdx++}`); params.push(category); }
    if (min_price) { conditions.push(`p.price_usd >= $${paramIdx++}`); params.push(parseFloat(min_price)); }
    if (max_price) { conditions.push(`p.price_usd <= $${paramIdx++}`); params.push(parseFloat(max_price)); }
    if (in_stock === 'true') { conditions.push(`p.in_stock = true`); }

    // Busca fuzzy com pg_trgm
    if (search) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.name % $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sortMap = {
      updated: 'p.updated_at DESC', price_asc: 'p.price_usd ASC NULLS LAST',
      price_desc: 'p.price_usd DESC NULLS LAST', name: 'p.name ASC',
      discount: 'p.discount_percent DESC NULLS LAST', newest: 'p.first_seen_at DESC',
    };
    const orderBy = sortMap[sort] || sortMap.updated;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countQ = await pool.query(`SELECT COUNT(*) FROM products p LEFT JOIN stores s ON p.store_id = s.id LEFT JOIN categories c ON p.category_id = c.id ${where}`, params);
    const result = await pool.query(`
      SELECT p.*, s.name as store_name, s.slug as store_slug, c.name as category_name
      FROM products p
      LEFT JOIN stores s ON p.store_id = s.id
      LEFT JOIN categories c ON p.category_id = c.id
      ${where} ORDER BY ${orderBy}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, parseInt(limit), offset]);

    res.json({ products: result.rows, total: parseInt(countQ.rows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(parseInt(countQ.rows[0].count) / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, s.name as store_name, s.slug as store_slug, c.name as category_name
      FROM products p LEFT JOIN stores s ON p.store_id = s.id LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    const product = result.rows[0];
    const history = await pool.query('SELECT * FROM price_history WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 90', [req.params.id]);
    product.price_history = history.rows;
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/products/:id/images', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, image_url, images, product_url FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    const p = result.rows[0];
    const allImages = [];
    if (p.image_url) allImages.push(p.image_url);
    if (p.images && Array.isArray(p.images)) p.images.forEach(i => { if (i && !allImages.includes(i)) allImages.push(i); });
    res.json({ product_id: p.id, name: p.name, images: allImages, total: allImages.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PROMOTIONS ====================

router.get('/promotions', async (req, res) => {
  try {
    const { store, min_discount, brand, search, page = 1, limit = 50 } = req.query;
    const params = [];
    const conditions = ['(p.is_promo = true OR p.discount_percent > 0 OR (p.price_original IS NOT NULL AND p.price_usd < p.price_original))'];
    let pi = 1;

    if (store) { conditions.push(`s.slug = $${pi++}`); params.push(store); }
    if (min_discount) { conditions.push(`p.discount_percent >= $${pi++}`); params.push(parseInt(min_discount)); }
    if (brand) { conditions.push(`p.brand ILIKE $${pi++}`); params.push(`%${brand}%`); }
    if (search) { conditions.push(`p.name ILIKE $${pi++}`); params.push(`%${search}%`); }

    const where = 'WHERE ' + conditions.join(' AND ');
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const countQ = await pool.query(`SELECT COUNT(*) FROM products p LEFT JOIN stores s ON p.store_id = s.id ${where}`, params);
    const result = await pool.query(`
      SELECT p.*, s.name as store_name, s.slug as store_slug, c.name as category_name
      FROM products p LEFT JOIN stores s ON p.store_id = s.id LEFT JOIN categories c ON p.category_id = c.id
      ${where} ORDER BY p.discount_percent DESC NULLS LAST, p.updated_at DESC
      LIMIT $${pi++} OFFSET $${pi++}
    `, [...params, parseInt(limit), offset]);
    res.json({ promotions: result.rows, total: parseInt(countQ.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/promotions/stats', cached(null), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.slug, s.name,
        COUNT(*)::int as total_promos,
        AVG(p.discount_percent)::numeric(5,1) as avg_discount,
        MAX(p.discount_percent) as max_discount,
        MIN(p.price_usd)::numeric(10,2) as min_price
      FROM products p LEFT JOIN stores s ON p.store_id = s.id
      WHERE p.is_promo = true OR p.discount_percent > 0
      GROUP BY s.id ORDER BY total_promos DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PRICE ALERTS ====================

// GET /api/alerts/price-drops - Produtos que baixaram de preço
router.get('/alerts/price-drops', async (req, res) => {
  try {
    const { hours = 24, min_drop = 5, store, limit = 100 } = req.query;
    const params = [parseInt(hours), parseFloat(min_drop)];
    let pi = 3;
    let storeFilter = '';
    if (store) { storeFilter = `AND s.slug = $${pi++}`; params.push(store); }

    const result = await pool.query(`
      WITH recent_changes AS (
        SELECT DISTINCT ON (ph.product_id)
          ph.product_id,
          ph.price_usd as new_price,
          ph.price_original,
          LAG(ph.price_usd) OVER (PARTITION BY ph.product_id ORDER BY ph.recorded_at) as old_price,
          ph.recorded_at
        FROM price_history ph
        WHERE ph.recorded_at > NOW() - ($1 || ' hours')::interval
        ORDER BY ph.product_id, ph.recorded_at DESC
      )
      SELECT rc.*, p.name, p.brand, p.image_url, p.product_url, p.images,
             s.name as store_name, s.slug as store_slug,
             ROUND(((rc.old_price - rc.new_price) / rc.old_price * 100)::numeric, 1) as drop_percent,
             (rc.old_price - rc.new_price)::numeric(10,2) as drop_amount
      FROM recent_changes rc
      JOIN products p ON rc.product_id = p.id
      LEFT JOIN stores s ON p.store_id = s.id
      WHERE rc.old_price IS NOT NULL
        AND rc.new_price < rc.old_price
        AND ((rc.old_price - rc.new_price) / rc.old_price * 100) >= $2
        ${storeFilter}
      ORDER BY drop_percent DESC
      LIMIT $${pi}
    `, [...params, parseInt(limit)]);

    res.json({ drops: result.rows, period_hours: parseInt(hours), min_drop_percent: parseFloat(min_drop) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== COMPARE (CROSS-STORE DEDUP) ====================

router.get('/compare', async (req, res) => {
  try {
    const { search, brand } = req.query;
    if (!search && !brand) return res.status(400).json({ error: 'Informe search ou brand' });

    const params = [];
    const conditions = [];
    let pi = 1;

    if (search) {
      // Fuzzy match + ILIKE
      conditions.push(`(p.name ILIKE $${pi} OR p.name % $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }
    if (brand) {
      conditions.push(`p.brand ILIKE $${pi++}`);
      params.push(`%${brand}%`);
    }
    conditions.push('p.price_usd IS NOT NULL');
    conditions.push('p.in_stock = true');

    const result = await pool.query(`
      SELECT p.id, p.name, p.brand, p.price_usd, p.price_original, p.discount_percent,
             p.image_url, p.images, p.product_url, p.is_promo, p.promo_label,
             s.name as store_name, s.slug as store_slug,
             SIMILARITY(p.name, $${pi}) as match_score
      FROM products p
      LEFT JOIN stores s ON p.store_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY match_score DESC, p.price_usd ASC
      LIMIT 100
    `, [...params, search || brand]);

    // Agrupar por produto similar (dedup cross-store)
    const groups = [];
    const used = new Set();
    for (const row of result.rows) {
      if (used.has(row.id)) continue;
      const similar = result.rows.filter(r => {
        if (used.has(r.id) || r.id === row.id) return false;
        // Match por nome normalizado
        const normalize = s => s.toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        const a = normalize(row.name), b = normalize(r.name);
        // Se >70% das palavras coincidem, é o mesmo produto
        const wa = a.split(' '), wb = b.split(' ');
        const common = wa.filter(w => wb.includes(w) && w.length > 2).length;
        return common / Math.min(wa.length, wb.length) > 0.6;
      });
      const group = [row, ...similar];
      group.forEach(g => used.add(g.id));
      groups.push({
        name: row.name,
        brand: row.brand,
        best_price: Math.min(...group.map(g => parseFloat(g.price_usd))),
        stores: group.map(g => ({
          store: g.store_name, store_slug: g.store_slug,
          price: parseFloat(g.price_usd), original: g.price_original ? parseFloat(g.price_original) : null,
          discount: g.discount_percent, is_promo: g.is_promo, promo_label: g.promo_label,
          url: g.product_url, image: g.image_url, images: g.images,
        })).sort((a, b) => a.price - b.price),
        price_range: { min: Math.min(...group.map(g => parseFloat(g.price_usd))), max: Math.max(...group.map(g => parseFloat(g.price_usd))) },
        savings: Math.max(...group.map(g => parseFloat(g.price_usd))) - Math.min(...group.map(g => parseFloat(g.price_usd))),
      });
    }

    res.json({ query: search || brand, groups: groups.sort((a, b) => a.best_price - b.best_price), total_groups: groups.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== CATEGORIES & BRANDS ====================

router.get('/categories', cached(null), async (req, res) => {
  try {
    const { store } = req.query;
    let q = `SELECT c.*, s.name as store_name, s.slug as store_slug,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count
      FROM categories c LEFT JOIN stores s ON c.store_id = s.id`;
    const params = [];
    if (store) { q += ' WHERE s.slug = $1'; params.push(store); }
    q += ' ORDER BY s.name, c.name';
    res.json((await pool.query(q, params)).rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/brands', cached(null), async (req, res) => {
  try {
    const { store } = req.query;
    let q = `SELECT p.brand, COUNT(*)::int as product_count, MIN(p.price_usd)::numeric(10,2) as min_price, MAX(p.price_usd)::numeric(10,2) as max_price
      FROM products p LEFT JOIN stores s ON p.store_id = s.id WHERE p.brand IS NOT NULL`;
    const params = [];
    if (store) { q += ' AND s.slug = $1'; params.push(store); }
    q += ' GROUP BY p.brand ORDER BY product_count DESC';
    res.json((await pool.query(q, params)).rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== STATS ====================

router.get('/stats', cached(null), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM products)::int as total_products,
        (SELECT COUNT(*) FROM products WHERE in_stock = true)::int as in_stock,
        (SELECT COUNT(*) FROM products WHERE is_promo = true)::int as promos,
        (SELECT COUNT(DISTINCT brand) FROM products WHERE brand IS NOT NULL)::int as brands,
        (SELECT COUNT(*) FROM stores)::int as stores,
        (SELECT COUNT(*) FROM categories)::int as categories,
        (SELECT MIN(price_usd) FROM products WHERE price_usd > 0)::numeric(10,2) as min_price,
        (SELECT MAX(price_usd) FROM products)::numeric(10,2) as max_price,
        (SELECT AVG(price_usd) FROM products WHERE price_usd > 0)::numeric(10,2) as avg_price
    `);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== EXPORT ====================

// GET /api/export - Exportar dados como CSV ou JSON
router.get('/export', async (req, res) => {
  try {
    const { format = 'json', store, brand, search, promo_only, limit = 5000 } = req.query;
    const conditions = [];
    const params = [];
    let pi = 1;

    if (store) { conditions.push(`s.slug = $${pi++}`); params.push(store); }
    if (brand) { conditions.push(`p.brand ILIKE $${pi++}`); params.push(`%${brand}%`); }
    if (search) { conditions.push(`p.name ILIKE $${pi++}`); params.push(`%${search}%`); }
    if (promo_only === 'true') { conditions.push(`(p.is_promo = true OR p.discount_percent > 0)`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`
      SELECT p.name, p.brand, p.price_usd, p.price_original, p.discount_percent,
             p.in_stock, p.is_promo, p.promo_label, p.image_url, p.product_url,
             p.external_id, s.name as store_name, c.name as category_name,
             p.first_seen_at, p.updated_at
      FROM products p LEFT JOIN stores s ON p.store_id = s.id LEFT JOIN categories c ON p.category_id = c.id
      ${where} ORDER BY s.name, p.name LIMIT $${pi}
    `, [...params, parseInt(limit)]);

    if (format === 'csv') {
      const headers = ['name','brand','price_usd','price_original','discount_percent','in_stock','is_promo','promo_label','image_url','product_url','external_id','store_name','category_name','first_seen_at','updated_at'];
      const csvRows = [headers.join(';')];
      for (const row of result.rows) {
        csvRows.push(headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const s = String(val);
          return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(';'));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=compras-paraguai-export.csv');
      return res.send('\uFEFF' + csvRows.join('\n'));
    }

    res.json({ data: result.rows, total: result.rows.length, exported_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== SCRAPE ====================

router.get('/scrape/logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sl.*, s.name as store_name, s.slug as store_slug
      FROM scrape_logs sl LEFT JOIN stores s ON sl.store_id = s.id
      ORDER BY sl.finished_at DESC LIMIT 100
    `);
    res.json({ recent_logs: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/scrape/status - Estado atual dos scrapers (em memória)
router.get('/scrape/status', (req, res) => {
  res.json(tracker.getStatus());
});

// GET /api/scrape/status/:store - Logs de um scraper específico
router.get('/scrape/status/:store', (req, res) => {
  res.json({ slug: req.params.store, logs: tracker.getLogs(req.params.store) });
});

// Função helper pra rodar scraper com tracking
async function runScraperTracked(slug) {
  if (tracker.isRunning(slug)) return;
  tracker.start(slug);
  try {
    tracker.log(slug, 'Criando scraper...');
    const scraper = createScraper(slug);
    tracker.log(slug, 'Scraper criado, verificando browser...');

    // Interceptar console do scraper
    const origLog = console.log;
    const origErr = console.error;
    const logFn = (...args) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      if (msg.includes(slug) || msg.includes(scraper.storeSlug || '')) {
        tracker.log(slug, msg.replace(/\[.*?\]\s*/, '').substring(0, 200));
        const m = msg.match(/(\d+)\s*produtos?/i);
        if (m) tracker.update(slug, { products_found: parseInt(m[1]) });
      }
      origLog.apply(console, args);
    };
    const errFn = (...args) => {
      const msg = args.map(a => typeof a === 'object' ? (a.message || JSON.stringify(a)) : String(a)).join(' ');
      tracker.log(slug, 'ERRO: ' + msg.substring(0, 300));
      tracker.update(slug, { errors: (tracker.running[slug]?.errors || 0) + 1 });
      origErr.apply(console, args);
    };
    console.log = logFn;
    console.error = errFn;

    tracker.log(slug, 'Iniciando run()...');
    await scraper.run();

    console.log = origLog;
    console.error = origErr;

    const found = scraper.stats?.found || 0;
    const errors = scraper.stats?.errors || 0;
    tracker.log(slug, `Finalizado: ${found} encontrados, ${errors} erros`);
    tracker.finish(slug, found > 0 ? 'success' : 'empty', {
      products_found: found,
      products_new: scraper.stats?.new || 0,
      products_updated: scraper.stats?.updated || 0,
      scrape_errors: errors,
    });
  } catch (err) {
    // Restaurar console
    if (console.log !== console.log) { /* already restored */ }
    tracker.log(slug, 'CRASH: ' + (err.message || String(err)).substring(0, 500));
    tracker.log(slug, 'Stack: ' + (err.stack || '').substring(0, 300));
    tracker.finish(slug, 'error', { error: err.message });
  }
}

router.post('/scrape/:store', async (req, res) => {
  const { store } = req.params;
  const available = getAvailableScrapers();

  if (store === 'all') {
    const alreadyRunning = available.filter(s => tracker.isRunning(s));
    if (alreadyRunning.length > 5) {
      return res.json({ message: `${alreadyRunning.length} scrapers já rodando, aguarde`, running: alreadyRunning });
    }
    const toRun = available.filter(s => !tracker.isRunning(s));
    res.json({ message: `Iniciando ${toRun.length} scrapers em sequência`, stores: toRun });
    // Rodar em sequência pra não sobrecarregar
    (async () => {
      for (const s of toRun) {
        await runScraperTracked(s);
      }
    })();
    return;
  }

  if (!available.includes(store)) {
    return res.status(404).json({ error: `Loja não encontrada. Disponíveis: ${available.join(', ')}` });
  }

  if (tracker.isRunning(store)) {
    return res.json({ message: `${store} já está rodando`, logs: tracker.getLogs(store) });
  }

  res.json({ message: `Scraping ${store} iniciado` });
  runScraperTracked(store);
});

module.exports = router;

// ==================== ENGAGEMENT ====================

// GET /api/autocomplete?q= - Autocomplete rápido
router.get('/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const cacheKey = 'ac:' + q.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const result = await pool.query(`
      SELECT DISTINCT ON (lower(name)) name, brand, MIN(price_usd)::numeric(10,2) as min_price,
        COUNT(*)::int as store_count, MIN(image_url) as image_url, MIN(id) as id
      FROM products
      WHERE name ILIKE $1 AND price_usd IS NOT NULL
      GROUP BY lower(name), name, brand
      ORDER BY lower(name), store_count DESC
      LIMIT 10
    `, [`%${q}%`]);
    cache.set(cacheKey, result.rows);
    res.json(result.rows);
  } catch (err) { res.json([]); }
});

// GET /api/trending - Produtos mais vistos/comparados (por freshness e popularidade)
router.get('/trending', cached('trending', 120000), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.brand, p.price_usd, p.price_original, p.discount_percent,
             p.image_url, p.product_url, p.is_promo, p.promo_label, p.in_stock,
             s.name as store_name, s.slug as store_slug,
             (SELECT COUNT(*) FROM products p2
              WHERE p2.brand = p.brand AND p2.store_id != p.store_id AND p2.price_usd IS NOT NULL) as cross_store_count
      FROM products p
      LEFT JOIN stores s ON p.store_id = s.id
      WHERE p.price_usd IS NOT NULL AND p.in_stock = true
      ORDER BY
        CASE WHEN p.is_promo THEN 0 ELSE 1 END,
        p.discount_percent DESC NULLS LAST,
        p.updated_at DESC
      LIMIT 30
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/products/:id/similar - Produtos similares
router.get('/products/:id/similar', async (req, res) => {
  try {
    const product = await pool.query('SELECT name, brand, price_usd, store_id FROM products WHERE id = $1', [req.params.id]);
    if (!product.rows.length) return res.json([]);
    const { name, brand, price_usd, store_id } = product.rows[0];

    const result = await pool.query(`
      SELECT p.id, p.name, p.brand, p.price_usd, p.price_original, p.discount_percent,
             p.image_url, p.product_url, p.is_promo, p.in_stock,
             s.name as store_name, s.slug as store_slug,
             SIMILARITY(p.name, $1) as sim
      FROM products p
      LEFT JOIN stores s ON p.store_id = s.id
      WHERE p.id != $2
        AND p.price_usd IS NOT NULL
        AND (p.name % $1 OR p.brand = $3)
      ORDER BY sim DESC, ABS(COALESCE(p.price_usd,0) - COALESCE($4::numeric,0)) ASC
      LIMIT 12
    `, [name, req.params.id, brand, price_usd]);
    res.json(result.rows);
  } catch (err) { res.json([]); }
});

// GET /api/products/:id/price-rank - Ranking de preço entre lojas
router.get('/products/:id/price-rank', async (req, res) => {
  try {
    const product = await pool.query('SELECT name, brand, price_usd FROM products WHERE id = $1', [req.params.id]);
    if (!product.rows.length) return res.json({});
    const { name, price_usd } = product.rows[0];

    const result = await pool.query(`
      SELECT p.id, p.price_usd, s.name as store_name, s.slug as store_slug, p.product_url,
             p.is_promo, p.discount_percent
      FROM products p LEFT JOIN stores s ON p.store_id = s.id
      WHERE p.name % $1 AND p.price_usd IS NOT NULL
      ORDER BY p.price_usd ASC
    `, [name]);

    const history = await pool.query(`
      SELECT MIN(price_usd)::numeric(10,2) as all_time_low,
             MAX(price_usd)::numeric(10,2) as all_time_high,
             AVG(price_usd)::numeric(10,2) as avg_price
      FROM price_history WHERE product_id = $1
    `, [req.params.id]);

    res.json({
      current_price: price_usd,
      rank: result.rows.findIndex(r => r.id === parseInt(req.params.id)) + 1,
      total_stores: result.rows.length,
      all_prices: result.rows,
      history_stats: history.rows[0] || {},
      is_lowest: history.rows[0]?.all_time_low && parseFloat(price_usd) <= parseFloat(history.rows[0].all_time_low),
    });
  } catch (err) { res.json({}); }
});

// GET /api/deals - Melhores ofertas do dia (curadoria automática)
router.get('/deals', cached('deals', 300000), async (req, res) => {
  try {
    const result = await pool.query(`
      (SELECT p.*, s.name as store_name, s.slug as store_slug, 'biggest_discount' as deal_type
       FROM products p LEFT JOIN stores s ON p.store_id = s.id
       WHERE p.discount_percent > 10 AND p.in_stock = true AND p.price_usd IS NOT NULL
       ORDER BY p.discount_percent DESC LIMIT 10)
      UNION ALL
      (SELECT p.*, s.name as store_name, s.slug as store_slug, 'new_arrival' as deal_type
       FROM products p LEFT JOIN stores s ON p.store_id = s.id
       WHERE p.first_seen_at > NOW() - INTERVAL '48 hours' AND p.in_stock = true AND p.price_usd IS NOT NULL
       ORDER BY p.first_seen_at DESC LIMIT 10)
      UNION ALL
      (SELECT p.*, s.name as store_name, s.slug as store_slug, 'price_drop' as deal_type
       FROM products p LEFT JOIN stores s ON p.store_id = s.id
       WHERE p.id IN (
         SELECT DISTINCT product_id FROM price_history
         WHERE recorded_at > NOW() - INTERVAL '24 hours'
       ) AND p.in_stock = true
       ORDER BY p.updated_at DESC LIMIT 10)
    `);

    const grouped = { biggest_discount: [], new_arrival: [], price_drop: [] };
    result.rows.forEach(r => { if (grouped[r.deal_type]) grouped[r.deal_type].push(r); });
    res.json(grouped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PONTE & COTAÇÃO ====================

// GET /api/cotacao - Cotação USD/BRL/PYG em tempo real
router.get('/cotacao', async (req, res) => {
  try {
    const cacheKey = 'cotacao';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // AwesomeAPI
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const r = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL,USD-PYG,BRL-PYG', { signal: controller.signal });
    clearTimeout(timeout);
    const data = await r.json();

    const result = {
      USD_BRL: { bid: parseFloat(data.USDBRL?.bid || 0), ask: parseFloat(data.USDBRL?.ask || 0), timestamp: data.USDBRL?.timestamp },
      USD_PYG: { bid: parseFloat(data.USDPYG?.bid || 0), ask: parseFloat(data.USDPYG?.ask || 0), timestamp: data.USDPYG?.timestamp },
      BRL_PYG: { bid: parseFloat(data.BRLPYG?.bid || 0), ask: parseFloat(data.BRLPYG?.ask || 0), timestamp: data.BRLPYG?.timestamp },
      updated_at: new Date().toISOString(),
      source: 'AwesomeAPI',
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    // Fallback com valores estimados
    res.json({
      USD_BRL: { bid: 5.30, ask: 5.32 },
      USD_PYG: { bid: 7800, ask: 7850 },
      BRL_PYG: { bid: 1470, ask: 1480 },
      updated_at: new Date().toISOString(),
      source: 'fallback',
      error: err.message,
    });
  }
});

// GET /api/ponte-status - Status completo da ponte
router.get('/ponte-status', async (req, res) => {
  try {
    const cacheKey = 'ponte-status';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Buscar cotação
    let cotacao = {};
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL,USD-PYG,BRL-PYG', { signal: controller.signal });
      clearTimeout(timeout);
      const data = await r.json();
      cotacao = {
        usd_brl: parseFloat(data.USDBRL?.bid || 5.30),
        usd_pyg: parseFloat(data.USDPYG?.bid || 7800),
        brl_pyg: parseFloat(data.BRLPYG?.bid || 1470),
      };
    } catch (_) {
      cotacao = { usd_brl: 5.30, usd_pyg: 7800, brl_pyg: 1470 };
    }

    const result = {
      cotacao,
      cameras: [
        {
          id: 'ponte-paraguai',
          name: 'Ponte da Amizade - Sentido Paraguai',
          source: 'Portal da Cidade',
          type: 'stream',
          url: 'https://playerv.logicahost.com.br/video-ip-camera/portovelhomamore//true/true/V2tjeGMyRXhjRmhQU0dSUFVYcFdlbGxxU210alJtdDVVbTA1YVUwd05IZFVSekZQWkcxS1ZFNVhiR3BhZWpBNStS/16:9/V1ZWb1UwMUhUa2xVVkZwTlpWUm5PUT09K1I=/fozpontedaamizadesentidoparaguai.stream/',
        },
        {
          id: 'ponte-brasil',
          name: 'Ponte da Amizade - Sentido Brasil',
          source: 'Portal da Cidade',
          type: 'stream',
          url: 'https://playerv.logicahost.com.br/video-ip-camera/portovelhomamore//true/true/V2tjeGMyRXhjRmhQU0dSUFVYcFdlbGxxU210alJtdDVVbTA1YVUwd05IZFVSekZQWkcxS1ZFNVhiR3BhZWpBNStS/16:9/V1ZWb1UwMUhUa2xVVkZwTlpWUm5PUT09K1I=/fozpontedaamizadesentidobrasil.stream/',
        },
        {
          id: 'br277-aduana',
          name: 'BR-277 - Aduana',
          source: 'Portal da Cidade',
          type: 'stream',
          url: 'https://playerv.logicahost.com.br/video-ip-camera/portovelhomamore//true/true/dmlkZW8wNC5sb2dpY2Fob3N0LmNvbS5icisx/16:9/YUhSMGNITTZMeTg9K1o=/fozaduanapontedaamizade.stream/',
        },
        {
          id: 'br277-viaduto',
          name: 'BR-277 - Viaduto Brasil',
          source: 'Portal da Cidade',
          type: 'stream',
          url: 'https://playerv.logicahost.com.br/video-ip-camera/portaldacidade//true/true/V2tjeGMyRXhjRmhQU0dST1lWUldlbGxxU210alJtdDVVbTA1YVUwd05IZFVSekZQWkcxS1ZFNVhiR3BhZWpBNStS/16:9/V1ZWb1UwMUhUa2xVVkZwTlpWUm5PUT09K1I=/fozsentidopontedaamizade01.stream/',
        },
        {
          id: 'atacado-ponte',
          name: 'Vista da Ponte - Atacado Connect',
          source: 'Atacado Connect',
          type: 'stream',
          url: 'https://playerv.logicahost.com.br/video-ip-camera/brimostech//true/true/Wkcxc2ExcFhPSGROYVRWellqSmtjRmt5Um05aU0wNHdURzFPZG1KVE5XbGpaejA5KzM=/16:9/WVVoU01HTklUVFpNZVRnOSsz/camatg01.stream/',
        },
        {
          id: 'mega-cruzamento',
          name: 'Mega Eletrônicos - Cruzamento',
          source: 'Mega Eletrônicos',
          type: 'iframe',
          url: 'https://megacruzamento.netlify.app/',
        },
        {
          id: 'mega-ponte',
          name: 'Mega Eletrônicos - Vista da Ponte',
          source: 'Mega Eletrônicos',
          type: 'iframe',
          url: 'https://megaeletronicosponte.netlify.app/',
        },
        {
          id: 'youtube-live',
          name: 'CDE AO VIVO - Câmeras',
          source: 'YouTube',
          type: 'youtube',
          url: 'https://www.youtube.com/embed/szur4H43bKk?autoplay=1&mute=1',
          video_id: 'szur4H43bKk',
        },
      ],
      telegram_bot: 'https://t.me/agentecdeaovivo_bot',
      cde_ao_vivo: 'https://cdeaovivo.com/',
      updated_at: new Date().toISOString(),
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diagnostics - Verificar se Playwright/Chromium funciona
router.get('/diagnostics', async (req, res) => {
  const diag = { node: process.version, platform: process.platform, arch: process.arch, memory: {} };

  // Memória
  const mem = process.memoryUsage();
  diag.memory = { rss: Math.round(mem.rss/1024/1024)+'MB', heap: Math.round(mem.heapUsed/1024/1024)+'MB' };

  // Verificar Playwright
  try {
    const { chromium } = require('playwright');
    diag.playwright = 'installed';
    diag.chromium_path = process.env.CHROMIUM_PATH || 'auto';

    // Tentar lançar browser
    try {
      const launchOpts = { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] };
      if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
      const browser = await chromium.launch(launchOpts);
      const version = browser.version();
      await browser.close();
      diag.chromium_launch = 'OK';
      diag.chromium_version = version;
    } catch (e) {
      diag.chromium_launch = 'FAILED';
      diag.chromium_error = e.message;
    }
  } catch (e) {
    diag.playwright = 'NOT_INSTALLED';
    diag.playwright_error = e.message;
  }

  // Verificar banco
  try {
    const r = await pool.query('SELECT NOW() as t, (SELECT COUNT(*) FROM stores) as stores');
    diag.database = 'OK';
    diag.db_stores = parseInt(r.rows[0].stores);
  } catch (e) {
    diag.database = 'FAILED';
    diag.db_error = e.message;
  }

  // Verificar env
  diag.env = {
    NODE_ENV: process.env.NODE_ENV || 'not set',
    PORT: process.env.PORT || 'not set',
    DATABASE_URL: process.env.DATABASE_URL ? 'set (hidden)' : 'NOT SET',
    CHROMIUM_PATH: process.env.CHROMIUM_PATH || 'not set',
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || 'not set',
  };

  res.json(diag);
});
