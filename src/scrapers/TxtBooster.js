/**
 * Mixin pra adicionar suporte a lista TXT em scrapers dedicados.
 * Chama antes ou depois do scrape HTML pra complementar dados.
 */
async function scrapeTxtList(scraper, page, listUrl) {
  try {
    console.log(`[${scraper.storeSlug}] Baixando lista TXT: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
    await scraper.delay(2000);

    const content = await page.evaluate(() => document.body.innerText);
    if (!content || content.length < 100) {
      console.log(`[${scraper.storeSlug}] Lista TXT vazia ou inacessível`);
      return 0;
    }

    const catId = await scraper.upsertCategory('Lista de Preços TXT', 'lista-txt', null, listUrl);
    const lines = content.split('\n');
    let count = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 15) continue;
      if (trimmed.startsWith('---') || trimmed.startsWith('===')) continue;
      if (/^(CODIGO|LISTAGEM|INFORMAC|ATUALIZ)/i.test(trimmed)) continue;

      // Formato típico: CODIGO<espaços>NOME<espaços>DISPONIBILIDADE<espaços>US$ PREÇO
      // Detectar preço US$ no final
      const priceMatch = trimmed.match(/US\$\s*([\d.,]+)\s*$/i);
      if (!priceMatch) continue;

      let priceStr = priceMatch[1];
      // Parse preço
      if (priceStr.includes('.') && priceStr.includes(',')) {
        priceStr = priceStr.replace(/\./g, '').replace(',', '.');
      } else if (priceStr.includes(',')) {
        priceStr = priceStr.replace(',', '.');
      }
      const priceUsd = parseFloat(priceStr);
      if (isNaN(priceUsd) || priceUsd <= 0) continue;

      // Extrair código e nome
      const withoutPrice = trimmed.replace(/US\$\s*[\d.,]+\s*$/, '').trim();
      // Remover status (EM ESTOQUE, SEM ESTOQUE, FORA DE ESTOQUE, etc)
      const withoutStatus = withoutPrice
        .replace(/\s+(EM ESTOQUE|SEM ESTOQUE|FORA DE ESTOQUE|INDISPONIVEL|DISPONIVEL|SOB CONSULTA)\s*$/i, '')
        .trim();

      const inStock = /EM ESTOQUE|DISPONIVEL/i.test(withoutPrice);

      // Código = primeiros dígitos, Nome = resto
      const codeMatch = withoutStatus.match(/^(\d{3,})\s+(.+)/);
      let code = '', name = '';
      if (codeMatch) {
        code = codeMatch[1];
        name = codeMatch[2].trim();
      } else {
        name = withoutStatus;
      }

      if (!name || name.length < 5) continue;

      const slug = code || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80);

      await scraper.upsertProduct({
        name: name.substring(0, 500),
        slug,
        external_id: code || slug,
        price_usd: priceUsd,
        price_original: null,
        discount_percent: null,
        currency: 'USD',
        brand: extractSimpleBrand(name),
        image_url: '',
        product_url: `${scraper.baseUrl || scraper.config?.baseUrl || ''}#${code}`,
        category_id: catId,
        in_stock: inStock,
        specs: {},
      });
      count++;
    }

    console.log(`[${scraper.storeSlug}] ${count} produtos da lista TXT`);
    return count;
  } catch (err) {
    console.error(`[${scraper.storeSlug}] Erro lista TXT: ${err.message}`);
    scraper.stats.errors++;
    return 0;
  }
}

function extractSimpleBrand(name) {
  const brands = [
    'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'REALME', 'NOKIA', 'HUAWEI',
    'JBL', 'SONY', 'BOSE', 'LG', 'CANON', 'NIKON', 'GOPRO', 'DJI',
    'GARMIN', 'ASUS', 'MSI', 'ACER', 'LENOVO', 'DELL', 'HP',
    'INTEL', 'AMD', 'CORSAIR', 'LOGITECH', 'RAZER',
    'PLAYSTATION', 'NINTENDO', 'XBOX', 'AMAZON',
    'NIKE', 'ADIDAS', 'TOMMY HILFIGER', 'CALVIN KLEIN',
    'CAROLINA HERRERA', 'PACO RABANNE', 'HUGO BOSS',
    'EPSON', 'BROTHER', 'TP-LINK', 'SANDISK', 'KINGSTON',
  ];
  const upper = name.toUpperCase();
  for (const b of brands) {
    if (upper.startsWith(b + ' ') || upper.includes(' ' + b + ' ')) return b;
  }
  const first = name.split(' ')[0];
  if (first.length >= 2 && first === first.toUpperCase() && /^[A-Z]/.test(first)) return first;
  return null;
}

module.exports = { scrapeTxtList };
