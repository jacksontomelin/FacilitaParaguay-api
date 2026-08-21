const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.log('[BOT] TELEGRAM_BOT_TOKEN não configurado'); module.exports = {}; return; }

const API = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const bot = new TelegramBot(TOKEN, { polling: true });
const H = 'HTML';
console.log('[BOT] FacilitaParaguay Bot iniciado');

async function api(p) { return (await fetch(`${API}/api${p}`)).json(); }
function $(v) { return v ? `US$ ${parseFloat(v).toFixed(2)}` : 'Consultar'; }
function R$(v) { return `R$ ${parseFloat(v).toFixed(2)}`; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function num(n) { return (n||0).toLocaleString('pt-BR'); }

// ==================== /start ====================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    `<b>🔍 FacilitaParaguay</b>`,
    `<i>Monitor de preços de 20 lojas do Paraguai</i>\n`,
    `<b>📱 Busca e Compras</b>`,
    `/buscar <i>produto</i> — Buscar nas 20 lojas`,
    `/comparar <i>produto</i> — Menor preço entre lojas`,
    `/loja <i>nome</i> — Produtos de uma loja específica\n`,
    `<b>🏷️ Ofertas</b>`,
    `/promos — Melhores descontos agora`,
    `/alertas — Preços que caíram hoje`,
    `/trending — Produtos mais buscados`,
    `/novidades — Últimos produtos adicionados\n`,
    `<b>🌉 Ponte e Câmbio</b>`,
    `/ponte — Câmeras ao vivo + cotação`,
    `/cotacao — Câmbio USD/BRL/PYG detalhado`,
    `/calc <i>valor</i> — Calculadora de importação\n`,
    `<b>📊 Sistema</b>`,
    `/stats — Estatísticas completas`,
    `/lojas — Lojas monitoradas`,
    `/top — Ranking das lojas\n`,
    `💡 Ou simplesmente <b>digite qualquer produto</b>!`,
  ].join('\n'), { parse_mode: H });
});

// ==================== /buscar ====================
bot.onText(/\/buscar (.+)/, async (msg, match) => {
  const q = match[1].trim(), chatId = msg.chat.id;
  try {
    const data = await api(`/products?search=${encodeURIComponent(q)}&limit=10&sort=price_asc&in_stock=true`);
    if (!data.products?.length) return bot.sendMessage(chatId, `Nada encontrado para "${esc(q)}"`);

    const lines = [`🔍 <b>${num(data.total)} resultados</b> para "<b>${esc(q)}</b>"\n`];
    data.products.slice(0,8).forEach((p,i) => {
      const disc = p.discount_percent ? ` <b>(-${p.discount_percent}%)</b>` : '';
      lines.push(`<b>${i+1}.</b> ${esc(p.name.substring(0,80))}`);
      lines.push(`   💰 <b>${$(p.price_usd)}</b>${disc}${p.price_original && p.price_original > p.price_usd ? ' <s>'+$(p.price_original)+'</s>' : ''}`);
      lines.push(`   🏪 ${esc(p.store_name)}${p.brand ? ' · '+esc(p.brand) : ''}`);
      lines.push(`   <a href="${p.product_url}">Ver na loja →</a>\n`);
    });
    if (data.total > 8) lines.push(`<i>...e mais ${num(data.total-8)} resultados</i>`);
    lines.push(`\n💡 Use /comparar ${esc(q)} pra ver o menor preço`);
    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(chatId, `Erro: ${e.message}`); }
});

// ==================== /comparar ====================
bot.onText(/\/comparar (.+)/, async (msg, match) => {
  const q = match[1].trim(), chatId = msg.chat.id;
  try {
    const data = await api(`/compare?search=${encodeURIComponent(q)}`);
    if (!data.groups?.length) return bot.sendMessage(chatId, `Nenhum resultado para comparação`);

    const lines = [`⚖️ <b>Comparação de preços</b> — "${esc(q)}"\n`];
    data.groups.slice(0,5).forEach(g => {
      lines.push(`📦 <b>${esc(g.name.substring(0,65))}</b>`);
      g.stores.slice(0,6).forEach((s,i) => {
        const tag = i===0 ? '🏆' : '  •';
        const best = i===0 ? '<b>' : '';
        const bestEnd = i===0 ? '</b>' : '';
        lines.push(`${tag} ${esc(s.store)}: ${best}${$(s.price)}${bestEnd}${s.is_promo ? ' 🏷️' : ''}`);
      });
      if (g.savings > 0) lines.push(`   💰 Economia: <b>${$(g.savings)}</b>`);
      lines.push('');
    });
    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(chatId, `Erro: ${e.message}`); }
});

// ==================== /promos ====================
bot.onText(/\/promos/, async (msg) => {
  try {
    const[promos, stats] = await Promise.all([
      api('/promotions?limit=10&min_discount=15'),
      api('/promotions/stats'),
    ]);
    if (!promos.promotions?.length) return bot.sendMessage(msg.chat.id, 'Sem promoções acima de 15% agora');

    const totalPromos = stats.reduce((s,x) => s + (x.total_promos||0), 0);
    const lines = [`🏷️ <b>Top Promoções</b> (${num(totalPromos)} ativas)\n`];

    // Mini stats por loja
    const topStores = stats.sort((a,b) => (b.total_promos||0) - (a.total_promos||0)).slice(0,5);
    lines.push(`📊 ${topStores.map(s => `${esc(s.name)}: <b>${s.total_promos}</b>`).join(' · ')}\n`);

    promos.promotions.slice(0,10).forEach((p,i) => {
      lines.push(`<b>${i+1}. 🔥 -${p.discount_percent}%</b> ${esc(p.name.substring(0,55))}`);
      lines.push(`   <b>${$(p.price_usd)}</b> <s>${$(p.price_original)}</s>`);
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
    if (!data.drops?.length) return bot.sendMessage(msg.chat.id, '📉 Sem quedas nas últimas 24h');

    const lines = [`📉 <b>Quedas de preço (24h)</b> — ${data.drops.length} produtos\n`];
    data.drops.slice(0,12).forEach((d,i) => {
      lines.push(`${i+1}. 🔻 <b>-${d.drop_percent}%</b> ${esc(d.name?.substring(0,50))}`);
      lines.push(`   <s>${$(d.old_price)}</s> → <b>${$(d.new_price)}</b> (${esc(d.store_name)})\n`);
    });
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /trending ====================
bot.onText(/\/trending/, async (msg) => {
  try {
    const data = await api('/trending');
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Sem dados de trending');

    const lines = [`🔝 <b>Em Alta — Produtos Trending</b>\n`];
    data.slice(0,10).forEach((p,i) => {
      const medal = i<3 ? ['🥇','🥈','🥉'][i] : `${i+1}.`;
      lines.push(`${medal} <b>${esc(p.name?.substring(0,65))}</b>`);
      lines.push(`   💰 <b>${$(p.price_usd)}</b> — ${esc(p.store_name)}`);
      if (p.discount_percent) lines.push(`   🏷️ -${p.discount_percent}% off`);
      lines.push('');
    });
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /novidades ====================
bot.onText(/\/novidades/, async (msg) => {
  try {
    const data = await api('/products?sort=updated&limit=10&in_stock=true');
    if (!data.products?.length) return bot.sendMessage(msg.chat.id, 'Sem novidades');

    const lines = [`🆕 <b>Últimos Produtos Adicionados</b>\n`];
    data.products.slice(0,10).forEach((p,i) => {
      lines.push(`${i+1}. <b>${esc(p.name?.substring(0,65))}</b>`);
      lines.push(`   💰 <b>${$(p.price_usd)}</b> — ${esc(p.store_name)}`);
      lines.push(`   <a href="${p.product_url}">Ver →</a>\n`);
    });
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /loja ====================
bot.onText(/\/loja (.+)/, async (msg, match) => {
  const q = match[1].trim().toLowerCase(), chatId = msg.chat.id;
  try {
    const stores = await api('/stores');
    const store = stores.find(s => s.name.toLowerCase().includes(q) || s.slug.includes(q));
    if (!store) return bot.sendMessage(chatId, `Loja "${esc(q)}" não encontrada.\n\nLojas: ${stores.map(s=>esc(s.name)).join(', ')}`);

    const data = await api(`/products?store=${store.slug}&limit=10&sort=updated&in_stock=true`);
    const promos = await api(`/promotions?store=${store.slug}&limit=5`);

    const lines = [
      `🏪 <b>${esc(store.name)}</b>\n`,
      `📦 <b>${num(store.product_count)}</b> produtos`,
      `🏷️ <b>${num(store.promo_count)}</b> promoções\n`,
    ];

    if (promos.promotions?.length) {
      lines.push(`<b>🔥 Promoções:</b>`);
      promos.promotions.slice(0,5).forEach(p => {
        lines.push(`• <b>-${p.discount_percent}%</b> ${esc(p.name?.substring(0,50))} — <b>${$(p.price_usd)}</b>`);
      });
      lines.push('');
    }

    if (data.products?.length) {
      lines.push(`<b>📦 Últimos produtos:</b>`);
      data.products.slice(0,5).forEach(p => {
        lines.push(`• ${esc(p.name?.substring(0,55))} — <b>${$(p.price_usd)}</b>`);
      });
    }

    lines.push(`\n💡 Use /buscar <i>produto</i> pra buscar nesta e outras lojas`);
    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(chatId, `Erro: ${e.message}`); }
});

// ==================== /top ====================
bot.onText(/\/top/, async (msg) => {
  try {
    const stores = await api('/stores');
    const sorted = stores.sort((a,b) => (parseInt(b.product_count)||0) - (parseInt(a.product_count)||0));
    const total = sorted.reduce((s,x) => s + (parseInt(x.product_count)||0), 0);
    const totalPromos = sorted.reduce((s,x) => s + (parseInt(x.promo_count)||0), 0);

    const lines = [
      `🏆 <b>Ranking de Lojas</b>`,
      `📦 Total: <b>${num(total)}</b> produtos | 🏷️ <b>${num(totalPromos)}</b> promoções\n`,
    ];

    sorted.forEach((s,i) => {
      const c = parseInt(s.product_count)||0;
      const p = parseInt(s.promo_count)||0;
      const medal = i<3 ? ['🥇','🥈','🥉'][i] : `${i+1}.`;
      const bar = '█'.repeat(Math.min(Math.round(c / (sorted[0]?.product_count||1) * 10), 10));
      lines.push(`${medal} <b>${esc(s.name)}</b>`);
      lines.push(`   ${bar} ${num(c)} prod${p > 0 ? ' · '+num(p)+' promos' : ''}`);
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
    const ytCams = cams.filter(cam => cam.video_id);

    // Foto YouTube (tenta cada uma até funcionar)
    let sentPhoto = false;
    for (const cam of ytCams) {
      if (sentPhoto) break;
      for (const q of ['sddefault','hqdefault','mqdefault','default']) {
        try {
          await bot.sendPhoto(chatId, `https://img.youtube.com/vi/${cam.video_id}/${q}.jpg`, {
            caption: `🌉 Ponte da Amizade — AO VIVO\n\n💱 Cotação:\nUSD/BRL: R$ ${c.usd_brl?.toFixed(2)||'--'}\nUSD/PYG: Gs ${Math.round(c.usd_pyg||0).toLocaleString()}\nBRL/PYG: Gs ${Math.round(c.brl_pyg||0).toLocaleString()}\n\n📹 ${cam.name}`,
          });
          sentPhoto = true;
          await new Promise(r => setTimeout(r, 1500));
          break;
        } catch (_) {}
      }
    }
    if (!sentPhoto) {
      await bot.sendMessage(chatId, `🌉 <b>Ponte da Amizade</b>\n\n💱 USD/BRL: <b>R$ ${c.usd_brl?.toFixed(2)||'--'}</b>\n💱 USD/PYG: <b>Gs ${Math.round(c.usd_pyg||0).toLocaleString()}</b>\n💱 BRL/PYG: <b>Gs ${Math.round(c.brl_pyg||0).toLocaleString()}</b>`, { parse_mode: H });
    }

    // Lista de câmeras
    const lines = [`📹 <b>Câmeras ao vivo (${cams.length})</b>\n`];
    cams.forEach((cam,i) => {
      lines.push(`${i+1}. <b>${esc(cam.name)}</b>`);
      lines.push(`   <i>${esc(cam.source)}</i> — <a href="${cam.url}">Assistir</a>`);
    });
    lines.push('');
    lines.push(`🔗 <a href="https://cdeaovivo.com">CDE ao Vivo</a> · 🤖 <a href="https://t.me/agentecdeaovivo_bot">Bot trânsito</a>`);
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (e) { bot.sendMessage(chatId, `Erro: ${e.message}`); }
});

// ==================== /cotacao ====================
bot.onText(/\/cotacao/, async (msg) => {
  try {
    const data = await api('/cotacao');
    const lines = [
      `💱 <b>Cotação em tempo real</b>\n`,
      `🇺🇸→🇧🇷 <b>Dólar / Real</b>`,
      `   Compra: <b>R$ ${data.USD_BRL?.bid?.toFixed(4)}</b>`,
      `   Venda: <b>R$ ${data.USD_BRL?.ask?.toFixed(4)}</b>`,
      `   Variação: ${data.USD_BRL?.pctChange||'--'}%\n`,
      `🇺🇸→🇵🇾 <b>Dólar / Guarani</b>`,
      `   Compra: <b>Gs ${num(Math.round(data.USD_PYG?.bid||0))}</b>`,
      `   Venda: <b>Gs ${num(Math.round(data.USD_PYG?.ask||0))}</b>\n`,
      `🇧🇷→🇵🇾 <b>Real / Guarani</b>`,
      `   Compra: <b>Gs ${num(Math.round(data.BRL_PYG?.bid||0))}</b>`,
      `   Venda: <b>Gs ${num(Math.round(data.BRL_PYG?.ask||0))}</b>\n`,
      `<i>Fonte: ${data.source||'AwesomeAPI'}</i>`,
      `\n💡 Use /calc <i>valor</i> pra calcular imposto`,
    ];
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /calc ====================
bot.onText(/\/calc(?:ular)? (\d+[\.,]?\d*)(.*)/, async (msg, match) => {
  const priceUsd = parseFloat(match[1].replace(',','.'));
  const qtyMatch = (match[2]||'').match(/x\s*(\d+)/i);
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
  if (!priceUsd) return;

  let dolar = 5.30;
  try { const cot = await api('/cotacao'); if (cot.USD_BRL?.bid) dolar = cot.USD_BRL.bid; } catch (_) {}

  const iof = 3.38;
  const totalUsd = priceUsd * qty;
  const totalBrl = totalUsd * dolar;
  const iofVal = totalBrl * (iof / 100);
  const excess = Math.max(0, totalUsd - 500);
  const tax = excess * dolar * 0.5;
  const total = totalBrl + iofVal + tax;

  const lines = [
    `🧮 <b>Calculadora de Importação</b>\n`,
    `📦 ${qty > 1 ? qty+'x ' : ''}${$(priceUsd)}${qty > 1 ? ' = <b>'+$(totalUsd)+'</b>' : ''}`,
    `💱 Câmbio: <b>${R$(dolar)}</b> (tempo real)\n`,
    `   Em reais: ${R$(totalBrl)}`,
    `   IOF ${iof}%: ${R$(iofVal)}`,
    excess > 0
      ? `   Imposto 50%: ${R$(tax)} (excedente ${$(excess)})`
      : `   ✅ Dentro da cota US$ 500`,
    `\n💰 <b>TOTAL: ${R$(total)}</b>`,
    qty > 1 ? `   <i>(${R$(total/qty)} por unidade)</i>` : '',
  ].filter(Boolean);
  bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
});

// ==================== /stats ====================
bot.onText(/\/stats/, async (msg) => {
  try {
    const[health, stats] = await Promise.all([api('/health'), api('/stats')]);

    const running = (health.scrapers||[]).filter(s => s.products_found > 0).length;
    const empty = (health.scrapers||[]).filter(s => !s.products_found).length;

    const lines = [
      `📊 <b>FacilitaParaguay — Dashboard</b>\n`,
      `📦 Produtos: <b>${num(health.total_products)}</b>`,
      `🏪 Lojas: <b>${health.total_stores}</b> (${running} ativas, ${empty} sem dados)`,
      `🏷️ Promoções: <b>${num(stats.promos)}</b>`,
      `📋 Marcas: <b>${num(stats.brands)}</b>`,
      `💰 Preço médio: <b>${$(stats.avg_price)}</b>`,
      `✅ Em estoque: <b>${num(stats.in_stock)}</b>\n`,
      `<b>🔄 Último scraping:</b>`,
    ];

    (health.scrapers||[]).sort((a,b) => new Date(b.last_run||0) - new Date(a.last_run||0)).slice(0,5).forEach(s => {
      const ago = Math.round((Date.now() - new Date(s.last_run).getTime()) / 60000);
      const icon = s.products_found > 0 ? '✅' : '⚠️';
      lines.push(`${icon} ${esc(s.name)}: ${num(s.products_found)} (${ago < 60 ? ago+'min' : Math.round(ago/60)+'h'} atrás)`);
    });

    lines.push(`\n💡 /top pra ranking completo | /lojas pra lista`);
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== /lojas ====================
bot.onText(/\/lojas/, async (msg) => {
  try {
    const stores = await api('/stores');
    const lines = [`🏪 <b>${stores.length} Lojas Monitoradas</b>\n`];
    stores.sort((a,b) => (parseInt(b.product_count)||0) - (parseInt(a.product_count)||0)).forEach(s => {
      const c = parseInt(s.product_count)||0;
      const p = parseInt(s.promo_count)||0;
      const icon = c > 0 ? '🟢' : '🔴';
      lines.push(`${icon} <b>${esc(s.name)}</b>: ${num(c)} produtos${p > 0 ? ' · '+num(p)+' promos' : ''}`);
    });
    lines.push(`\n💡 Use /loja <i>nome</i> pra ver detalhes`);
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: H });
  } catch (e) { bot.sendMessage(msg.chat.id, `Erro: ${e.message}`); }
});

// ==================== BUSCA LIVRE ====================
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.text.length < 3) return;
  const q = msg.text.trim(), chatId = msg.chat.id;
  try {
    const data = await api(`/products?search=${encodeURIComponent(q)}&limit=5&sort=price_asc&in_stock=true`);
    if (!data.products?.length) return bot.sendMessage(chatId, `Nada encontrado para "${esc(q)}"\n\n💡 Tente termos mais curtos ou em inglês`);

    const lines = [`🔍 <b>${num(data.total)}</b> resultados para "<b>${esc(q)}</b>"\n`];
    data.products.slice(0,5).forEach((p,i) => {
      lines.push(`<b>${i+1}.</b> ${esc(p.name?.substring(0,65))}`);
      lines.push(`   <b>${$(p.price_usd)}</b> — ${esc(p.store_name)}${p.discount_percent ? ' 🏷️-'+p.discount_percent+'%' : ''}`);
      lines.push(`   <a href="${p.product_url}">Ver →</a>\n`);
    });
    if (data.total > 5) lines.push(`Use /buscar ${esc(q)} pra ver todos os ${num(data.total)}`);
    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: H, disable_web_page_preview: true });
  } catch (_) {}
});

module.exports = { bot };
