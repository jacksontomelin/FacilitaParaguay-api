const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.log('[BOT] TELEGRAM_BOT_TOKEN não configurado'); module.exports = {}; return; }

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const bot = new TelegramBot(TOKEN, { polling: true });
console.log('[BOT] Telegram bot FacilitaParaguay iniciado');

const H = 'HTML'; // parse mode

// Helper: fetch API
async function api(path) {
  const r = await fetch(`${API_BASE}/api${path}`);
  return r.json();
}

// Helper: formatar preço
function $(v) { return v ? `US$ ${parseFloat(v).toFixed(2)}` : 'Consultar'; }
function R$(v) { return `R$ ${parseFloat(v).toFixed(2)}`; }

// ==================== /start ====================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    `<b>🔍 FacilitaParaguay</b>`,
    `<i>Busca de Produtos no Paraguai</i>`,
    ``,
    `<b>Comandos:</b>`,
    `🔎 /buscar <i>produto</i> — Buscar nas 20 lojas`,
    `⚖️ /comparar <i>produto</i> — Menor preço entre lojas`,
    `🏷️ /promos — Melhores descontos agora`,
    `📉 /alertas — Preços que caíram hoje`,
    `🌉 /ponte — Câmeras ao vivo + cotação`,
    `💱 /cotacao — Câmbio USD/BRL/PYG`,
    `🧮 /calc <i>valor</i> — Quanto vou pagar no total?`,
    `📊 /stats — Números do sistema`,
    `🏪 /lojas — Lojas monitoradas`,
    ``,
    `💡 <b>Dica:</b> digite qualquer texto e eu busco pra você!`,
  ].join('\n'), { parse_mode: H });
});

// ==================== /buscar ====================
bot.onText(/\/buscar (.+)/, async (msg, match) => {
  const q = match[1].trim();
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `🔍 Buscando "<b>${esc(q)}</b>"...`, { parse_mode: H });

  try {
    const data = await api(`/products?search=${encodeURIComponent(q)}&limit=10&sort=price_asc&in_stock=true`);
    if (!data.products?.length) return bot.sendMessage(chatId, `Nada encontrado para "${esc(q)}"`);

    const lines = [`🔍 <b>${data.total} resultados</b> para "${esc(q)}"\n`];
    data.products.slice(0, 8).forEach((p, i) => {
      const disc = p.discount_percent ? ` <b>(-${p.discount_percent}%)</b>` : '';
      lines.push(`<b>${i+1}.</b> ${esc(p.name.substring(0,80))}`);
      lines.push(`   💰 <b>${$(p.price_usd)}</b>${disc}`);
      lines.push(`   🏪 ${esc(p.store_name)}${p.brand ? ' · '+esc(p.brand) : ''}`);
      lines.push(`   <a href="${p.product_url}">Ver na loja →</a>\n`);
    });
    if (data.total > 8) lines.push(`<i>...e mais ${data.total - 8} resultados</i>`);

    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(chatId, `Erro: ${e.message}`); }
});

// ==================== /comparar ====================
bot.onText(/\/comparar (.+)/, async (msg, match) => {
  const q = match[1].trim();
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `⚖️ Comparando "<b>${esc(q)}</b>" em 20 lojas...`, { parse_mode: H });

  try {
    const data = await api(`/compare?search=${encodeURIComponent(q)}`);
    if (!data.groups?.length) return bot.sendMessage(chatId, `Nenhum resultado para comparação`);

    const lines = [`⚖️ <b>Comparação de preços</b>\n`];
    data.groups.slice(0, 5).forEach(g => {
      lines.push(`📦 <b>${esc(g.name.substring(0,65))}</b>`);
      g.stores.slice(0, 6).forEach((s, i) => {
        const tag = i === 0 ? '🏆 ' : '     ';
        lines.push(`${tag}${esc(s.store)}: <b>${$(s.price)}</b>${s.is_promo ? ' 🏷️' : ''}`);
      });
      if (g.savings > 0) lines.push(`     💰 <b>Economia: ${$(g.savings)}</b>`);
      lines.push('');
    });

    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(chatId, `Erro: ${e.message}`); }
});

// ==================== /promos ====================
bot.onText(/\/promos/, async (msg) => {
  try {
    const data = await api('/promotions?limit=10&min_discount=10');
    if (!data.promotions?.length) return bot.sendMessage(msg.chat.id, 'Sem promoções acima de 10% agora');

    const lines = [`🏷️ <b>Top ${data.total} Promoções</b>\n`];
    data.promotions.slice(0, 10).forEach((p, i) => {
      lines.push(`<b>${i+1}. -${p.discount_percent}%</b> ${esc(p.name.substring(0,60))}`);
      lines.push(`   <b>${$(p.price_usd)}</b>${p.price_original ? ` <s>${$(p.price_original)}</s>` : ''}`);
      lines.push(`   🏪 ${esc(p.store_name)}`);
      lines.push(`   <a href="${p.product_url}">Ver oferta →</a>\n`);
    });

    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /alertas ====================
bot.onText(/\/alertas/, async (msg) => {
  try {
    const data = await api('/alerts/price-drops?hours=24&min_drop=5');
    if (!data.drops?.length) return bot.sendMessage(msg.chat.id, '📉 Sem quedas de preço nas últimas 24h');

    const lines = [`📉 <b>Quedas de preço (últimas 24h)</b>\n`];
    data.drops.slice(0, 10).forEach(d => {
      lines.push(`🔻 <b>-${d.drop_percent}%</b> ${esc(d.name?.substring(0,55))}`);
      lines.push(`   ${$(d.old_price)} → <b>${$(d.new_price)}</b>`);
      lines.push(`   🏪 ${esc(d.store_name)}\n`);
    });

    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /ponte ====================
bot.onText(/\/ponte/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const data = await api('/ponte-status');
    const c = data.cotacao || {};
    const cams = data.cameras || [];

    // 1. Enviar fotos das câmeras YouTube com cotação no primeiro
    const ytCams = cams.filter(cam => cam.video_id);
    let sentPhoto = false;

    for (const cam of ytCams) {
      const qualities = ['sddefault','hqdefault','mqdefault','default'];
      for (const q of qualities) {
        try {
          const caption = !sentPhoto
            ? `🌉 Ponte da Amizade - AO VIVO\n\n💱 Cotação:\nUSD/BRL: R$ ${c.usd_brl?.toFixed(2) || '--'}\nUSD/PYG: Gs ${Math.round(c.usd_pyg || 0).toLocaleString()}\nBRL/PYG: Gs ${Math.round(c.brl_pyg || 0).toLocaleString()}`
            : `📹 ${cam.name}`;
          await bot.sendPhoto(chatId, `https://img.youtube.com/vi/${cam.video_id}/${q}.jpg`, { caption });
          sentPhoto = true;
          await new Promise(r => setTimeout(r, 1500));
          break;
        } catch (_) {}
      }
    }

    // Se nenhuma foto funcionou, manda cotação como texto
    if (!sentPhoto) {
      await bot.sendMessage(chatId, [
        `🌉 <b>Ponte da Amizade</b>\n`,
        `💱 USD/BRL: <b>R$ ${c.usd_brl?.toFixed(2) || '--'}</b>`,
        `💱 USD/PYG: <b>Gs ${Math.round(c.usd_pyg || 0).toLocaleString()}</b>`,
        `💱 BRL/PYG: <b>Gs ${Math.round(c.brl_pyg || 0).toLocaleString()}</b>`,
      ].join('\n'), { parse_mode: H });
    }

    // 2. Lista de câmeras em UMA mensagem
    const lines = [`📹 <b>Câmeras ao vivo (${cams.length})</b>\n`];
    cams.forEach((cam, i) => {
      lines.push(`${i+1}. <b>${esc(cam.name)}</b>`);
      lines.push(`   <i>${esc(cam.source)}</i> — <a href="${cam.url}">Assistir</a>`);
    });
    lines.push('');
    lines.push(`🔗 <a href="${data.cde_ao_vivo || 'https://cdeaovivo.com'}">CDE ao Vivo - Todas</a>`);
    lines.push(`🤖 <a href="${data.telegram_bot || 'https://t.me/agentecdeaovivo_bot'}">Bot alertas trânsito</a>`);

    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(chatId, `Erro ao carregar ponte: ${e.message}`); }
});

// ==================== /cotacao ====================
bot.onText(/\/cotacao/, async (msg) => {
  try {
    const data = await api('/cotacao');
    const lines = [
      `💱 <b>Cotação em tempo real</b>\n`,
      `🇺🇸 <b>Dólar → Real</b>`,
      `   Compra: <b>R$ ${data.USD_BRL?.bid?.toFixed(4)}</b>`,
      `   Venda: <b>R$ ${data.USD_BRL?.ask?.toFixed(4)}</b>\n`,
      `🇺🇸 <b>Dólar → Guarani</b>`,
      `   Compra: <b>Gs ${Math.round(data.USD_PYG?.bid || 0).toLocaleString()}</b>`,
      `   Venda: <b>Gs ${Math.round(data.USD_PYG?.ask || 0).toLocaleString()}</b>\n`,
      `🇧🇷 <b>Real → Guarani</b>`,
      `   Compra: <b>Gs ${Math.round(data.BRL_PYG?.bid || 0).toLocaleString()}</b>`,
      `   Venda: <b>Gs ${Math.round(data.BRL_PYG?.ask || 0).toLocaleString()}</b>\n`,
      `<i>Fonte: ${data.source || 'AwesomeAPI'}</i>`,
    ];
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /calc ====================
bot.onText(/\/calc(?:ular)? (\d+[\.,]?\d*)/, async (msg, match) => {
  const priceUsd = parseFloat(match[1].replace(',', '.'));
  if (!priceUsd) return;

  // Puxar cotação real
  let dolar = 5.30;
  try {
    const cot = await api('/cotacao');
    if (cot.USD_BRL?.bid) dolar = cot.USD_BRL.bid;
  } catch (_) {}

  const iof = 3.38;
  const totalBrl = priceUsd * dolar;
  const iofVal = totalBrl * (iof / 100);
  const excess = Math.max(0, priceUsd - 500);
  const tax = excess * dolar * 0.5;
  const total = totalBrl + iofVal + tax;

  const lines = [
    `🧮 <b>Calculadora de Importação</b>\n`,
    `📦 Produto: <b>${$(priceUsd)}</b>`,
    `💱 Câmbio: <b>${R$(dolar)}</b> (tempo real)\n`,
    `Em reais: ${R$(totalBrl)}`,
    `IOF ${iof}%: ${R$(iofVal)}`,
    excess > 0
      ? `Imposto 50% (excedente ${$(excess)}): ${R$(tax)}`
      : `✅ Dentro da cota US$ 500`,
    ``,
    `💰 <b>Total: ${R$(total)}</b>`,
  ];

  bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
});

// ==================== /stats ====================
bot.onText(/\/stats/, async (msg) => {
  try {
    const data = await api('/health');
    const lines = [
      `📊 <b>FacilitaParaguay - Status</b>\n`,
      `📦 Produtos: <b>${(data.total_products || 0).toLocaleString()}</b>`,
      `🏪 Lojas: <b>${data.total_stores}</b>`,
      `🟢 Status: <b>${data.status}</b>\n`,
      `<b>Por loja:</b>`,
    ];
    (data.scrapers || [])
      .sort((a, b) => (b.products_found || 0) - (a.products_found || 0))
      .forEach(s => {
        const icon = (s.products_found || 0) > 0 ? '✅' : '⚠️';
        lines.push(`${icon} ${esc(s.name)}: <b>${(s.products_found || 0).toLocaleString()}</b>`);
      });

    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /lojas ====================
bot.onText(/\/lojas/, async (msg) => {
  try {
    const stores = await api('/stores');
    const lines = [`🏪 <b>${stores.length} Lojas Monitoradas</b>\n`];
    stores
      .sort((a, b) => (parseInt(b.product_count) || 0) - (parseInt(a.product_count) || 0))
      .forEach(s => {
        const c = parseInt(s.product_count) || 0;
        const promo = parseInt(s.promo_count) || 0;
        const icon = c > 0 ? '🟢' : '🔴';
        lines.push(`${icon} <b>${esc(s.name)}</b>: ${c.toLocaleString()} produtos${promo > 0 ? ` (${promo} promos)` : ''}`);
      });

    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== BUSCA LIVRE ====================
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.text.length < 3) return;
  const q = msg.text.trim();
  const chatId = msg.chat.id;

  try {
    const data = await api(`/products?search=${encodeURIComponent(q)}&limit=5&sort=price_asc&in_stock=true`);
    if (!data.products?.length) {
      return bot.sendMessage(chatId, `Nada encontrado para "${esc(q)}".\nTente /buscar ${esc(q)}`);
    }

    const lines = [`🔍 <b>${data.total} resultados</b> para "${esc(q)}"\n`];
    data.products.slice(0, 5).forEach((p, i) => {
      lines.push(`<b>${i+1}.</b> ${esc(p.name.substring(0,70))}`);
      lines.push(`   <b>${$(p.price_usd)}</b> — ${esc(p.store_name)}`);
      lines.push(`   <a href="${p.product_url}">Ver →</a>\n`);
    });
    if (data.total > 5) lines.push(`<i>Use /buscar ${esc(q)} pra ver todos</i>`);

    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (_) {}
});

// Escape HTML
function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

module.exports = { bot };
