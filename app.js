const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const val = s => $(s)?.value ?? '';
const num = x => {
  const n = Number(String(x ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const VLA_RATIOS = {
  neutralPowderPerL: 121.21,
  vanillaPowderPerL: 121.21,
  chocolatePowderPerL: 133.33,
  compounds: {
    'Hopjes': { pct: 3.5, granPct: 0 },
    'Karamel': { pct: 3.5, granPct: 0 },
    'Bitterkoekjes': { pct: 4.0, granPct: 1.8 },
    'Banaan': { pct: 3.5, granPct: 0 },
    'Mango-passie': { pct: 3.5, granPct: 0 }
  }
};
const CHOCO_RATIO_PER_L = 2000 / 22;
const STORAGE_KEY = 'zuivellogboek_het_boerderijwinkeltje_v3';
const SERVER_META_KEY = 'zuivellogboek_server_meta_v1';
const START_NEW_KEY = 'zuivellogboek_start_new_v1';
let isRestoring = false;
let currentLogbookId = null;
let serverLogbooks = [];
let hasUnsavedChanges = false;
let lastServerSavedSnapshot = '';

const PRODUCT_LABELS = {
  yoghurt:'Yoghurt',
  karnemelk:'Karnemelk',
  vla:'Vla',
  melk:'Gepasteuriseerde melk',
  chocomelk:'Chocolademelk'
};

let fruitSmaken = ["Naturel","Aardbei","Sinaasappel","Perzik-Maracuja","Citroen","Limoen-Cactus"];
let compoundSmaken = Object.keys(VLA_RATIOS.compounds);

function toYMDLocal(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function todayLocal(){ return toYMDLocal(new Date()); }
function addDaysLocal(iso, days){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1)-1, d || 1);
  dt.setDate(dt.getDate() + days);
  return toYMDLocal(dt);
}
function options(list){ return list.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function kv(label, value){
  const v = (value ?? '') !== '' ? value : '—';
  return `<div class="s-kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(v)}</strong></div>`;
}
function sec(title, html){ return `<div class="s-sec"><h4>${escapeHtml(title)}</h4>${html}</div>`; }
function addRemarks(out, selector){
  const text = val(selector).trim();
  if(text) out.push(sec('Opmerkingen', kv('Opmerkingen', text)));
}
function setDraftStatus(message, tone='warn'){
  const el = $('#draft-status');
  if(!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}
function comparableStateString(){
  const state = buildState();
  delete state.savedAt;
  return JSON.stringify(state);
}
function saveServerMeta(id){
  lastServerSavedSnapshot = comparableStateString();
  localStorage.setItem(SERVER_META_KEY, JSON.stringify({
    id,
    snapshot: lastServerSavedSnapshot,
    savedAt: new Date().toISOString()
  }));
}
function loadServerMeta(){
  try{
    const raw = localStorage.getItem(SERVER_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearServerMeta(){
  localStorage.removeItem(SERVER_META_KEY);
  lastServerSavedSnapshot = '';
}
function setDirty(dirty){
  hasUnsavedChanges = dirty;
  if(dirty) setDraftStatus('Niet opgeslagen', 'warn');
  else setDraftStatus(currentLogbookId ? 'Opgeslagen op server' : 'Nieuw concept', currentLogbookId ? 'ok' : 'warn');
}
function markDirty(){
  if(isRestoring) return;
  setDirty(true);
}
function confirmIfUnsaved(message='Je hebt wijzigingen die nog niet op de server staan. Toch doorgaan?'){
  return !hasUnsavedChanges || confirm(message);
}
function requiredRulesFor(product){
  const common = [{id:'bereider', label:'Bereider'}];
  const rules = {
    yoghurt:[...common,{id:'y-date',label:'Datum productie'},{id:'y-liters',label:'Liters melk'},{id:'y-programma',label:'Programma pasteur'},{id:'y-ph',label:'pH'}],
    karnemelk:[...common,{id:'km-prod-date',label:'Datum productie'},{id:'km-liters',label:'Liters melk'},{id:'km-programma',label:'Programma pasteur'},{id:'km-ph',label:'pH'}],
    vla:[...common,{id:'v-date',label:'Datum productie / afvullen'},{id:'v-liters',label:'Totale liters vla'},{id:'v-programma',label:'Programma pasteur'}],
    melk:[...common,{id:'m-date',label:'Datum productie'},{id:'m-liters',label:'Liters melk'},{id:'m-programma',label:'Programma pasteur'}],
    chocomelk:[...common,{id:'c-date',label:'Datum productie / afvullen'},{id:'c-liters',label:'Liters chocolademelk'},{id:'c-programma',label:'Programma pasteur'}]
  };
  return rules[product] || common;
}
function validateCurrentProduct(){
  $$('.missing-required').forEach(el => el.classList.remove('missing-required'));
  const product = val('#productSelect') || 'yoghurt';
  const missing = requiredRulesFor(product).filter(rule => {
    const el = document.getElementById(rule.id);
    const empty = !String(el?.value || '').trim();
    if(empty && el) el.classList.add('missing-required');
    return empty;
  });
  const box = $('#validation-warnings');
  if(!box) return missing;
  if(!missing.length){
    box.hidden = true;
    box.innerHTML = '';
    return missing;
  }
  box.hidden = false;
  box.innerHTML = `<strong>Let op: nog niet alles is ingevuld.</strong><ul>${missing.map(rule => `<li>${escapeHtml(rule.label)}</li>`).join('')}</ul>`;
  return missing;
}

function sanitizeNumber(el, {integer=false,min=0}={}){
  const raw = el.value?.trim?.() ?? '';
  if(raw === ''){ el.classList.remove('invalid'); return; }
  let n = Number(String(raw).replace(',', '.'));
  if(Number.isNaN(n)){ el.classList.add('invalid'); return; }
  if(n < min) n = min;
  if(integer) n = Math.floor(n);
  else n = Math.round(n * 100) / 100;
  el.value = String(n);
  el.classList.remove('invalid');
}
function enforceGuards(scope=document){
  scope.querySelectorAll('input[type="number"]').forEach(el => {
    if(el.step === '1'){
      el.setAttribute('inputmode','numeric');
      el.addEventListener('input',()=>sanitizeNumber(el,{integer:true,min:Number(el.min||0)}));
      el.addEventListener('blur',()=>sanitizeNumber(el,{integer:true,min:Number(el.min||0)}));
    } else {
      el.addEventListener('blur',()=>sanitizeNumber(el,{integer:false,min:Number(el.min||0)}));
    }
  });
}

function makeYoghurtRow(){
  const d = document.createElement('div');
  d.className = 'rep';
  d.innerHTML = `
    <div class="field"><label>Soort</label><select class="r-smaak">${options(fruitSmaken)}</select></div>
    <div class="field"><label>1L</label><input type="number" class="r-1l" step="1" min="0"/></div>
    <div class="field"><label>500ml</label><input type="number" class="r-500" step="1" min="0"/></div>
    <button type="button" class="btn danger remove">X</button>`;
  d.querySelector('.remove').onclick = () => { d.remove(); updateSummary(); markDirty(); };
  d.querySelectorAll('input,select').forEach(el => el.addEventListener('input', updateSummary));
  enforceGuards(d);
  return d;
}
function makeHangopRow(){
  const d = document.createElement('div');
  d.className = 'rep';
  d.innerHTML = `
    <div class="field"><label>Smaak</label><select class="h-smaak">${options(fruitSmaken)}</select></div>
    <div class="field"><label>Potten 500ml</label><input type="number" class="h-500" step="1" min="0"/></div>
    <div></div>
    <button type="button" class="btn danger remove">X</button>`;
  d.querySelector('.remove').onclick = () => { d.remove(); updateSummary(); markDirty(); };
  d.querySelectorAll('input,select').forEach(el => el.addEventListener('input', updateSummary));
  enforceGuards(d);
  return d;
}
function getCompoundCfg(name){
  return VLA_RATIOS.compounds[name] || {pct:0, granPct:0};
}
function compoundGram(liters, pct){ return Math.round(num(liters) * num(pct) * 10); } // consequent: liters × percentage × 10
function makeVlaRow(){
  const d = document.createElement('div');
  d.className = 'rep';
  d.innerHTML = `
    <div class="field"><label>Compound</label><select class="v-compound">${options(compoundSmaken)}</select></div>
    <div class="field"><label>Liters</label><input type="number" class="v-lit" step="0.1" min="0"/></div>
    <div class="muted v-calc" style="align-self:center">—</div>
    <button type="button" class="btn danger remove">X</button>`;
  d.querySelector('.remove').onclick = () => { d.remove(); syncVlaBottleRepeater(); updateSummary(); markDirty(); };
  d.querySelectorAll('input,select').forEach(el => el.addEventListener('input', () => { syncVlaBottleRepeater(); updateSummary(); }));
  d.querySelector('.v-compound').addEventListener('change', () => { syncVlaBottleRepeater(); updateSummary(); });
  enforceGuards(d);
  return d;
}
function makeBottleRow(name){
  const d = document.createElement('div');
  d.className = 'rep';
  d.innerHTML = `
    <div class="field"><label>Smaak</label><input class="v-b-name" value="${escapeHtml(name)}" readonly/></div>
    <div class="field"><label>1L</label><input type="number" class="v-b-1l" step="1" min="0"/></div>
    <div class="field"><label>500ml</label><input type="number" class="v-b-500" step="1" min="0"/></div>
    <button type="button" class="btn danger remove">X</button>`;
  d.querySelector('.remove').onclick = () => { d.remove(); updateSummary(); markDirty(); };
  d.querySelectorAll('input').forEach(el => el.addEventListener('input', updateSummary));
  enforceGuards(d);
  return d;
}
function syncVlaBottleRepeater(){
  const cont = $('#v-bottles');
  if(!cont) return;
  const type = val('#v-type') || 'neutraal';
  let names = [];
  if(type === 'neutraal') names = $$('#v-repeater .v-compound').map(s => s.value);
  if(type === 'vanille') names = ['Vanille'];
  if(type === 'chocolade') names = ['Chocolade'];

  const existing = {};
  cont.querySelectorAll('.rep').forEach(r => {
    const nm = r.querySelector('.v-b-name')?.value || '';
    existing[nm] = {
      l: r.querySelector('.v-b-1l')?.value || '',
      h: r.querySelector('.v-b-500')?.value || ''
    };
  });

  cont.innerHTML = '';
  names.forEach(n => {
    const row = makeBottleRow(n);
    if(existing[n]){
      row.querySelector('.v-b-1l').value = existing[n].l;
      row.querySelector('.v-b-500').value = existing[n].h;
    }
    cont.appendChild(row);
  });
}

function optionsWithKeep(list, keep){
  const values = [...list];
  if(keep && !values.includes(keep)) values.unshift(keep);
  return options(values);
}
function setManagedSelect(selector, values){
  const sel = $(selector);
  if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = values.length
    ? options(values)
    : '<option value="">Geen items</option>';
  if(values.includes(keep)) sel.value = keep;
}
function renderListManagement(){
  setManagedSelect('#manage-programs', currentPrograms());
  setManagedSelect('#manage-flavors', fruitSmaken);
  setManagedSelect('#manage-compounds', compoundSmaken);
}
function refreshFlavorSelects(){
  $$('#y-repeater .r-smaak').forEach(sel => { const keep=sel.value; sel.innerHTML=optionsWithKeep(fruitSmaken, keep); sel.value=keep; });
  $$('#y-hangop-repeater .h-smaak').forEach(sel => { const keep=sel.value; sel.innerHTML=optionsWithKeep(fruitSmaken, keep); sel.value=keep; });
  $$('#v-repeater .v-compound').forEach(sel => { const keep=sel.value; sel.innerHTML=optionsWithKeep(compoundSmaken, keep); sel.value=keep; });
  renderListManagement();
}
function addProgramOption(program){
  const value = String(program || '').trim();
  if(!value) return false;
  const exists = currentPrograms().some(p => p.toLowerCase() === value.toLowerCase());
  if(exists) return false;
  const opt = document.createElement('option');
  opt.value = value;
  $('#programma-lijst').appendChild(opt);
  renderListManagement();
  return true;
}
function removeProgramOption(program){
  const value = String(program || '').trim();
  if(!value) return false;
  let removed = false;
  $$('#programma-lijst option').forEach(opt => {
    if(opt.value.toLowerCase() === value.toLowerCase()){
      opt.remove();
      removed = true;
    }
  });
  renderListManagement();
  return removed;
}
function removeFromList(list, value){
  const target = String(value || '').trim().toLowerCase();
  return list.filter(item => item.toLowerCase() !== target);
}
function activeProgramInput(){
  const map = {
    yoghurt:'#y-programma',
    karnemelk:'#km-programma',
    vla:'#v-programma',
    melk:'#m-programma',
    chocomelk:'#c-programma'
  };
  return $(map[val('#productSelect') || 'yoghurt']);
}

function showForm(product){
  $$('.product-form').forEach(el => el.style.display = 'none');
  $(`#form-${product}`)?.style.setProperty('display','block');
  updateSummary();
}
function toggleDetailsByCheckbox(checkboxSel, detailsSel, clearOnClose=true){
  const on = $(checkboxSel)?.checked;
  const d = $(detailsSel);
  if(!d) return;
  d.style.display = on ? 'block' : 'none';
  if(on) d.setAttribute('open','');
  else {
    d.removeAttribute('open');
    if(clearOnClose){
      d.querySelectorAll('input').forEach(i => i.value = '');
      d.querySelectorAll('.list').forEach(l => l.innerHTML = '');
    }
  }
}
function updateDates(){
  const yDate = val('#y-date');
  $('#y-tht') && ($('#y-tht').value = addDaysLocal(yDate,16));
  $('#y-aftap-tht') && ($('#y-aftap-tht').value = addDaysLocal(yDate,16));
  $('#y-hangop-tht') && ($('#y-hangop-tht').value = addDaysLocal(yDate,16));

  const kmProd = val('#km-prod-date');
  const kmFill = val('#km-date');
  $('#km-tht') && ($('#km-tht').value = addDaysLocal(kmFill,14));
  $('#km-aftap-tht') && ($('#km-aftap-tht').value = addDaysLocal(kmProd,16));
  $('#km-boter-tht') && ($('#km-boter-tht').value = addDaysLocal(kmFill,21));

  $('#v-tht') && ($('#v-tht').value = addDaysLocal(val('#v-date'),16));
  $('#m-tht') && ($('#m-tht').value = addDaysLocal(val('#m-date'),16));
  $('#c-tht') && ($('#c-tht').value = addDaysLocal(val('#c-date'),16));
}
function updateVlaInline(){
  const type = val('#v-type') || 'neutraal';
  const liters = num(val('#v-liters'));
  const compDetails = $('#v-comp-details');
  const powderDetails = $('#v-powder-details');

  if(type === 'neutraal'){
    compDetails.style.display = 'block';
    powderDetails.style.display = 'none';
    $('#v-neutral-powder-grams').value = String(Math.round(liters * VLA_RATIOS.neutralPowderPerL) || 0);
    let totalComp = 0, totalGran = 0;
    $$('#v-repeater .rep').forEach(r => {
      const name = r.querySelector('.v-compound')?.value || '';
      const l = num(r.querySelector('.v-lit')?.value);
      const cfg = getCompoundCfg(name);
      const comp = compoundGram(l, cfg.pct);
      const gran = compoundGram(l, cfg.granPct);
      totalComp += comp; totalGran += gran;
      r.querySelector('.v-calc').textContent = gran > 0
        ? `${comp} g compound + ${gran} g granulaat`
        : `${comp} g compound`;
    });
    $('#v-comp-sum').textContent = `Totaal compound: ${totalComp} g — totaal granulaat: ${totalGran} g`;
  } else {
    compDetails.style.display = 'none';
    powderDetails.style.display = 'block';
    const ratio = type === 'vanille' ? VLA_RATIOS.vanillaPowderPerL : VLA_RATIOS.chocolatePowderPerL;
    $('#v-powder-ratio').value = String(ratio);
    $('#v-powder-grams').value = String(Math.round(liters * ratio) || 0);
  }
}
function updateChocoInline(){
  const grams = Math.round(num(val('#c-liters')) * CHOCO_RATIO_PER_L);
  $('#c-powder-grams') && ($('#c-powder-grams').value = String(grams || 0));
  $('#c-powder-ratio') && ($('#c-powder-ratio').value = CHOCO_RATIO_PER_L.toFixed(3));
}
function updateSummary(){
  updateDates();
  updateVlaInline();
  updateChocoInline();

  const product = val('#productSelect') || 'yoghurt';
  const titles = {
    yoghurt:'Samenvatting — Yoghurt',
    karnemelk:'Samenvatting — Karnemelk',
    vla:'Samenvatting — Vla',
    melk:'Samenvatting — Gepasteuriseerde melk',
    chocomelk:'Samenvatting — Chocolademelk'
  };
  $('#s-title').textContent = titles[product] || 'Samenvatting';
  validateCurrentProduct();
  const dateMap = {yoghurt:'#y-date', karnemelk:'#km-date', vla:'#v-date', melk:'#m-date', chocomelk:'#c-date'};
  const printBits = [PRODUCT_LABELS[product] || product, val(dateMap[product]), val('#bereider')].filter(Boolean);
  $('#print-meta') && ($('#print-meta').textContent = printBits.join(' - ') || 'Zuivellogboek');

  const out = [];
  out.push(sec('Algemeen', [
    kv('Product', product),
    kv('Bereider', val('#bereider'))
  ].join('')));

  if(product === 'yoghurt'){
    out.push(sec('Aanzuren en programma', [
      kv('Datum productie', val('#y-date')), kv('Start', val('#y-start')), kv('Liters melk', val('#y-liters')),
      kv('Temperatuur melk (°C)', val('#y-begintemp')), kv('Programma pasteur', val('#y-programma')),
      kv('Tijdstip cultuur', val('#y-cultuur-tijd')), kv('Cultuur (tl)', val('#y-cultuur-hoeveel')),
      kv('THT yoghurt', val('#y-tht'))
    ].join('')));
    out.push(sec('Na fermentatie', [
      kv('Datum verwerken', val('#y-verwerk-datum')), kv('Tijdstip verwerken', val('#y-verwerk-tijd')),
      kv('pH', val('#y-ph')), kv('Liters yoghurt', val('#y-yoghurt-liters'))
    ].join('')));
    const rows = $$('#y-repeater .rep').map(r => kv(r.querySelector('.r-smaak')?.value, `${r.querySelector('.r-1l')?.value || 0}×1L, ${r.querySelector('.r-500')?.value || 0}×500ml`)).join('');
    if(rows) out.push(sec('Verdeling yoghurt', rows));
    if($('#y-opt-aftap')?.checked){
      out.push(sec('Aftap melk', [
        kv('Liters aftap', val('#y-aftap-liters')), kv('Tijdstip aftap', val('#y-aftap-tijd')),
        kv('Temperatuur aftap (°C)', val('#y-aftap-temp')), kv('Flessen 1L', val('#y-aftap-1l')),
        kv('Flessen 500ml', val('#y-aftap-500')), kv('THT aftap', val('#y-aftap-tht'))
      ].join('')));
    }
    if($('#y-opt-hangop')?.checked){
      const hRows = $$('#y-hangop-repeater .rep').map(r => kv(r.querySelector('.h-smaak')?.value, `${r.querySelector('.h-500')?.value || 0}×500ml`)).join('');
      out.push(sec('Hangop', [
        kv('Liters yoghurt voor hangop', val('#y-hangop-bron-liters')),
        kv('Liters hangop', val('#y-hangop-liters')), kv('Uitlekpercentage (%)', val('#y-hangop-perc')),
        kv('Datum verwerken', val('#y-hangop-datum')), kv('Tijdstip verwerken', val('#y-hangop-tijd')),
        hRows || kv('Potten per smaak','—'),
        kv('Tijdstip in koeling', val('#y-hangop-koeltijd')),
        kv('THT hangop', val('#y-hangop-tht'))
      ].join('')));
    }
    addRemarks(out, '#y-opmerkingen');
  }

  if(product === 'karnemelk'){
    out.push(sec('Aanzuren en programma', [
      kv('Datum productie', val('#km-prod-date')), kv('Start', val('#km-start')), kv('Liters melk', val('#km-liters')),
      kv('Temperatuur melk (°C)', val('#km-temp-melk')), kv('Programma pasteur', val('#km-programma')),
      kv('Tijdstip cultuur', val('#km-cultuur-tijd')), kv('Cultuur (tl)', val('#km-cultuur-hoeveel'))
    ].join('')));
    if($('#km-opt-aftap')?.checked){
      out.push(sec('Aftap melk', [
        kv('Liters aftap', val('#km-aftap-liters')), kv('Tijdstip aftap', val('#km-aftap-tijd')),
        kv('Temperatuur aftap (°C)', val('#km-aftap-temp')), kv('Flessen 1L', val('#km-aftap-1l')),
        kv('Flessen 500ml', val('#km-aftap-500')), kv('THT aftap', val('#km-aftap-tht'))
      ].join('')));
    }
    out.push(sec('Na fermentatie', [
      kv('Datum verwerken', val('#km-verwerk-datum')), kv('Tijdstip verwerken', val('#km-verwerk-tijd')),
      kv('pH', val('#km-ph')), kv('Datum afvullen', val('#km-date')), kv('THT karnemelk', val('#km-tht'))
    ].join('')));
    out.push(sec('Flessen en boter', [
      kv('Karnemelk 1L', val('#km-1l')), kv('Karnemelk 500ml', val('#km-500')),
      kv('Roomboter pakjes 250 g', val('#km-boter') || '0'), kv('THT roomboter', val('#km-boter-tht'))
    ].join('')));
    addRemarks(out, '#km-opmerkingen');
  }

  if(product === 'vla'){
    const type = val('#v-type') || 'neutraal';
    out.push(sec('Vla', [
      kv('Datum productie / afvullen', val('#v-date')), kv('Totale liters', val('#v-liters')),
      kv('Programma pasteur', val('#v-programma')), kv('Temperatuur bij afvullen (°C)', val('#v-temp-afvullen')),
      kv('Type', type === 'neutraal' ? 'Neutraal + compound' : type === 'vanille' ? 'Vanille' : 'Chocoladevla'),
      kv('THT', val('#v-tht'))
    ].join('')));
    if(type === 'neutraal'){
      const rows = $$('#v-repeater .rep').map(r => {
        const name = r.querySelector('.v-compound')?.value || '—';
        const l = num(r.querySelector('.v-lit')?.value);
        const cfg = getCompoundCfg(name);
        const comp = compoundGram(l, cfg.pct);
        const gran = compoundGram(l, cfg.granPct);
        return kv(name, gran > 0 ? `${l} L: ${comp} g compound + ${gran} g granulaat` : `${l} L: ${comp} g compound`);
      }).join('');
      out.push(sec('Berekening', [
        kv('Neutrale poeder totaal', `${val('#v-neutral-powder-grams') || 0} g`),
        rows || kv('Compoundregels','—'),
        kv('Compoundtotalen', $('#v-comp-sum')?.textContent || '')
      ].join('')));
    } else {
      out.push(sec('Poederberekening', [
        kv('Ratio', `${val('#v-powder-ratio')} g/L`),
        kv('Benodigd poeder', `${val('#v-powder-grams') || 0} g`)
      ].join('')));
    }
    const bottles = $$('#v-bottles .rep').map(r => kv(r.querySelector('.v-b-name')?.value, `${r.querySelector('.v-b-1l')?.value || 0}×1L, ${r.querySelector('.v-b-500')?.value || 0}×500ml`)).join('');
    if(bottles) out.push(sec('Flessen per smaak', bottles));
    addRemarks(out, '#v-opmerkingen');
  }

  if(product === 'melk'){
    out.push(sec('Gepasteuriseerde melk', [
      kv('Datum productie', val('#m-date')), kv('Liters melk', val('#m-liters')),
      kv('Programma pasteur', val('#m-programma')), kv('Temperatuur bij afvullen (°C)', val('#m-temp')),
      kv('THT', val('#m-tht')), kv('Flessen 1L', val('#m-1l')), kv('Flessen 500ml', val('#m-500'))
    ].join('')));
    addRemarks(out, '#m-opmerkingen');
  }

  if(product === 'chocomelk'){
    out.push(sec('Chocolademelk', [
      kv('Datum productie / afvullen', val('#c-date')), kv('Liters chocolademelk', val('#c-liters')),
      kv('Programma pasteur', val('#c-programma')), kv('Temperatuur poeder toevoegen (°C)', val('#c-poeder-temp')),
      kv('THT', val('#c-tht'))
    ].join('')));
    out.push(sec('Poeder en flessen', [
      kv('Poederratio', `${CHOCO_RATIO_PER_L.toFixed(3)} g/L`),
      kv('Benodigd poeder', `${val('#c-powder-grams') || 0} g`),
      kv('Flessen 1L', val('#c-1l')), kv('Flessen 500ml', val('#c-500'))
    ].join('')));
    addRemarks(out, '#c-opmerkingen');
  }

  $('#s-summary').innerHTML = out.join('');
  saveState();
}


function rowValues(row, selectors){
  const data = {};
  Object.entries(selectors).forEach(([key, selector]) => data[key] = row.querySelector(selector)?.value || '');
  return data;
}
function setRowValues(row, data, selectors){
  Object.entries(selectors).forEach(([key, selector]) => {
    const el = row.querySelector(selector);
    if(el) el.value = data?.[key] || '';
  });
}
function currentPrograms(){
  return $$('#programma-lijst option').map(option => option.value).filter(Boolean);
}
function restorePrograms(programs){
  const list = $('#programma-lijst');
  if(!list || !Array.isArray(programs)) return;
  list.innerHTML = '';
  const existing = new Set();
  programs.forEach(program => {
    if(program && !existing.has(program)){
      const option = document.createElement('option');
      option.value = program;
      list.appendChild(option);
      existing.add(program);
    }
  });
}
function buildState(){
  const fields = {};
  $$('input[id], select[id], textarea[id]').forEach(el => {
    if(el.closest('header') || el.closest('#logbook-panel') || el.closest('.mobile-actionbar')) return;
    fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return {
    version: 4,
    savedAt: new Date().toISOString(),
    fields,
    fruitSmaken,
    compoundSmaken,
    compounds: VLA_RATIOS.compounds,
    programs: currentPrograms(),
    rows: {
      yoghurt: $$('#y-repeater .rep').map(row => rowValues(row, {smaak:'.r-smaak', one:'.r-1l', half:'.r-500'})),
      hangop: $$('#y-hangop-repeater .rep').map(row => rowValues(row, {smaak:'.h-smaak', half:'.h-500'})),
      vla: $$('#v-repeater .rep').map(row => rowValues(row, {compound:'.v-compound', liters:'.v-lit'})),
      vlaBottles: $$('#v-bottles .rep').map(row => rowValues(row, {name:'.v-b-name', one:'.v-b-1l', half:'.v-b-500'}))
    }
  };
}
function saveState(){
  if(isRestoring) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildState()));
  } catch(err){
    console.warn('Automatisch bewaren is niet gelukt:', err);
  }
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(err){
    console.warn('Bewaarde gegevens konden niet worden gelezen:', err);
    return null;
  }
}
function restoreState(){
  const state = loadState();
  return applyState(state);
}
function applyState(state){
  if(!state) return false;
  isRestoring = true;
  try{
    if(Array.isArray(state.fruitSmaken)) fruitSmaken = state.fruitSmaken;
    if(state.compounds && typeof state.compounds === 'object'){
      Object.assign(VLA_RATIOS.compounds, state.compounds);
      compoundSmaken = Array.isArray(state.compoundSmaken) ? state.compoundSmaken : Object.keys(VLA_RATIOS.compounds);
    }
    restorePrograms(state.programs);
    refreshFlavorSelects();
    const fields = state.fields || {};
    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if(!el) return;
      if(el.type === 'checkbox') el.checked = Boolean(value);
      else el.value = value ?? '';
    });
    $('#y-repeater').innerHTML = '';
    (state.rows?.yoghurt?.length ? state.rows.yoghurt : [{}]).forEach(data => {
      const row = makeYoghurtRow();
      setRowValues(row, data, {smaak:'.r-smaak', one:'.r-1l', half:'.r-500'});
      $('#y-repeater').appendChild(row);
    });
    $('#y-hangop-repeater').innerHTML = '';
    (state.rows?.hangop || []).forEach(data => {
      const row = makeHangopRow();
      setRowValues(row, data, {smaak:'.h-smaak', half:'.h-500'});
      $('#y-hangop-repeater').appendChild(row);
    });
    $('#v-repeater').innerHTML = '';
    (state.rows?.vla?.length ? state.rows.vla : [{}]).forEach(data => {
      const row = makeVlaRow();
      setRowValues(row, data, {compound:'.v-compound', liters:'.v-lit'});
      $('#v-repeater').appendChild(row);
    });
    syncVlaBottleRepeater();
    (state.rows?.vlaBottles || []).forEach(data => {
      let row = $$('#v-bottles .rep').find(r => r.querySelector('.v-b-name')?.value === data.name);
      if(!row && data.name){
        row = makeBottleRow(data.name);
        $('#v-bottles').appendChild(row);
      }
      if(row) setRowValues(row, data, {name:'.v-b-name', one:'.v-b-1l', half:'.v-b-500'});
    });
    toggleDetailsByCheckbox('#y-opt-aftap','#y-aftap',false);
    toggleDetailsByCheckbox('#y-opt-hangop','#y-hangop',false);
    toggleDetailsByCheckbox('#km-opt-aftap','#km-aftap',false);
    return true;
  } finally {
    isRestoring = false;
  }
}
function clearSavedState(){
  localStorage.removeItem(STORAGE_KEY);
  clearServerMeta();
}

function setServerStatus(message, tone=''){
  const el = $('#server-status');
  if(!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}
function logbookLabel(item){
  const parts = [];
  if(item.date) parts.push(item.date);
  parts.push(item.product || 'logboek');
  if(item.bereider) parts.push(item.bereider);
  return parts.join(' - ');
}
async function apiJson(url, options={}){
  const { headers, ...rest } = options;
  const res = await fetch(url, {
    cache: 'no-store',
    ...rest,
    headers: {'Content-Type':'application/json', ...(headers || {})}
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || 'Serververzoek is mislukt.');
  return data;
}

async function loadSessionInfo(){
  const logoutBtn = $('#btnLogout');
  if(!logoutBtn) return;
  try{
    const session = await apiJson('/api/session');
    logoutBtn.hidden = !session.authEnabled;
  }catch{
    logoutBtn.hidden = true;
  }
}

async function logout(){
  try{
    await fetch('/logout', { method:'POST', cache:'no-store' });
  }finally{
    location.href = '/login';
  }
}

async function loadServerLogbooks(selectId){
  const sel = $('#server-logbooks');
  if(!sel) return;
  try{
    const data = await apiJson('/api/logbooks');
    serverLogbooks = data.logbooks || [];
    sel.innerHTML = '';
    if(!serverLogbooks.length){
      sel.innerHTML = '<option value="">Geen opgeslagen logboeken</option>';
    } else {
      serverLogbooks.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = logbookLabel(item);
        sel.appendChild(opt);
      });
      if(selectId) sel.value = selectId;
    }
    renderLogbookOverview();
    setServerStatus(`Server verbonden (${serverLogbooks.length} logboeken)`, 'ok');
  } catch(err){
    serverLogbooks = [];
    sel.innerHTML = '<option value="">Server niet beschikbaar</option>';
    renderLogbookOverview();
    setServerStatus('Server niet beschikbaar', 'error');
  }
}
function renderLogbookOverview(){
  const list = $('#logbook-list');
  if(!list) return;
  const search = val('#logbook-search').toLowerCase().trim();
  const product = val('#logbook-product-filter');
  const filtered = serverLogbooks.filter(item => {
    const haystack = [item.date, item.product, PRODUCT_LABELS[item.product], item.bereider, item.title].join(' ').toLowerCase();
    return (!product || item.product === product) && (!search || haystack.includes(search));
  });
  if(!filtered.length){
    const message = serverLogbooks.length ? 'Geen logboeken gevonden met deze zoekopdracht of filter.' : 'Nog geen logboeken opgeslagen.';
    list.innerHTML = `
      <div class="empty-logbooks">
        <p class="muted">${escapeHtml(message)}</p>
        <button type="button" class="btn primary" data-action="new">Nieuw logboek starten</button>
      </div>
    `;
    return;
  }
  list.innerHTML = filtered.map(item => `
    <article class="logbook-card" data-id="${escapeHtml(item.id)}">
      <h3>${escapeHtml(PRODUCT_LABELS[item.product] || item.product || 'Logboek')}</h3>
      <div class="logbook-meta">${escapeHtml(item.date || 'Geen datum')} - ${escapeHtml(item.bereider || 'Geen bereider')}</div>
      <div class="logbook-meta">Laatst gewijzigd: ${escapeHtml(formatDateTime(item.updatedAt))}</div>
      <div class="logbook-actions">
        <button type="button" class="btn primary" data-action="open" data-id="${escapeHtml(item.id)}">Openen</button>
        <button type="button" class="btn" data-action="pdf" data-id="${escapeHtml(item.id)}">PDF</button>
        <button type="button" class="btn danger" data-action="delete" data-id="${escapeHtml(item.id)}">Verwijderen</button>
      </div>
    </article>
  `).join('');
}
function formatDateTime(iso){
  if(!iso) return 'onbekend';
  const dt = new Date(iso);
  if(Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('nl-NL', {dateStyle:'short', timeStyle:'short'});
}
function showLogbookPanel(options={}){
  const shouldScroll = options.scroll !== false;
  const panel = $('#logbook-panel');
  if(!panel) return;
  panel.hidden = false;
  document.body.classList.remove('header-hidden');
  loadServerLogbooks(currentLogbookId);
  if(shouldScroll) panel.scrollIntoView({behavior:'smooth', block:'start'});
}
function focusLogbookOverview(){
  const panel = $('#logbook-panel');
  if(!panel) return;
  panel.scrollIntoView({behavior:'auto', block:'start'});
  if(window.matchMedia('(max-width: 760px)').matches) document.body.classList.add('header-hidden');
}
function hideLogbookPanel(){
  const panel = $('#logbook-panel');
  if(panel) panel.hidden = true;
}
function downloadFromServer(url){
  window.location.href = url;
}
async function saveCurrentLogbookToServer(){
  updateSummary();
  try{
    const item = await apiJson('/api/logbooks', {
      method: 'POST',
      body: JSON.stringify({ id: currentLogbookId, state: buildState() })
    });
    currentLogbookId = item.id;
    saveServerMeta(item.id);
    setDirty(false);
    await loadServerLogbooks(currentLogbookId);
    setServerStatus('Logboek opgeslagen op server', 'ok');
  } catch(err){
    setServerStatus(err.message, 'error');
  }
}
async function openSelectedLogbook(){
  const id = val('#server-logbooks');
  return openLogbookById(id);
}
async function openLogbookById(id){
  if(!id) return false;
  if(!confirmIfUnsaved('Je hebt wijzigingen die nog niet op de server staan. Toch een ander logboek openen?')) return false;
  try{
    const item = await apiJson(`/api/logbooks/${encodeURIComponent(id)}`);
    currentLogbookId = item.id;
    applyState(item.state);
    showForm(val('#productSelect') || 'yoghurt');
    updateSummary();
    saveState();
    saveServerMeta(item.id);
    setDirty(false);
    hideLogbookPanel();
    document.querySelector('main')?.scrollIntoView({behavior:'smooth', block:'start'});
    setServerStatus('Logboek geopend', 'ok');
    return true;
  } catch(err){
    setServerStatus(err.message, 'error');
    return false;
  }
}
async function deleteSelectedLogbook(){
  const id = val('#server-logbooks');
  return deleteLogbookById(id);
}
async function deleteLogbookById(id){
  if(!id) return;
  if(!confirm('Dit logboek van de server verwijderen?')) return;
  try{
    await apiJson(`/api/logbooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if(currentLogbookId === id){
      currentLogbookId = null;
      clearServerMeta();
      setDirty(true);
    }
    await loadServerLogbooks();
    setServerStatus('Logboek verwijderd', 'ok');
  } catch(err){
    setServerStatus(err.message, 'error');
  }
}
async function printLogbookById(id){
  const opened = await openLogbookById(id);
  if(opened) window.setTimeout(() => window.print(), 200);
}
function newServerLogbook(){
  if(!confirmIfUnsaved('Je hebt wijzigingen die nog niet op de server staan. Toch een nieuw logboek starten?')) return;
  currentLogbookId = null;
  clearSavedState();
  sessionStorage.setItem(START_NEW_KEY, '1');
  location.reload();
}
function setupAutoHidingHeader(){
  const header = document.querySelector('header');
  if(!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  const minDelta = 8;
  const showAtTop = 24;

  function updateHeader(){
    const currentY = window.scrollY;
    const movingDown = currentY > lastY + minDelta;
    const movingUp = currentY < lastY - minDelta;
    const focusedInHeader = header.contains(document.activeElement);

    if(currentY <= showAtTop || movingUp || focusedInHeader){
      document.body.classList.remove('header-hidden');
    } else if(movingDown && currentY > header.offsetHeight){
      document.body.classList.add('header-hidden');
    }

    if(Math.abs(currentY - lastY) > minDelta) lastY = currentY;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if(!window.matchMedia('(max-width: 760px)').matches) {
      document.body.classList.remove('header-hidden');
      lastY = window.scrollY;
      return;
    }
    if(!ticking){
      window.requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', () => {
    if(!window.matchMedia('(max-width: 760px)').matches) document.body.classList.remove('header-hidden');
  });
  header.addEventListener('focusin', () => document.body.classList.remove('header-hidden'));
}

function fillDemo(){
  const today = todayLocal();
  $('#bereider').value = 'Annemiek';

  $('#y-date').value=today; $('#y-start').value='08:30'; $('#y-liters').value='120'; $('#y-begintemp').value='7.2'; $('#y-programma').value='85°C 20 min'; $('#y-cultuur-tijd').value='09:10'; $('#y-cultuur-hoeveel').value='8';
  $('#y-verwerk-datum').value=today; $('#y-verwerk-tijd').value='14:00'; $('#y-ph').value='4.35'; $('#y-yoghurt-liters').value='110';
  $('#y-repeater').innerHTML=''; const yr1=makeYoghurtRow(), yr2=makeYoghurtRow(); yr1.querySelector('.r-smaak').value='Naturel'; yr1.querySelector('.r-1l').value='20'; yr1.querySelector('.r-500').value='12'; yr2.querySelector('.r-smaak').value='Aardbei'; yr2.querySelector('.r-1l').value='18'; yr2.querySelector('.r-500').value='20'; $('#y-repeater').append(yr1,yr2);
  $('#y-opt-aftap').checked=true; toggleDetailsByCheckbox('#y-opt-aftap','#y-aftap',false);
  $('#y-aftap-liters').value='30'; $('#y-aftap-tijd').value='10:30'; $('#y-aftap-temp').value='32'; $('#y-aftap-1l').value='10'; $('#y-aftap-500').value='5';
  $('#y-opt-hangop').checked=true; toggleDetailsByCheckbox('#y-opt-hangop','#y-hangop',false);
  $('#y-hangop-bron-liters').value='25'; $('#y-hangop-liters').value='12'; $('#y-hangop-perc').value='48'; $('#y-hangop-datum').value=today; $('#y-hangop-tijd').value='14:00'; $('#y-hangop-koeltijd').value='15:10';
  $('#y-hangop-repeater').innerHTML=''; const hr1=makeHangopRow(), hr2=makeHangopRow(); hr1.querySelector('.h-smaak').value='Naturel'; hr1.querySelector('.h-500').value='20'; hr2.querySelector('.h-smaak').value='Aardbei'; hr2.querySelector('.h-500').value='12'; $('#y-hangop-repeater').append(hr1,hr2);

  $('#km-prod-date').value=today; $('#km-start').value='08:00'; $('#km-liters').value='90'; $('#km-temp-melk').value='7'; $('#km-programma').value='63°C 30 min'; $('#km-cultuur-tijd').value='09:00'; $('#km-cultuur-hoeveel').value='6'; $('#km-verwerk-datum').value=today; $('#km-verwerk-tijd').value='13:00'; $('#km-ph').value='4.45'; $('#km-date').value=today; $('#km-1l').value='50'; $('#km-500').value='60'; $('#km-boter').value='12';

  $('#v-date').value=today; $('#v-liters').value='100'; $('#v-programma').value='90°C 10 min'; $('#v-temp-afvullen').value='8'; $('#v-type').value='neutraal';
  $('#v-repeater').innerHTML=''; const vr1=makeVlaRow(), vr2=makeVlaRow(); $('#v-repeater').append(vr1,vr2); vr1.querySelector('.v-compound').value='Karamel'; vr1.querySelector('.v-lit').value='60'; vr2.querySelector('.v-compound').value='Bitterkoekjes'; vr2.querySelector('.v-lit').value='40'; syncVlaBottleRepeater();
  $$('#v-bottles .rep').forEach(r => { const n=r.querySelector('.v-b-name').value; if(n==='Karamel'){ r.querySelector('.v-b-1l').value='30'; r.querySelector('.v-b-500').value='40'; } if(n==='Bitterkoekjes'){ r.querySelector('.v-b-1l').value='20'; r.querySelector('.v-b-500').value='40'; }});

  $('#m-date').value=today; $('#m-liters').value='60'; $('#m-programma').value='63°C 30 min'; $('#m-temp').value='6'; $('#m-1l').value='30'; $('#m-500').value='20';

  $('#c-date').value=today; $('#c-liters').value='80'; $('#c-programma').value='85°C 20 min'; $('#c-poeder-temp').value='70'; $('#c-1l').value='40'; $('#c-500').value='50';

  updateSummary();
  markDirty();
}

function init(){
  $('#productSelect').addEventListener('change', e => { showForm(e.target.value); markDirty(); });
  $('#y-opt-aftap').addEventListener('change', () => { toggleDetailsByCheckbox('#y-opt-aftap','#y-aftap'); updateSummary(); markDirty(); });
  $('#y-opt-hangop').addEventListener('change', () => { toggleDetailsByCheckbox('#y-opt-hangop','#y-hangop'); updateSummary(); markDirty(); });
  $('#km-opt-aftap').addEventListener('change', () => { toggleDetailsByCheckbox('#km-opt-aftap','#km-aftap'); updateSummary(); markDirty(); });

  $('#y-add').addEventListener('click', () => { $('#y-repeater').appendChild(makeYoghurtRow()); updateSummary(); markDirty(); });
  $('#y-hangop-add').addEventListener('click', () => { $('#y-hangop-repeater').appendChild(makeHangopRow()); updateSummary(); markDirty(); });
  $('#v-add').addEventListener('click', () => { $('#v-repeater').appendChild(makeVlaRow()); syncVlaBottleRepeater(); updateSummary(); markDirty(); });
  $('#v-type').addEventListener('change', () => { syncVlaBottleRepeater(); updateSummary(); markDirty(); });

  $('#demoBtn').addEventListener('click', fillDemo);
  $('#btnNewLogbook').addEventListener('click', newServerLogbook);
  $('#btnSaveServer').addEventListener('click', saveCurrentLogbookToServer);
  $('#btnShowLogbooks').addEventListener('click', showLogbookPanel);
  $('#btnRefreshLogbooks').addEventListener('click', () => loadServerLogbooks(currentLogbookId));
  $('#btnOpenLogbook').addEventListener('click', openSelectedLogbook);
  $('#btnDeleteLogbook').addEventListener('click', deleteSelectedLogbook);
  $('#btnLogout').addEventListener('click', logout);
  $('#btnPanelNewLogbook').addEventListener('click', newServerLogbook);
  $('#btnDownloadBackup').addEventListener('click', () => downloadFromServer('/api/backup'));
  $('#btnDownloadCsv').addEventListener('click', () => downloadFromServer('/api/logbooks.csv'));
  $('#btnCloseLogbooks').addEventListener('click', hideLogbookPanel);
  $('#btnRefreshPanel').addEventListener('click', () => loadServerLogbooks(currentLogbookId));
  $('#logbook-search').addEventListener('input', renderLogbookOverview);
  $('#logbook-product-filter').addEventListener('change', renderLogbookOverview);
  $('#logbook-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.dataset.id;
    if(btn.dataset.action === 'new') return newServerLogbook();
    if(btn.dataset.action === 'open') openLogbookById(id);
    if(btn.dataset.action === 'delete') deleteLogbookById(id);
    if(btn.dataset.action === 'pdf') printLogbookById(id);
  });
  $('#mobileSaveServer').addEventListener('click', saveCurrentLogbookToServer);
  $('#mobileNewLogbook').addEventListener('click', newServerLogbook);
  $('#mobileShowLogbooks').addEventListener('click', showLogbookPanel);
  $('#resetBtn').addEventListener('click', () => {
    if(confirm('Alle ingevulde en automatisch bewaarde gegevens leegmaken?')){
      clearSavedState();
      location.reload();
    }
  });
  $('#printBtn').addEventListener('click', () => {
    const prod = val('#productSelect') || 'product';
    const dateMap = {yoghurt:'#y-date', karnemelk:'#km-date', vla:'#v-date', melk:'#m-date', chocomelk:'#c-date'};
    const date = val(dateMap[prod]) || todayLocal();
    document.title = `${prod}_${date}`;
    window.print();
  });

  $('#btnAddFlavor').addEventListener('click', () => {
    const v = String(prompt('Nieuwe fruitsmaak:') || '').trim();
    if(v && !fruitSmaken.some(s => s.toLowerCase() === v.toLowerCase())){
      fruitSmaken.push(v);
      refreshFlavorSelects();
      updateSummary();
      markDirty();
      saveState();
    }
  });
  $('#btnRemoveFlavor').addEventListener('click', () => {
    const v = val('#manage-flavors');
    if(!v) return;
    fruitSmaken = removeFromList(fruitSmaken, v);
    refreshFlavorSelects();
    updateSummary();
    markDirty();
    saveState();
  });
  $('#btnAddCompound').addEventListener('click', () => {
    const name = String(prompt('Nieuwe compound/smaak voor vla:') || '').trim();
    if(!name || compoundSmaken.some(s => s.toLowerCase() === name.toLowerCase())) return;
    const pct = Math.max(0, Number(String(prompt(`Compoundpercentage voor "${name}"? Bijvoorbeeld 3.5`) || '').replace(',','.')) || 0);
    const granPct = Math.max(0, Number(String(prompt(`Granulaatpercentage voor "${name}"? Leeg of 0 als niet van toepassing`) || '').replace(',','.')) || 0);
    compoundSmaken.push(name);
    VLA_RATIOS.compounds[name] = {pct, granPct};
    refreshFlavorSelects(); syncVlaBottleRepeater(); updateSummary();
    markDirty();
    saveState();
  });
  $('#btnRemoveCompound').addEventListener('click', () => {
    const name = val('#manage-compounds');
    if(!name) return;
    compoundSmaken = removeFromList(compoundSmaken, name);
    refreshFlavorSelects();
    syncVlaBottleRepeater();
    updateSummary();
    markDirty();
    saveState();
  });
  $('#btnAddProgram').addEventListener('click', () => {
    const v = String(prompt('Nieuw pasteurprogramma, bijvoorbeeld 63°C 30 min:') || '').trim();
    if(addProgramOption(v)){
      const input = activeProgramInput();
      if(input) input.value = v;
      updateSummary();
      markDirty();
      saveState();
    }
  });
  $('#btnRemoveProgram').addEventListener('click', () => {
    const v = val('#manage-programs');
    if(!v) return;
    if(removeProgramOption(v)){
      updateSummary();
      markDirty();
      saveState();
    }
  });

  document.addEventListener('input', e => {
    if(e.target.matches('input,select,textarea')){
      updateSummary();
      if(!e.target.closest('#logbook-panel') && !e.target.closest('.server-toolbar')) markDirty();
    }
  });

  enforceGuards(document);
  $('#y-repeater').appendChild(makeYoghurtRow());
  $('#v-repeater').appendChild(makeVlaRow());
  syncVlaBottleRepeater();
  const startNew = sessionStorage.getItem(START_NEW_KEY) === '1';
  sessionStorage.removeItem(START_NEW_KEY);
  const restored = restoreState();
  renderListManagement();
  setupAutoHidingHeader();
  showForm(val('#productSelect') || 'yoghurt');
  updateSummary();
  const meta = loadServerMeta();
  if(restored && meta?.id && meta.snapshot === comparableStateString()){
    currentLogbookId = meta.id;
    lastServerSavedSnapshot = meta.snapshot;
    setDirty(false);
  } else {
    setDirty(Boolean(restored));
  }
  loadSessionInfo();
  loadServerLogbooks();
  if(startNew){
    hideLogbookPanel();
    document.querySelector('main')?.scrollIntoView({behavior:'auto', block:'start'});
  } else {
    showLogbookPanel({scroll:false});
    window.setTimeout(focusLogbookOverview, 0);
  }
}
window.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(err => {
      console.warn('Offline ondersteuning kon niet worden gestart:', err);
    });
  });
}
