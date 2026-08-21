const A='/api';let cPage='home',pPage=1,pLoading=false,stockOn=false;

// Safe DOM setter
function setIcon(id,iconName,size){var el=document.getElementById(id);if(el)el.innerHTML=icon(iconName,size||16);}

// Init icons (safe)
try{
  setIcon('dark-toggle',localStorage.cp_d==='true'?'sun':'moon',16);
  setIcon('w-ico','heart',16);
  setIcon('sb-ico','search',18);
  setIcon('bn1','fire',20);
  setIcon('bn2','search',20);
  setIcon('bn3','tag',20);
  setIcon('bn4','scale',20);
  setIcon('bn5','chart',20);
  setIcon('bn6','bridge',20);
  setIcon('s1','fire',20);
  setIcon('s2','newBadge',20);
  setIcon('s3','priceDown',20);
  setIcon('s4','trending',20);
  setIcon('s5','eye',20);
  setIcon('m1','bell',22);
  setIcon('m2','calc',22);
  setIcon('m3','heart',22);
  setIcon('m4','chart',22);
  setIcon('m5','save',22);
  setIcon('m6','scale',22);
  setIcon('tg-ico','telegram',16);
  setIcon('cde-ico','camera',16);
  setIcon('modal-close-btn','x',16);
}catch(e){console.error('Icon init error:',e);}

// Nav init (safe)
try{
  var navEl=document.getElementById('main-nav');
  if(navEl){
    var NAV_ITEMS=[
      {tab:'home',label:'Ofertas',icon:'fire'},{tab:'search',label:'Buscar',icon:'search'},
      {tab:'ponte',label:'Ponte',icon:'bridge'},{tab:'promos',label:'Promos',icon:'tag'},
      {tab:'more',label:'Mais',icon:'chart'}
    ];
    navEl.innerHTML=NAV_ITEMS.map(function(n,i){return '<a href="#" data-tab="'+n.tab+'" class="'+(i===0?'active':'')+'">' +icon(n.icon,14)+' '+n.label+'</a>';}).join('');
  }
}catch(e){console.error('Nav init error:',e);}

// Dark mode
try{
  if(localStorage.cp_d==='true')document.documentElement.dataset.theme='dark';
  var dtEl=document.getElementById('dark-toggle');
  if(dtEl)dtEl.onclick=function(){var d=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=d?'dark':'';localStorage.cp_d=d;dtEl.innerHTML=icon(d?'sun':'moon',16);};
}catch(e){console.error('Dark mode init:',e);}

// Wishlist
const WL={g(){try{return JSON.parse(localStorage.cp_w||'[]')}catch{return[]}},h(id){return this.g().some(w=>w.id===id)},
  t(p){const l=this.g();const i=l.findIndex(w=>w.id===p.id);if(i>=0)l.splice(i,1);else l.push({id:p.id,name:p.name,price:p.price_usd,image:p.image_url,store:p.store_name,url:p.product_url});localStorage.cp_w=JSON.stringify(l);updWC();return i<0;}};
function updWC(){var el=document.getElementById('w-cnt');if(el)el.textContent=WL.g().length;}
try{updWC();var wtEl=document.getElementById('wish-toggle');if(wtEl)wtEl.onclick=function(){switchPage('wishlist');};}catch(e){}

// Recent
const RV={g(){try{return JSON.parse(localStorage.cp_r||'[]')}catch{return[]}},
  a(p){let l=this.g().filter(r=>r.id!==p.id);l.unshift({id:p.id,name:p.name,price:p.price_usd,image:p.image_url,store:p.store_name});if(l.length>20)l=l.slice(0,20);localStorage.cp_r=JSON.stringify(l);}};

// API
async function api(p){return(await fetch(A+p)).json();}
function showSO(m){try{var o=document.getElementById('search-overlay');if(o){o.querySelector('.so-text').textContent=m||'Buscando...';o.classList.remove('hidden');}}catch(_){}}
function hideSO(){try{var o=document.getElementById('search-overlay');if(o)o.classList.add('hidden');}catch(_){}}
function toast(m){try{var t=document.getElementById('toast');if(t){t.querySelector('span').textContent=m;t.classList.remove('hidden');setTimeout(function(){t.classList.add('hidden');},2200);}}catch(_){}}

// === NAVIGATION ===
try{document.querySelectorAll('.bnav').forEach(function(b){b.onclick=function(){switchPage(b.dataset.page);};});}catch(e){}
function switchPage(pg){
  document.querySelectorAll('.bnav').forEach(b=>b.classList.toggle('active',b.dataset.page===pg));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById('page-'+pg);if(el)el.classList.add('active');cPage=pg;
  ({home:loadHome,search:loadSearch,promos:loadPromos,compare:()=>{},alerts:loadAlerts,dash:loadDash,wishlist:loadWL,ponte:loadPonte,more:()=>{}}[pg]||Function)();
}

// === PONTE / CAMERAS / COTAÇÃO ===
async function loadPonte(){
  try{
    showSO('Carregando câmeras...');
    var data;
    try{ data = await api('/ponte-status'); } catch(e){ data = {}; }
    hideSO();

    // Cotação
    var c = data.cotacao || {};
    var cotBar = document.getElementById('cotacao-bar');
    if(cotBar) cotBar.innerHTML =
      '<div class="cot-card"><div class="cot-pair">'+icon('dollar',13)+' USD/BRL</div><div class="cot-val">R$ '+(c.usd_brl?c.usd_brl.toFixed(2):'--')+'</div></div>'+
      '<div class="cot-card"><div class="cot-pair">'+icon('dollar',13)+' USD/PYG</div><div class="cot-val">Gs '+Math.round(c.usd_pyg||0).toLocaleString()+'</div></div>'+
      '<div class="cot-card"><div class="cot-pair">'+icon('dollar',13)+' BRL/PYG</div><div class="cot-val">Gs '+Math.round(c.brl_pyg||0).toLocaleString()+'</div></div>';

    // Atualizar câmbio na calculadora
    var calcDolar = document.getElementById('c-dolar');
    if (calcDolar && c.usd_brl) calcDolar.value = c.usd_brl.toFixed(2);

    // Câmeras
    var cams = data.cameras || [
      {name:'Ponte - Sentido Paraguai',source:'CDE ao Vivo',type:'youtube',url:'https://www.youtube.com/embed/szur4H43bKk?autoplay=1&mute=1'},
    ];
    var camGrid = document.getElementById('cam-grid');
    if(camGrid) camGrid.innerHTML = cams.map(function(cam, i){
      return '<div class="cam-card">'+
        '<div class="cam-header"><div><div class="cam-name">'+icon('camera',13)+' '+cam.name+'</div><div class="cam-source">'+cam.source+'</div></div><div class="cam-live">AO VIVO</div></div>'+
        (i < 2 ? '<iframe src="'+cam.url+'" allow="autoplay; encrypted-media" allowfullscreen loading="lazy" sandbox="allow-scripts allow-same-origin" style="width:100%;height:200px;border:none"></iframe>' :
        '<div style="padding:16px;text-align:center;color:var(--sub);font-size:.82rem;cursor:pointer" onclick="this.outerHTML=\'<iframe src=&quot;'+cam.url+'&quot; style=&quot;width:100%;height:200px;border:none&quot; allow=&quot;autoplay&quot; allowfullscreen loading=&quot;lazy&quot; sandbox=&quot;allow-scripts allow-same-origin&quot;></iframe>\'">Toque para carregar</div>')+
        '<a href="'+cam.url+'" target="_blank" class="cam-expand">'+icon('arrowRight',12)+' Abrir tela cheia</a></div>';
    }).join('');
  }catch(e){
    console.error('loadPonte error:',e);
    hideSO();
  }
}

// === AUTOCOMPLETE ===
var gS,acD;let acT;
try{
  gS=document.getElementById('global-search');
  acD=document.getElementById('ac-drop');
  if(gS&&acD){
    gS.oninput=function(){clearTimeout(acT);var q=gS.value.trim();if(q.length<2){acD.classList.add('hidden');return;}
      acT=setTimeout(async function(){var r=await api('/autocomplete?q='+encodeURIComponent(q));if(!r.length){acD.classList.add('hidden');return;}
        acD.innerHTML=r.map(function(r){return '<div class="ac-item" onclick="openProduct('+r.id+');acD.classList.add(\'hidden\');gS.value=\'\';">'
          +(r.image_url?'<img src="'+r.image_url+'" onerror="this.style.display=\'none\'">':'<span style="width:40px">'+icon('noImage',24)+'</span>')
          +'<div style="flex:1;font-size:.82rem">'+esc(r.name)+'</div>'
          +'<div style="text-align:right"><div style="color:var(--blue);font-weight:700;font-size:.82rem">'+(r.min_price?'US$ '+r.min_price:'')+'</div><div style="color:var(--sub);font-size:.65rem">'+r.store_count+' loja'+(r.store_count>1?'s':'')+'</div></div></div>';}).join('');
        acD.classList.remove('hidden');},280);};
    gS.onkeypress=function(e){if(e.key==='Enter'){acD.classList.add('hidden');switchPage('search');}};
  }
  document.addEventListener('click',function(e){if(acD&&!e.target.closest('.search-wrap'))acD.classList.add('hidden');});
}catch(e){console.error('Autocomplete init:',e);}

// === HOME ===
async function loadHome(){
  const sp=document.getElementById('splash');
  function closeSp(){if(sp){sp.style.opacity='0';setTimeout(()=>{try{sp.remove()}catch(_){}},500);}}
  
  // Splash some em 3s garantido
  setTimeout(closeSp, 3000);

  try{
    // Health check
    const h=await api('/health');
    
    if(!h.total_products || h.total_products===0){
      closeSp();
      document.getElementById('page-home').innerHTML=emptyState();
      try{const st=await api('/stores');populateSelectsFromStores(st);}catch(_){}
      return;
    }

    // Carregar dados
    const[d,t]=await Promise.all([api('/deals').catch(()=>({})),api('/trending').catch(()=>[])]);
    closeSp();

    hScroll('h-disc',d.biggest_discount||[]);
    hScroll('h-new',d.new_arrival||[]);
    hScroll('h-drops',d.price_drop||[]);
    hScroll('h-trend',t||[]);

    // Ticker
    const all=[...(d.biggest_discount||[]),...(d.price_drop||[])].filter(x=>x.discount_percent>5);
    if(all.length){
      const it=all.map(x=>'<span class="ticker-item"><span class="ticker-badge">'+icon('percent',10)+' -'+x.discount_percent+'%</span> '+esc(x.name?.substring(0,40))+' <strong>US$ '+parseFloat(x.price_usd).toFixed(2)+'</strong></span>').join('');
      document.getElementById('ticker').innerHTML='<div class="ticker-inner">'+it+it+'</div>';
    }
  }catch(e){
    console.error('loadHome error:',e);
    closeSp();
  }

  // Chips
  try{
    var cc=document.getElementById('cat-chips');
    if(cc)cc.innerHTML=[{l:'Descontos',c:'chip-fire',q:'discount'},{l:'Novidades',c:'chip-new',q:'newest'},{l:'Perfumes',c:'chip-perf',q:'perfume'},{l:'Tech',c:'chip-tech',q:'celular'},{l:'Games',c:'chip-game',q:'playstation'},{l:'Casa',c:'chip-home',q:'air fryer'}].map(function(c){return '<button class="chip '+c.c+'" onclick="gS.value=\''+c.q+'\';switchPage(\'search\')">'+c.l+'</button>';}).join('');
  }catch(_){}

  // Recent
  try{
    var rv=RV.g();if(rv.length){var rs=document.getElementById('rv-sec');if(rs){rs.classList.remove('hidden');hScroll('h-recent',rv.map(function(r){return{id:r.id,price_usd:r.price,image_url:r.image,store_name:r.store,name:r.name};}));}}
  }catch(_){}

  // Selects
  try{var st=await api('/stores');populateSelectsFromStores(st);}catch(_){}
}

function populateSelectsFromStores(stores){
  const o='<option value="">Loja</option>'+stores.map(s=>`<option value="${s.slug}">${s.name}</option>`).join('');
  ['f-store','ex-store'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=o;});
  api('/brands').then(br=>{const bf=document.getElementById('f-brand');if(bf)bf.innerHTML='<option value="">Marca</option>'+br.slice(0,50).map(b=>`<option value="${b.brand}">${b.brand}</option>`).join('');}).catch(()=>{});
}

function emptyState(){
  return `<div class="empty-state">
    <div class="es-icon">${icon('box',48)}</div>
    <h3>Nenhum produto ainda</h3>
    <p>O banco está vazio. Inicie o scraping pra popular com produtos das 20 lojas.</p>
    <button class="btn-scrape-all" onclick="startScrapeAll()">
      ${icon('refresh',16)} Iniciar Scraping
    </button>
    <div class="es-stores">20 lojas configuradas e prontas</div>
  </div>`;
}

async function startScrapeAll(){
  showSO('Iniciando scraping de 20 lojas...');
  try {
    const r = await fetch(A+'/scrape/all',{method:'POST'});
    const d = await r.json();
    hideSO();
    toast(d.message || 'Scraping iniciado em background');
  } catch(e) {
    hideSO();
    toast('Erro ao iniciar scraping');
  }
}
function hScroll(id,items){const el=document.getElementById(id);if(!el)return;el.innerHTML=items.map(p=>card(p)).join('')||'<p class="empty" style="min-width:160px">Sem dados</p>';}

// === SEARCH ===
async function loadSearch(pg=1,append=false){
  if(pLoading)return;pLoading=true;pPage=pg;
  const q=gS.value||'',st=document.getElementById('f-store').value,br=document.getElementById('f-brand').value,
    so=document.getElementById('f-sort').value,sk=stockOn?'&in_stock=true':'';
  if(pg===1)showSO('Buscando...');
  const d=await api(`/products?page=${pg}&limit=24&search=${encodeURIComponent(q)}&store=${st}&brand=${br}&sort=${so}${sk}`);
  if(pg===1)hideSO();
  const c=document.getElementById('p-grid');const html=d.products.map(p=>card(p)).join('');
  if(append)c.innerHTML+=html;else c.innerHTML=html||'<p class="empty">Nenhum produto</p>';
  document.getElementById('p-loader').classList.toggle('hidden',pg>=d.pages);pLoading=false;
}
const obs=new IntersectionObserver(e=>{if(e[0].isIntersecting&&!pLoading)loadSearch(pPage+1,true);});
try{var plEl=document.getElementById('p-loader');if(plEl)obs.observe(plEl);}catch(e){}
['f-store','f-brand','f-sort'].forEach(id=>document.getElementById(id).onchange=()=>loadSearch());
document.getElementById('f-stock').onclick=function(){stockOn=!stockOn;this.classList.toggle('on',stockOn);loadSearch();};

// === PROMOS ===
async function loadPromos(){
  showSO('Carregando promoções...');
  const[st,pr]=await Promise.all([api('/promotions/stats'),api('/promotions?limit=60&min_discount=5')]);hideSO();
  document.getElementById('promo-cards').innerHTML=st.map(s=>`<div class="p-stat"><div class="ps-num">${s.total_promos}</div><div class="ps-name">${s.name}</div><div class="ps-detail">Até ${s.max_discount||0}% off</div></div>`).join('');
  document.getElementById('promo-grid').innerHTML=pr.promotions.map(p=>card(p)).join('')||'<p class="empty">Sem promoções</p>';
}

// === COMPARE ===
try{var cmpBtn=document.getElementById('cmp-btn');if(cmpBtn)cmpBtn.onclick=async function(){const q=document.getElementById('cmp-input').value;if(!q)return;
  showSO('Comparando em 20 lojas...');const d=await api(`/compare?search=${encodeURIComponent(q)}`);hideSO();
  document.getElementById('cmp-results').innerHTML=d.groups?.length?d.groups.map(g=>`
    <div class="cmp-group"><h4>${esc(g.name)}</h4>
    ${g.savings>0?`<div class="cmp-savings">${icon('coins',14)} Economia US$ ${g.savings.toFixed(2)}</div>`:''}
    ${g.stores.map((s,i)=>`<div class="cmp-row"><span>${s.store}</span><span class="${i===0?'cmp-best':''}">US$ ${s.price.toFixed(2)} ${s.is_promo?icon('tag',11):''}</span></div>`).join('')}</div>`).join(''):'<p class="empty">Nenhum resultado</p>';};
var cmpIn=document.getElementById('cmp-input');if(cmpIn)cmpIn.onkeypress=e=>{if(e.key==='Enter')document.getElementById('cmp-btn').click();};
}catch(e){console.error('Compare init:',e);}

// === ALERTS ===
async function loadAlerts(){
  const h=document.getElementById('a-hrs').value,m=document.getElementById('a-min').value;
  const d=await api(`/alerts/price-drops?hours=${h}&min_drop=${m}`);
  document.getElementById('a-grid').innerHTML=d.drops?.length?d.drops.map(x=>`
    <div class="a-card" onclick="openProduct(${x.product_id})">
      <div class="a-drop">${icon('priceDown',14)} -${x.drop_percent}%</div>
      <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.name)}</div>
      <div style="font-size:.72rem;color:var(--sub)">US$ ${x.old_price} &rarr; <strong style="color:var(--green)">US$ ${x.new_price}</strong></div></div>
    </div>`).join(''):'<p class="empty">Sem quedas no período</p>';
}
try{var ahEl=document.getElementById('a-hrs');if(ahEl)ahEl.onchange=loadAlerts;var amEl=document.getElementById('a-min');if(amEl)amEl.onchange=loadAlerts;}catch(_){}

// === CALCULATOR ===
function calcular(){const p=parseFloat(document.getElementById('c-price').value||0),dl=parseFloat(document.getElementById('c-dolar').value||5.3),
  q=parseInt(document.getElementById('c-qty').value||1),iof=parseFloat(document.getElementById('c-iof').value||3.38);if(!p)return;
  const tu=p*q,tb=tu*dl,iv=tb*(iof/100),exc=Math.max(0,tu-500),tax=exc*dl*.5,total=tb+iv+tax;
  const el=document.getElementById('c-res');el.classList.remove('hidden');
  el.innerHTML=`<div class="c-total">R$ ${total.toFixed(2)}</div><div class="c-break">
    ${q}x US$ ${p.toFixed(2)} = US$ ${tu.toFixed(2)}<br>R$ ${tb.toFixed(2)} (câmbio ${dl.toFixed(2)})<br>
    IOF: R$ ${iv.toFixed(2)}<br>${exc>0?`Imposto 50%: R$ ${tax.toFixed(2)}<br>`:'Dentro da cota<br>'}
    <strong>Total: R$ ${total.toFixed(2)}</strong></div>`;}

// === WISHLIST ===
function loadWL(){const l=WL.g();const el=document.getElementById('wl-grid'),em=document.getElementById('wl-empty');
  if(!l.length){el.innerHTML='';em.classList.remove('hidden');return;}em.classList.add('hidden');
  el.innerHTML=l.map(w=>card({...w,price_usd:w.price,image_url:w.image,store_name:w.store})).join('');}

// === DASHBOARD ===
async function loadDash(){
  const[st,stores,hl]=await Promise.all([api('/stats'),api('/stores'),api('/health')]);
  document.getElementById('stats-row').innerHTML=[{v:st.total_products,l:'Produtos'},{v:st.promos,l:'Promos'},{v:st.stores,l:'Lojas'},{v:st.brands,l:'Marcas'},{v:st.in_stock,l:'Estoque'},{v:'$'+(st.avg_price||0),l:'Média'}].map(s=>`<div class="stat-box"><div class="sv">${s.v}</div><div class="sl">${s.l}</div></div>`).join('');
  document.getElementById('stores-list').innerHTML=stores.map(s=>`<div class="store-item"><div><div class="si-name">${s.name}</div><div class="si-meta">${s.product_count} produtos</div></div><button class="si-btn" onclick="event.stopPropagation();fetch(A+'/scrape/${s.slug}',{method:'POST'}).then(r=>r.json()).then(d=>toast(d.message))">${icon('refresh',12)} Scrape</button></div>`).join('');
  document.getElementById('health').innerHTML=`<div class="health-bar ${hl.stale_count===0?'h-ok':'h-warn'}">${icon(hl.stale_count===0?'check':'bell',14)} ${hl.status} | ${hl.total_products} produtos</div>`;
}

// === EXPORT ===
try{var exBtn=document.getElementById('ex-btn');if(exBtn)exBtn.onclick=()=>{const s=document.getElementById('ex-store').value,f=document.getElementById('ex-fmt').value,
  p=document.getElementById('ex-promo').checked?'&promo_only=true':'';window.open(`${A}/export?format=${f}&store=${s}${p}`,'_blank');};}catch(e){console.error('Export init:',e);}

// === CARD ===
function card(p){const w=WL.h(p.id);return`<div class="card" onclick="openProduct(${p.id})">
  ${p.discount_percent>0?`<div class="c-badge c-badge-disc">${icon('percent',9)} -${p.discount_percent}%</div>`:''}
  ${p.in_stock===false?'<div class="c-badge c-badge-out">Fora</div>':''}
  <div class="c-img">${p.image_url?`<img src="${p.image_url}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=noimg>'+ICONS.noImage+'</span>'">`:`<span class="noimg">${ICONS.noImage}</span>`}</div>
  <div class="c-body"><div class="c-name">${esc(p.name)}</div>
    ${p.price_usd?`<span class="c-price">US$ ${parseFloat(p.price_usd).toFixed(2)}</span>`:'<span style="color:var(--sub);font-size:.75rem">Consultar</span>'}
    ${p.price_original&&parseFloat(p.price_original)>parseFloat(p.price_usd)?`<span class="c-old">US$ ${parseFloat(p.price_original).toFixed(2)}</span>`:''}
    ${p.brand?`<div class="c-brand">${p.brand}</div>`:''}<div class="c-store">${p.store_name||''}</div></div>
  <div class="c-actions"><button class="c-abtn" onclick="event.stopPropagation();shareProd('${esc(p.name)}','${p.product_url}')">${icon('share',14)}</button>
    <button class="c-abtn ${w?'liked':''}" onclick="event.stopPropagation();togWish(${p.id},this)" data-p='${JSON.stringify({id:p.id,name:p.name,price_usd:p.price_usd,image_url:p.image_url,store_name:p.store_name||'',product_url:p.product_url||''}).replace(/'/g,"&#39;")}'>${w?icon('heartFill',15):icon('heart',15)}</button></div></div>`;}

function togWish(id,btn){const d=JSON.parse(btn.dataset.p);const a=WL.t(d);btn.innerHTML=a?icon('heartFill',15):icon('heart',15);btn.classList.toggle('liked',a);toast(a?'Salvo nos favoritos':'Removido');}
function shareProd(n,u){if(navigator.share)navigator.share({title:n,url:u}).catch(()=>{});else{navigator.clipboard?.writeText(n+'\n'+u);toast('Link copiado!');}}

// === MODAL (bottom sheet) ===
async function openProduct(id){
  showSO('Carregando...');
  const[p,img,sim,rank]=await Promise.all([api(`/products/${id}`),api(`/products/${id}/images`),api(`/products/${id}/similar`),api(`/products/${id}/price-rank`)]);
  hideSO();RV.a(p);
  const imgs=img.images||[];const hist=p.price_history||[];const mi=imgs[0]||p.image_url||'';
  let h=`${mi?`<img class="m-img" id="mmi" src="${mi}">`:''}
    ${imgs.length>1?`<div class="m-gallery">${imgs.map((m,i)=>`<img src="${m}" class="${i===0?'active':''}" onclick="document.getElementById('mmi').src=this.src;document.querySelectorAll('.m-gallery img').forEach(x=>x.classList.remove('active'));this.classList.add('active')">`).join('')}</div>`:''}
    <h3 style="font-size:.95rem;margin:6px 0">${esc(p.name)}</h3>
    <div class="m-price-row">
      ${p.price_usd?`<span class="m-price">US$ ${parseFloat(p.price_usd).toFixed(2)}</span>`:''}
      ${p.price_original?`<span class="m-old">US$ ${parseFloat(p.price_original).toFixed(2)}</span>`:''}
      ${p.discount_percent?`<span class="m-badge" style="background:var(--red)">${icon('percent',10)} -${p.discount_percent}%</span>`:''}
      ${rank.is_lowest?`<span class="m-badge" style="background:var(--green)">${icon('trophy',10)} Menor preço</span>`:''}
    </div>
    <div class="m-meta">
      <span>${icon('store',13)} ${p.store_name}</span>
      ${p.brand?`<span>${icon('sparkle',13)} ${p.brand}</span>`:''}
      <span style="color:${p.in_stock?'var(--green)':'var(--red)'}">${icon(p.in_stock?'check':'x',13)} ${p.in_stock?'Estoque':'Fora'}</span>
      ${p.promo_label?`<span>${icon('tag',13)} ${p.promo_label}</span>`:''}
    </div>`;
  if(rank.all_prices?.length>1)h+=`<div class="rank-box"><strong>${icon('chart',13)} ${rank.total_stores} lojas (${icon('flag',11)} #${rank.rank})</strong>${rank.all_prices.slice(0,5).map((r,i)=>`<div class="rank-row ${i===0?'rank-best':''}">${r.store_name}<span>US$ ${parseFloat(r.price_usd).toFixed(2)}</span></div>`).join('')}</div>`;
  h+=`<div class="m-actions">
    <a href="${p.product_url}" target="_blank" class="m-btn m-btn-primary" style="text-decoration:none">${icon('arrowRight',14)} Loja</a>
    <button class="m-btn m-btn-green" onclick="shareProd('${esc(p.name)}','${p.product_url}')">${icon('share',14)} Enviar</button>
    <button class="m-btn ${WL.h(p.id)?'m-btn-red':'m-btn-outline'}" onclick="WL.t({id:${p.id},name:'${esc(p.name)}',price_usd:${p.price_usd},image_url:'${p.image_url||''}',store_name:'${p.store_name||''}'});updWC();this.classList.toggle('m-btn-red');this.classList.toggle('m-btn-outline')">${icon('heart',14)}</button>
  </div>`;
  if(hist.length>1)h+=`<div style="margin-top:10px"><strong>${icon('chartLine',14)} Histórico</strong><div class="price-chart"><canvas id="pc"></canvas></div></div>`;
  if(sim.length)h+=`<div style="margin-top:10px"><strong>${icon('link',14)} Similares</strong><div class="sim-scroll">${sim.slice(0,8).map(s=>`<div class="sim-card" onclick="openProduct(${s.id})">${s.image_url?`<img src="${s.image_url}" onerror="this.style.display='none'">`:''}
    <div style="margin:3px 0">${esc(s.name?.substring(0,35))}</div><div class="sim-price">${s.price_usd?'$'+parseFloat(s.price_usd).toFixed(0):''}</div></div>`).join('')}</div></div>`;
  document.getElementById('modal-body').innerHTML=h;
  document.getElementById('modal').classList.remove('hidden');
  if(hist.length>1)setTimeout(()=>drawChart(hist),150);
}

function drawChart(hist){const cv=document.getElementById('pc');if(!cv)return;const ctx=cv.getContext('2d');const r=cv.parentElement.getBoundingClientRect();
  cv.width=r.width;cv.height=r.height;const pr=hist.map(h=>parseFloat(h.price_usd)).reverse();
  const mn=Math.min(...pr)*.95,mx=Math.max(...pr)*1.05,w=cv.width,h=cv.height,pd={t:16,b:24,l:42,r:12};
  const pw=w-pd.l-pd.r,ph=h-pd.t-pd.b;const dk=document.documentElement.dataset.theme==='dark';
  ctx.fillStyle=dk?'#1e293b':'#fafbfc';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=dk?'#334155':'#e8ecf1';ctx.lineWidth=1;
  for(let i=0;i<=3;i++){const y=pd.t+(ph/3)*i;ctx.beginPath();ctx.moveTo(pd.l,y);ctx.lineTo(w-pd.r,y);ctx.stroke();
    ctx.fillStyle=dk?'#94a3b8':'#6b7280';ctx.font='9px sans-serif';ctx.textAlign='right';ctx.fillText('$'+(mx-((mx-mn)/3)*i).toFixed(0),pd.l-4,y+3);}
  ctx.beginPath();pr.forEach((p,i)=>{const x=pd.l+(pw/Math.max(pr.length-1,1))*i;const y=pd.t+ph-((p-mn)/(mx-mn||1))*ph;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.lineTo(pd.l+pw,pd.t+ph);ctx.lineTo(pd.l,pd.t+ph);ctx.closePath();
  const grd=ctx.createLinearGradient(0,pd.t,0,pd.t+ph);grd.addColorStop(0,'rgba(30,107,214,.2)');grd.addColorStop(1,'rgba(30,107,214,.02)');ctx.fillStyle=grd;ctx.fill();
  ctx.beginPath();ctx.strokeStyle='#1e6bd6';ctx.lineWidth=2;ctx.lineJoin='round';
  pr.forEach((p,i)=>{const x=pd.l+(pw/Math.max(pr.length-1,1))*i;const y=pd.t+ph-((p-mn)/(mx-mn||1))*ph;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.stroke();
  pr.forEach((p,i)=>{const x=pd.l+(pw/Math.max(pr.length-1,1))*i;const y=pd.t+ph-((p-mn)/(mx-mn||1))*ph;
    ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#1e6bd6';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();});}

// Modal close
try{
  var modalBg = document.querySelector('.modal-sheet-bg');
  var modalHandle = document.querySelector('.modal-handle');
  var modalEl = document.getElementById('modal');
  function closeModal(){if(modalEl)modalEl.classList.add('hidden');}
  if(modalBg){modalBg.onclick=closeModal;modalBg.ontouchend=function(e){e.preventDefault();closeModal();};}
  if(modalHandle){modalHandle.onclick=closeModal;modalHandle.ontouchend=function(e){e.preventDefault();closeModal();};}
  // Fechar com botão de voltar (ESC)
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});
}catch(e){}

function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// Splash fallback: some em 8s mesmo se API falhar
setTimeout(()=>{const sp=document.getElementById('splash');if(sp){sp.classList.add('out');setTimeout(()=>sp.remove(),600);}},8000);

try{loadHome();}catch(e){console.error('loadHome crash:',e);var sp=document.getElementById('splash');if(sp)sp.remove();}
