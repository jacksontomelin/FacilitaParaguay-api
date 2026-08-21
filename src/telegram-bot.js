const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('./database');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.log('[BOT] TELEGRAM_BOT_TOKEN não configurado, bot desativado'); module.exports = { start: () => {} }; return; }

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('[BOT] Telegram bot iniciado');

// ==================== COMANDOS ====================

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🔍 *FacilitaParaguay*\n` +
    `Busca de Produtos no Paraguai\n\n` +
    `Comandos disponíveis:\n\n` +
    `🔎 /buscar _produto_ — Buscar produto\n` +
    `⚖️ /comparar _produto_ — Comparar preços entre lojas\n` +
    `🏷️ /promos — Melhores promoções\n` +
    `📉 /alertas — Produtos que baixaram de preço\n` +
    `🌉 /ponte — Câmeras e cotação da ponte\n` +
    `💰 /cotacao — Câmbio USD/BRL/PYG\n` +
    `🧮 /calcular _valor_ — Calculadora de importação\n` +
    `📊 /stats — Estatísticas do sistema\n` +
    `🏪 /lojas — Lista de lojas monitoradas\n\n` +
    `Ou simplesmente *digite o nome de um produto* que eu busco pra você!`,
    { parse_mode: 'Markdown' }
  );
});

// ==================== BUSCAR ====================

bot.onText(/\/buscar (.+)/, async (msg, match) => {
  const query = match[1].trim();
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🔍 Buscando "${query}"...`);

  try {
    const r = await fetch(`${API_BASE}/api/products?search=${encodeURIComponent(query)}&limit=10&sort=price_asc&in_stock=true`);
    const data = await r.json();

    if (!data.products?.length) {
      return bot.sendMessage(chatId, `Nenhum produto encontrado para "${query}"`);
    }

    let text = `🔍 *${data.total} resultados* para "${query}"\n\n`;
    data.products.slice(0, 8).forEach((p, i) => {
      const price = p.price_usd ? `US$ ${parseFloat(p.price_usd).toFixed(2)}` : 'Consultar';
      const disc = p.discount_percent ? ` (-${p.discount_percent}%)` : '';
      text += `${i + 1}. *${esc(p.name.substring(0, 80))}*\n`;
      text += `   💰 ${price}${disc} — ${p.store_name}\n`;
      if (p.brand) text += `   🏷️ ${p.brand}\n`;
      text += `   [Ver na loja](${p.product_url})\n\n`;
    });

    if (data.total > 8) text += `_...e mais ${data.total - 8} resultados_`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (e) {
    bot.sendMessage(chatId, `Erro ao buscar: ${e.message}`);
  }
});

// ==================== COMPARAR ====================

bot.onText(/\/comparar (.+)/, async (msg, match) => {
  const query = match[1].trim();
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `⚖️ Comparando "${query}" em 20 lojas...`);

  try {
    const r = await fetch(`${API_BASE}/api/compare?search=${encodeURIComponent(query)}`);
    const data = await r.json();

    if (!data.groups?.length) {
      return bot.sendMessage(chatId, `Nenhum resultado para comparação de "${query}"`);
    }

    let text = `⚖️ *Comparação: "${query}"*\n\n`;
    data.groups.slice(0, 5).forEach(g => {
      text += `📦 *${esc(g.name.substring(0, 60))}*\n`;
      g.stores.slice(0, 5).forEach((s, i) => {
        const marker = i === 0 ? '🏆' : '  ';
        text += `${marker} ${s.store}: *US$ ${s.price.toFixed(2)}*${s.is_promo ? ' 🏷️' : ''}\n`;
      });
      if (g.savings > 0) text += `💰 Economia: US$ ${g.savings.toFixed(2)}\n`;
      text += '\n';
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `Erro ao comparar: ${e.message}`);
  }
});

// ==================== PROMOS ====================

bot.onText(/\/promos/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const r = await fetch(`${API_BASE}/api/promotions?limit=10&min_discount=10`);
    const data = await r.json();

    if (!data.promotions?.length) {
      return bot.sendMessage(chatId, 'Nenhuma promoção ativa no momento');
    }

    let text = `🏷️ *Top Promoções* (${data.total} encontradas)\n\n`;
    data.promotions.slice(0, 10).forEach((p, i) => {
      text += `${i + 1}. *-${p.discount_percent}%* ${esc(p.name.substring(0, 60))}\n`;
      text += `   US$ ${parseFloat(p.price_usd).toFixed(2)}`;
      if (p.price_original) text += ` ~~US$ ${parseFloat(p.price_original).toFixed(2)}~~`;
      text += ` — ${p.store_name}\n\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (e) {
    bot.sendMessage(chatId, `Erro: ${e.message}`);
  }
});

// ==================== ALERTAS ====================

bot.onText(/\/alertas/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const r = await fetch(`${API_BASE}/api/alerts/price-drops?hours=24&min_drop=5`);
    const data = await r.json();

    if (!data.drops?.length) {
      return bot.sendMessage(chatId, '📉 Nenhuma queda de preço nas últimas 24h');
    }

    let text = `📉 *Quedas de preço (24h)*\n\n`;
    data.drops.slice(0, 10).forEach(d => {
      text += `🔻 *-${d.drop_percent}%* ${esc(d.name?.substring(0, 55))}\n`;
      text += `   US$ ${d.old_price} → *US$ ${d.new_price}* (${d.store_name})\n\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `Erro: ${e.message}`);
  }
});

// ==================== PONTE ====================

bot.onText(/\/ponte/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const r = await fetch(`${API_BASE}/api/ponte-status`);
    const data = await r.json();
    const c = data.cotacao || {};

    // Cotação primeiro
    let text = `🌉 *Ponte da Amizade*\n\n`;
    text += `💱 *Cotação agora:*\n`;
    text += `   USD/BRL: *R$ ${c.usd_brl?.toFixed(2) || '--'}*\n`;
    text += `   USD/PYG: *Gs ${Math.round(c.usd_pyg || 0).toLocaleString()}*\n`;
    text += `   BRL/PYG: *Gs ${Math.round(c.brl_pyg || 0).toLocaleString()}*\n`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

    // Enviar thumbnails das câmeras
    const cams = data.cameras || [];
    for (const cam of cams) {
      let thumbUrl = null;
      let streamUrl = cam.url;

      // YouTube: thumbnail direto
      if (cam.video_id) {
        thumbUrl = `https://img.youtube.com/vi/${cam.video_id}/hqdefault.jpg`;
      } else if (cam.type === 'youtube' && cam.url.includes('embed/')) {
        const vid = cam.url.match(/embed\/([^?]+)/)?.[1];
        if (vid) thumbUrl = `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
      }

      if (thumbUrl) {
        try {
          await bot.sendPhoto(chatId, thumbUrl, {
            caption: `📹 *${cam.name}*\n${cam.source}\n\n[Assistir ao vivo](${cam.url})`,
            parse_mode: 'Markdown',
          });
        } catch (_) {
          // Se thumbnail falhar, manda só texto
          await bot.sendMessage(chatId, `📹 *${cam.name}*\n${cam.source}\n[Assistir](${cam.url})`, { parse_mode: 'Markdown', disable_web_page_preview: true });
        }
      } else {
        // Câmeras sem thumbnail: manda link com preview
        await bot.sendMessage(chatId, `📹 *${cam.name}*\n${cam.source}\n[Assistir ao vivo](${cam.url})`, { parse_mode: 'Markdown' });
      }

      await new Promise(r => setTimeout(r, 300)); // Não spammar
    }

    await bot.sendMessage(chatId, `🔗 [CDE ao Vivo \\- Todas as câmeras](${data.cde_ao_vivo})\n🤖 [Bot alertas trânsito](${data.telegram_bot})`, { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
  } catch (e) {
    bot.sendMessage(chatId, `Erro: ${e.message}`);
  }
});

// ==================== COTAÇÃO ====================

bot.onText(/\/cotacao/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const r = await fetch(`${API_BASE}/api/cotacao`);
    const data = await r.json();

    let text = `💱 *Cotação em tempo real*\n\n`;
    text += `🇺🇸 USD → 🇧🇷 BRL\n`;
    text += `   Compra: *R$ ${data.USD_BRL?.bid?.toFixed(4)}*\n`;
    text += `   Venda: *R$ ${data.USD_BRL?.ask?.toFixed(4)}*\n\n`;
    text += `🇺🇸 USD → 🇵🇾 PYG\n`;
    text += `   Compra: *Gs ${Math.round(data.USD_PYG?.bid || 0).toLocaleString()}*\n`;
    text += `   Venda: *Gs ${Math.round(data.USD_PYG?.ask || 0).toLocaleString()}*\n\n`;
    text += `🇧🇷 BRL → 🇵🇾 PYG\n`;
    text += `   Compra: *Gs ${Math.round(data.BRL_PYG?.bid || 0).toLocaleString()}*\n`;
    text += `   Venda: *Gs ${Math.round(data.BRL_PYG?.ask || 0).toLocaleString()}*\n\n`;
    text += `_Fonte: ${data.source}_`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `Erro: ${e.message}`);
  }
});

// ==================== CALCULAR ====================

bot.onText(/\/calcular (\d+[\.,]?\d*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const priceUsd = parseFloat(match[1].replace(',', '.'));
  const dolar = 5.30; // TODO: puxar cotação real
  const iof = 3.38;

  const totalBrl = priceUsd * dolar;
  const iofVal = totalBrl * (iof / 100);
  const excess = Math.max(0, priceUsd - 500);
  const tax = excess * dolar * 0.5;
  const total = totalBrl + iofVal + tax;

  let text = `🧮 *Calculadora de Importação*\n\n`;
  text += `Produto: *US$ ${priceUsd.toFixed(2)}*\n`;
  text += `Câmbio: R$ ${dolar.toFixed(2)}\n\n`;
  text += `Em reais: R$ ${totalBrl.toFixed(2)}\n`;
  text += `IOF ${iof}%: R$ ${iofVal.toFixed(2)}\n`;
  if (excess > 0) {
    text += `Imposto 50% (excedente US$ ${excess.toFixed(2)}): R$ ${tax.toFixed(2)}\n`;
  } else {
    text += `Dentro da cota US$ 500 ✅\n`;
  }
  text += `\n💰 *Total: R$ ${total.toFixed(2)}*`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// ==================== STATS ====================

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    const data = await r.json();

    let text = `📊 *FacilitaParaguay - Estatísticas*\n\n`;
    text += `📦 Produtos: *${data.total_products?.toLocaleString()}*\n`;
    text += `🏪 Lojas: *${data.total_stores}*\n`;
    text += `Status: *${data.status}*\n\n`;
    text += `*Por loja:*\n`;
    data.scrapers?.sort((a, b) => (b.products_found || 0) - (a.products_found || 0)).forEach(s => {
      const icon = s.products_found > 0 ? '✅' : '⚠️';
      text += `${icon} ${s.name}: ${s.products_found?.toLocaleString() || 0}\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `Erro: ${e.message}`);
  }
});

// ==================== LOJAS ====================

bot.onText(/\/lojas/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const r = await fetch(`${API_BASE}/api/stores`);
    const stores = await r.json();

    let text = `🏪 *20 Lojas Monitoradas*\n\n`;
    stores.sort((a, b) => (parseInt(b.product_count) || 0) - (parseInt(a.product_count) || 0)).forEach(s => {
      const count = parseInt(s.product_count) || 0;
      const icon = count > 0 ? '🟢' : '🔴';
      text += `${icon} *${s.name}*: ${count.toLocaleString()} produtos\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `Erro: ${e.message}`);
  }
});

// ==================== BUSCA LIVRE (texto sem comando) ====================

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return; // Ignorar comandos
  if (!msg.text || msg.text.length < 3) return;

  const query = msg.text.trim();
  const chatId = msg.chat.id;

  try {
    const r = await fetch(`${API_BASE}/api/products?search=${encodeURIComponent(query)}&limit=5&sort=price_asc&in_stock=true`);
    const data = await r.json();

    if (!data.products?.length) {
      return bot.sendMessage(chatId, `Nenhum resultado para "${query}"\n\nTente /buscar ${query} pra busca avançada`);
    }

    let text = `🔍 *${data.total} resultados* para "${esc(query)}"\n\n`;
    data.products.slice(0, 5).forEach((p, i) => {
      const price = p.price_usd ? `US$ ${parseFloat(p.price_usd).toFixed(2)}` : 'Consultar';
      text += `${i + 1}. *${esc(p.name.substring(0, 70))}*\n`;
      text += `   ${price} — ${p.store_name}\n`;
      text += `   [Ver](${p.product_url})\n\n`;
    });

    if (data.total > 5) text += `Use /buscar ${query} pra ver todos os ${data.total} resultados`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (e) {
    // Silencioso pra não spammar
  }
});

function esc(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

module.exports = { bot };
