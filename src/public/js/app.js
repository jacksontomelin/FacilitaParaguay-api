const A='/api';let cPage='home',pPage=1,pLoading=false,stockOn=false;

// Init icons
document.getElementById('dark-toggle').innerHTML=icon(localStorage.cp_d==='true'?'sun':'moon',16);
document.getElementById('w-ico').innerHTML=icon('heart',16);
document.getElementById('sb-ico').innerHTML=icon('search',18);
document.getElementById('bn1').innerHTML=icon('fire',20);
document.getElementById('bn2').innerHTML=icon('search',20);
document.getElementById('bn3').innerHTML=icon('tag',20);
document.getElementById('bn4').innerHTML=icon('scale',20);
document.getElementById('bn5').innerHTML=icon('chart',20);
document.getElementById('s1').innerHTML=icon('fire',20);
document.getElementById('s2').innerHTML=icon('newBadge',20);
document.getElementById('s3').innerHTML=icon('priceDown',20);
document.getElementById('s4').innerHTML=icon('trending',20);
const s5=document.getElementById('s5');if(s5)s5.innerHTML=icon('eye',20);
document.getElementById('m1').innerHTML=icon('bell',22);
document.getElementById('m2').innerHTML=icon('calc',22);
document.getElementById('m3').innerHTML=icon('heart',22);
document.getElementById('m4').innerHTML=icon('chart',22);
document.getElementById('m5').innerHTML=icon('save',22);
const m6=document.getElementById('m6');if(m6)m6.innerHTML=icon('scale',22);
document.getElementById('bn6').innerHTML=icon('bridge',20);
const tgIco=document.getElementById('tg-ico');if(tgIco)tgIco.innerHTML=icon('telegram',16);
const cdeIco=document.getElementById('cde-ico');if(cdeIco)cdeIco.innerHTML=icon('camera',16);

// Dark mode
if(localStorage.cp_d==='true')document.documentElement.dataset.theme='dark';
document.getElementById('dark-toggle').onclick=()=>{const d=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=d?'dark':'';localStorage.cp_d=d;document.getElementById('dark-toggle').innerHTML=icon(d?'sun':'moon',16);};

// Wishlist
const WL={g(){try{return JSON.parse(localStorage.cp_w||'[]')}catch{return[]}},h(id){return this.g().some(w=>w.id===id)},
  t(p){const l=this.g();const i=l.findIndex(w=>w.id===p.id);if(i>=0)l.splice(i,1);else l.push({id:p.id,name:p.name,price:p.price_usd,image:p.image_url,store:p.store_name,url:p.product_url});localStorage.cp_w=JSON.stringify(l);updWC();return i<0;}};
function updWC(){document.getElementById('w-cnt').textContent=WL.g().length;}updWC();
document.getElementById('wish-toggle').onclick=()=>switchPage('wishlist');

// Recent
const RV={g(){try{return JSON.parse(localStorage.cp_r||'[]')}catch{return[]}},
  a(p){let l=this.g().filter(r=>r.id!==p.id);l.unshift({id:p.id,name:p.name,price:p.price_usd,image:p.image_url,store:p.store_name});if(l.length>20)l=l.slice(0,20);localStorage.cp_r=JSON.stringify(l);}};

// API
async function api(p){return(await fetch(A+p)).json();}
function showSO(m){const o=document.getElementById('search-overlay');o.querySelector('.so-text').textContent=m||'Buscando...';o.classList.remove('hidden');}
function hideSO(){document.getElementById('search-overlay').classList.add('hidden');}
function toast(m){const t=document.getElementById('toast');t.querySelector('span').textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200);}

// === NAVIGATION ===
document.querySelectorAll('.bnav').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));
function switchPage(pg){
  document.querySelectorAll('.bnav').forEach(b=>b.classList.toggle('active',b.dataset.page===pg));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById('page-'+pg);if(el)el.classList.add('active');cPage=pg;
  ({home:loadHome,search:loadSearch,promos:loadPromos,compare:()=>{},alerts:loadAlerts,dash:loadDash,wishlist:loadWL,ponte:loadPonte,more:()=>{}}[pg]||Function)();
}

// === PONTE / CAMERAS / COTAÇÃO ===
async function loadPonte(){
  showSO('Carregando câmeras...');
  const data = await api('/ponte-status');
  hideSO();

  // Cotação
  const c = data.cotacao;
  document.getElementById('cotacao-bar').innerHTML = `
    <div class="cot-card"><div class="cot-pair">${icon('dollar',13)} USD/BRL</div><div class="cot-val">R$ ${c.usd_brl?.toFixed(2)||'--'}</div></div>
    <div class="cot-card"><div class="cot-pair">${icon('dollar',13)} USD/PYG</div><div class="cot-val">Gs ${Math.round(c.usd_pyg||0).toLocaleString()}</div></div>
    <div class="cot-card"><div class="cot-pair">${icon('dollar',13)} BRL/PYG</div><div class="cot-val">Gs ${Math.round(c.brl_pyg||0).toLocaleString()}</div></div>`;

  // Atualizar câmbio na calculadora
  const calcDolar = document.getElementById('c-dolar');
  if (calcDolar && c.usd_brl) calcDolar.value = c.usd_brl.toFixed(2);

  // Câmeras (mostrar as 3 primeiras, resto colapsado)
  const cams = data.cameras || [];
  document.getElementById('cam-grid').innerHTML = cams.map((cam, i) => `
    <div class="cam-card">
      <div class="cam-header">
        <div>
          <div class="cam-name">${icon('camera',13)} ${cam.name}</div>
          <div class="cam-source">${cam.source}</div>
        </div>
        <div class="cam-live">AO VIVO</div>
      </div>
      ${i < 3 ? `<iframe src="${cam.type === 'youtube' ? cam.url : cam.url}" 
        allow="autoplay; encrypted-media" allowfullscreen loading="lazy"
        sandbox="allow-scripts allow-same-origin"></iframe>` : ''}
      ${i >= 3 ? `<div style="padding:16px;text-align:center;color:var(--sub);font-size:.82rem;cursor:pointer" 
        onclick="this.innerHTML='<iframe src=\\'${cam.url}\\' style=\\'width:100%;height:200px;border:none\\' allow=\\'autoplay\\' allowfullscreen loading=\\'lazy\\' sandbox=\\'allow-scripts allow-same-origin\\'></iframe>'">
        Toque para carregar
      </div>` : ''}
      <a href="${cam.url}" target="_blank" class="cam-expand">${icon('arrowRight',12)} Abrir tela cheia</a>
    </div>`).join('');
}
}

// === AUTOCOMPLETE ===
const gS=document.getElementById('global-search'),acD=document.getElementById('ac-drop');let acT;
gS.oninput=()=>{clearTimeout(acT);const q=gS.value.trim();if(q.length<2){acD.classList.add('hidden');return;}
  acT=setTimeout(async()=>{const r=await api('/autocomplete?q='+encodeURIComponent(q));if(!r.length){acD.classList.add('hidden');return;}
    acD.innerHTML=r.map(r=>`<div class="ac-item" onclick="openProduct(${r.id});acD.classList.add('hidden');gS.value='';">
      ${r.image_url?`<img src="${r.image_url}" onerror="this.style.display='none'">`:`<span style="width:40px">${icon('noImage',24)}</span>`}
      <div style="flex:1;font-size:.82rem">${esc(r.name)}</div>
      <div style="text-align:right"><div style="color:var(--blue);font-weight:700;font-size:.82rem">${r.min_price?'US$ '+r.min_price:''}</div><div style="color:var(--sub);font-size:.65rem">${r.store_count} loja${r.store_count>1?'s':''}</div></div>
    </div>`).join('');acD.classList.remove('hidden');},280);};
gS.onkeypress=e=>{if(e.key==='Enter'){acD.classList.add('hidden');switchPage('search');setTimeout(()=>{document.getElementById('f-store').value='';loadSearch();},100);}};
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))acD.classList.add('hidden');});

// === HOME ===
async function loadHome(){
  showSO('Buscando ofertas...');
  const[d,t]=await Promise.all([api('/deals'),api('/trending')]);hideSO();
  document.getElementById('splash')?.classList.add('out');setTimeout(()=>document.getElementById('splash')?.remove(),600);
  hScroll('h-disc',d.biggest_discount||[]);hScroll('h-new',d.new_arrival||[]);hScroll('h-drops',d.price_drop||[]);hScroll('h-trend',t||[]);
  // Ticker
  const all=[...(d.biggest_discount||[]),...(d.price_drop||[])].filter(x=>x.discount_percent>5);
  if(all.length){const it=all.map(x=>`<span class="ticker-item"><span class="ticker-badge">${icon('percent',10)} -${x.discount_percent}%</span> ${esc(x.name?.substring(0,40))} <strong>US$ ${parseFloat(x.price_usd).toFixed(2)}</strong></span>`).join('');
    document.getElementById('ticker').innerHTML=`<div class="ticker-inner">${it}${it}</div>`;}
  // Chips
  document.getElementById('cat-chips').innerHTML=[
    {l:'Descontos',c:'chip-fire',q:'discount'},{l:'Novidades',c:'chip-new',q:'newest'},
    {l:'Perfumes',c:'chip-perf',q:'perfume'},{l:'Tech',c:'chip-tech',q:'celular'},
    {l:'Games',c:'chip-game',q:'playstation'},{l:'Casa',c:'chip-home',q:'air fryer'}
  ].map(c=>`<button class="chip ${c.c}" onclick="gS.value='${c.q}';switchPage('search')">${c.l}</button>`).join('');
  // Recent
  const rv=RV.g();if(rv.length){document.getElementById('rv-sec').classList.remove('hidden');
    hScroll('h-recent',rv.map(r=>({...r,price_usd:r.price,image_url:r.image,store_name:r.store})));}
  // Populate selects
  const stores=await api('/stores');const o='<option value="">Loja</option>'+stores.map(s=>`<option value="${s.slug}">${s.name}</option>`).join('');
  ['f-store','ex-store'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=o;});
  const br=await api('/brands');document.getElementById('f-brand').innerHTML='<option value="">Marca</option>'+br.slice(0,50).map(b=>`<option value="${b.brand}">${b.brand}</option>`).join('');
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
obs.observe(document.getElementById('p-loader'));
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
document.getElementById('cmp-btn').onclick=async()=>{const q=document.getElementById('cmp-input').value;if(!q)return;
  showSO('Comparando em 20 lojas...');const d=await api(`/compare?search=${encodeURIComponent(q)}`);hideSO();
  document.getElementById('cmp-results').innerHTML=d.groups?.length?d.groups.map(g=>`
    <div class="cmp-group"><h4>${esc(g.name)}</h4>
    ${g.savings>0?`<div class="cmp-savings">${icon('coins',14)} Economia US$ ${g.savings.toFixed(2)}</div>`:''}
    ${g.stores.map((s,i)=>`<div class="cmp-row"><span>${s.store}</span><span class="${i===0?'cmp-best':''}">US$ ${s.price.toFixed(2)} ${s.is_promo?icon('tag',11):''}</span></div>`).join('')}</div>`).join(''):'<p class="empty">Nenhum resultado</p>';};
document.getElementById('cmp-input').onkeypress=e=>{if(e.key==='Enter')document.getElementById('cmp-btn').click();};

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
document.getElementById('a-hrs').onchange=loadAlerts;document.getElementById('a-min').onchange=loadAlerts;

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
document.getElementById('ex-btn').onclick=()=>{const s=document.getElementById('ex-store').value,f=document.getElementById('ex-fmt').value,
  p=document.getElementById('ex-promo').checked?'&promo_only=true':'';window.open(`${A}/export?format=${f}&store=${s}${p}`,'_blank');};

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
document.querySelector('.modal-sheet-bg')?.addEventListener('click',()=>document.getElementById('modal').classList.add('hidden'));
document.querySelector('.modal-handle')?.addEventListener('click',()=>document.getElementById('modal').classList.add('hidden'));

function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
loadHome();
