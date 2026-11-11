const KEYS = ['kcal','protein','fat','carbs'];
const LABELS = {breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин',snack:'Перекус'};
const NAMES = {kcal:'ккал',protein:'Белки',fat:'Жиры',carbs:'Углеводы'};
const EMPTY = {foods:[],entries:[],weights:[]};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
export function localNutritionDate(date=new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
let selectedDate = localNutritionDate();
let view = 'journal';
const fmt = n => n == null ? '—' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
const dataOf = data => data.nutrition || EMPTY;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function fail() { throw new Error('Некорректные данные дневника питания.'); }
function text(value,max,empty=false) { if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())) fail(); }
function id(value) { if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail(); }
function validDate(value) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [y,m,d]=value.split('-').map(Number); const date=new Date(Date.UTC(y,m-1,d)); return y>=1900&&y<=2200&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d; }
function number(value,max,positive=false) { if(typeof value!=='number'||!Number.isFinite(value)||(positive?value<=0:value<0)||value>max) fail(); }
function checkFood(food) {
  if(!object(food)) fail(); id(food.id); text(food.name,150);
  if(!['manual','off'].includes(food.source)) fail();
  for(const key of KEYS) if(food[key]!==null) number(food[key],key==='kcal'?2000:100);
  if(food.barcode!==undefined&&(typeof food.barcode!=='string'||!/^\d{4,14}$/.test(food.barcode))) fail();
}
export function validateNutrition(value) {
  if(value===undefined) return undefined;
  if(!object(value)) fail();
  const limits={foods:5000,entries:50000,weights:10000};
  for(const key of Object.keys(limits)) {
    if(!Array.isArray(value[key])||value[key].length>limits[key]) fail();
    const seen=new Set();
    for(const item of value[key]) {
      if(!object(item)) fail(); id(item.id); if(seen.has(item.id)) fail(); seen.add(item.id);
      if(key==='foods') checkFood(item);
      if(key==='entries') { if(!validDate(item.date)||!Object.hasOwn(LABELS,item.meal)) fail(); number(item.grams,5000,true); checkFood(item.food); }
      if(key==='weights') { if(!validDate(item.date)) fail(); number(item.kg,500,true); text(item.note,500,true); }
    }
  }
  return value;
}
export function nutritionTotals(entries,date) {
  const result={count:0,known:{kcal:0,protein:0,fat:0,carbs:0},missing:{kcal:0,protein:0,fat:0,carbs:0}};
  for(const entry of entries) if(entry.date===date) {
    result.count++;
    for(const key of KEYS) if(entry.food[key]==null) result.missing[key]++; else result.known[key]+=entry.food[key]*entry.grams/100;
  }
  for(const key of KEYS) result[key]=result.missing[key]?null:result.known[key];
  return result;
}
export function parseOFFProduct(response) {
  if(!object(response)||response.status!==1||!object(response.product)) throw new Error('Продукт не найден. Можно внести данные с этикетки вручную.');
  const product=response.product;
  const name=[product.product_name,product.brands].filter(v=>typeof v==='string'&&v.trim()).join(' · ').slice(0,150)||'Продукт без названия';
  const food={id:uid(),name,source:'off'};
  if(typeof response.code==='string'&&/^\d{4,14}$/.test(response.code)) food.barcode=response.code;
  const fields={kcal:'energy-kcal_100g',protein:'proteins_100g',fat:'fat_100g',carbs:'carbohydrates_100g'};
  for(const key of KEYS) { const value=product.nutriments?.[fields[key]]; food[key]=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=(key==='kcal'?2000:100)?value:null; }
  return food;
}
const IDEAS = [
  ['Овсянка с молоком, банан и орехи','Гречка, курица и овощной салат','Рыба, картофель и тушёные овощи','Йогурт и фрукт'],
  ['Омлет, хлеб и помидоры','Суп с чечевицей, хлеб и сыр','Рис с индейкой и овощами','Творог с ягодами'],
  ['Творог, ягоды и тост','Макароны с мясом и салат','Овощное рагу с фасолью и хлебом','Банан и кефир'],
  ['Гречневая каша с молоком и фруктом','Рыбный суп, хлеб и овощи','Курица с булгуром и салатом','Бутерброд с сыром'],
  ['Тост с яйцом и авокадо','Рис с фасолью, овощами и сыром','Запечённая рыба с гречкой','Йогурт, фрукт и орехи'],
  ['Сырники с йогуртом и ягодами','Куриный суп, хлеб и овощи','Макароны с тунцом и томатами','Хумус с хлебом и огурцом'],
  ['Пшённая каша, молоко и груша','Картофель, индейка и овощи','Омлет с овощами, хлеб и сыр','Творог или йогурт с фруктом']
];
function tabs() { return `<div class="nut-tabs" role="group" aria-label="Раздел питания">${[['journal','Дневник'],['ideas','Идеи на неделю'],['weight','Вес']].map(([key,label])=>`<button type="button" data-nut-action="view" data-view="${key}" aria-pressed="${view===key}" class="${view===key?'nut-active':''}">${label}</button>`).join('')}</div>`; }
function foodRows(n) { return `<details class="nut-library"><summary>Мои продукты <span>${n.foods.length}</span></summary><p class="section-note">Данные с этикеток хранятся на этом устройстве.</p><button type="button" class="secondary full" data-nut-action="library-new">Добавить продукт</button>${n.foods.map(food=>`<div class="nut-library-row"><button type="button" data-nut-action="choose" data-id="${esc(food.id)}"><strong>${esc(food.name)}</strong><small>${fmt(food.kcal)} ккал / 100 г · ${food.source==='off'?'Open Food Facts':'с этикетки'}</small></button><button class="icon-btn" type="button" data-nut-action="library-edit" data-id="${esc(food.id)}" aria-label="Изменить ${esc(food.name)}">✎</button><button class="icon-btn" type="button" data-nut-action="library-delete" data-id="${esc(food.id)}" aria-label="Удалить продукт ${esc(food.name)}">×</button></div>`).join('')}</details>`; }
function journal(n) {
  const totals=nutritionTotals(n.entries,selectedDate), entries=n.entries.filter(e=>e.date===selectedDate);
  return `<div class="nut-day"><label for="nut-date">День дневника</label><input id="nut-date" type="date" value="${esc(selectedDate)}" min="1900-01-01" max="2200-12-31"></div><div class="stats-strip nut-totals">${KEYS.map(key=>`<div><strong>${fmt(totals[key])}</strong><span>${NAMES[key]}${key==='kcal'?'':' · г'}</span>${totals.missing[key]?`<small>известно ${fmt(totals.known[key])}; не всё указано</small>`:''}</div>`).join('')}</div><p class="section-note">Сумма по введённым порциям. «—» означает, что на этикетке не указаны все данные.</p><button class="primary full" type="button" data-nut-action="add">+ Добавить еду</button><div class="nut-meals">${Object.entries(LABELS).map(([meal,label])=>`<section class="nut-meal"><div class="nut-section-head"><h3>${label}</h3><button class="icon-btn" data-nut-action="add" data-meal="${meal}" type="button" aria-label="Добавить: ${label}">+</button></div>${entries.filter(e=>e.meal===meal).map(e=>`<div class="nut-entry"><button type="button" data-nut-action="edit" data-id="${esc(e.id)}"><strong>${esc(e.food.name)}</strong><span>${fmt(e.grams)} г · ${fmt(e.food.kcal==null?null:e.food.kcal*e.grams/100)} ккал</span></button><button class="icon-btn" type="button" data-nut-action="delete" data-id="${esc(e.id)}" aria-label="Удалить ${esc(e.food.name)}">×</button></div>`).join('')||'<p class="nut-empty">Пока нет записей</p>'}</section>`).join('')}</div>${foodRows(n)}<p class="nut-attribution">Поиск по штрихкоду: <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">Open Food Facts</a> · база <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL</a>. Проверяй данные по упаковке.</p>`;
}
function ideas() { return `<div class="nut-intro"><h2>Что можно приготовить</h2><p class="section-note">Идеи для разнообразия, которые можно обсудить дома и с врачом. Выбирай знакомые продукты с учётом аллергий и личных рекомендаций.</p></div>${IDEAS.map((day,index)=>`<details class="nut-idea" ${index===0?'open':''}><summary>День ${index+1}</summary><dl>${Object.values(LABELS).map((label,i)=>`<div><dt>${label}</dt><dd>${day[i]}</dd></div>`).join('')}</dl></details>`).join('')}`; }
function graph(weights) {
  if(weights.length<2) return '<p class="section-note">График появится, когда будет несколько записей.</p>';
  const values=weights.slice(-30), min=Math.min(...values.map(w=>w.kg)), max=Math.max(...values.map(w=>w.kg)), spread=Math.max(max-min,1);
  const start=Date.parse(`${values[0].date}T12:00:00Z`), end=Date.parse(`${values.at(-1).date}T12:00:00Z`);
  const points=values.map((w,i)=>{const time=Date.parse(`${w.date}T12:00:00Z`);return [end===start?24+i*272/(values.length-1):24+(time-start)*272/(end-start),120-(w.kg-min)*88/spread];});
  return `<div class="nut-chart"><svg viewBox="0 0 320 150" role="img" aria-label="График веса: от ${esc(fmt(values[0].kg))} до ${esc(fmt(values.at(-1).kg))} кг, последние ${values.length} записей"><path d="M24 120H296" class="nut-axis"/><polyline points="${points.map(p=>p.join(',')).join(' ')}" class="nut-line"/>${points.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3"/>`).join('')}<text x="24" y="144">${esc(values[0].date.slice(5).split('-').reverse().join('.'))}</text><text x="296" y="144" text-anchor="end">${esc(values.at(-1).date.slice(5).split('-').reverse().join('.'))}</text></svg><p class="section-note">${fmt(min)}–${fmt(max)} кг · до 30 последних записей</p></div>`;
}
function weights(n) {
  const sorted=[...n.weights].sort((a,b)=>a.date.localeCompare(b.date)); const last=sorted.at(-1);
  return `<div class="nut-intro"><p class="eyebrow">По желанию</p><h2>Вес на тренировке</h2><p class="section-note">Записывай, когда удобно. Вес меняется по разным причинам: сравнивай общую тенденцию, а не каждое изменение. Эти записи можно показать врачу.</p></div><div class="nut-weight-current"><strong>${last?fmt(last.kg):'—'} <span>кг</span></strong><small>${last?esc(last.date.split('-').reverse().join('.')):'Записей пока нет'}</small></div><button type="button" class="primary full" data-nut-action="weight-add">+ Записать вес</button>${graph(sorted)}<div class="nut-weight-history">${sorted.reverse().map(w=>`<div class="nut-weight-row"><div><strong>${fmt(w.kg)} кг</strong><span>${esc(w.date.split('-').reverse().join('.'))}</span>${w.note?`<p>${esc(w.note)}</p>`:''}</div><button type="button" class="icon-btn" data-nut-action="weight-delete" data-id="${esc(w.id)}" aria-label="Удалить запись веса от ${esc(w.date)}">×</button></div>`).join('')}</div>`;
}
export function renderNutrition(data) {
  const n=dataOf(data);
  return `<div class="nut-module"><p class="eyebrow">Еда и самочувствие</p><h2 class="nut-title">Питание</h2><p class="section-note">Личную цель питания согласуй с врачом. Дневник фиксирует факты по этикеткам.</p>${tabs()}${view==='ideas'?ideas():view==='weight'?weights(n):journal(n)}</div>`;
}
const nutrientInputs = food => KEYS.map(key=>`<label class="field">${NAMES[key]}${key==='kcal'?'':' · г'}<input name="${key}" inputmode="decimal" type="text" maxlength="12" value="${esc(food?.[key]??'')}" placeholder="Не указано"></label>`).join('');
function foodForm(n,{entry,food,meal='breakfast',library=false}={}) {
  const current=entry?.food||food;
  return `<div class="sheet-heading"><h2>${library?'Продукт с этикетки':entry?'Изменить запись':'Добавить еду'}</h2></div>${!library&&!entry?`<form id="nut-barcode-form"><label class="field">Найти продукт по штрихкоду<input name="barcode" inputmode="numeric" autocomplete="off" minlength="4" maxlength="14" pattern="[0-9]{4,14}" placeholder="Цифры с упаковки" required></label><button type="submit" class="secondary full">Найти в Open Food Facts</button><p class="section-note">Для поиска нужен интернет. На сервис отправляется только штрихкод.</p><p id="nut-lookup-status" role="status"></p></form>`:''}<form id="nut-food-form" data-entry="${esc(entry?.id||'')}" data-library="${library?'yes':'no'}" data-food="${esc(current?.id||'')}" data-source="${esc(current?.source||'manual')}" data-barcode="${esc(current?.barcode||'')}">${!library?`<label class="field">Из моих продуктов<select name="cached"><option value="">Ввести с этикетки</option>${n.foods.map(f=>`<option value="${esc(f.id)}" ${f.id===current?.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label>`:''}<label class="field">Название<input name="name" type="text" maxlength="150" value="${esc(current?.name||'')}" placeholder="Например, йогурт" required></label><p class="nut-label-note">Данные на 100 г с этикетки. Если значения нет, оставь поле пустым.</p><div class="nut-nutrients">${nutrientInputs(current)}</div>${!library?`<div class="entry-fields"><label class="field">Порция, г<input name="grams" type="text" inputmode="decimal" value="${esc(entry?.grams||'')}" placeholder="Сколько съел(а)" required maxlength="12"></label><label class="field">Приём пищи<select name="meal">${Object.entries(LABELS).map(([key,label])=>`<option value="${key}" ${(entry?.meal||meal)===key?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="field">Дата<input name="date" type="date" value="${esc(entry?.date||selectedDate)}" min="1900-01-01" max="2200-12-31" required></label><p class="section-note">Продукт сохранится в библиотеке и будет доступен без интернета.</p>`:''}<button class="primary full" type="submit">${library?'Сохранить продукт':'Сохранить запись'}</button></form>`;
}
function weightForm() { return `<div class="sheet-heading"><h2>Вес на тренировке</h2></div><form id="nut-weight-form"><label class="field">Дата<input type="date" name="date" value="${localNutritionDate()}" min="1900-01-01" max="2200-12-31" required></label><label class="field">Вес, кг<input name="kg" inputmode="decimal" type="text" maxlength="12" placeholder="Например, 52,4" required></label><label class="field">Заметка · необязательно<textarea name="note" maxlength="500" rows="3" placeholder="Если хочется что-то отметить"></textarea></label><button type="submit" class="primary full">Сохранить</button></form>`; }
function parseInput(value,optional=false) { const raw=String(value??'').trim().replace(',','.'); if(optional&&raw==='') return null; if(!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Проверь числа: используй цифры и запятую или точку.'); return Number(raw); }
export function installNutrition(ctx) {
  const get=()=>dataOf(ctx.getData());
  const save=async fn=>{try { const ok=await ctx.mutate(data=>{data.nutrition ||= {foods:[],entries:[],weights:[]}; fn(data.nutrition); validateNutrition(data.nutrition);}); if(ok){ctx.closeModal();ctx.render();} return ok;} catch(error){ctx.toast(error.message||'Не удалось сохранить запись.',true);return false;}};
  const showFood=options=>ctx.showModal(foodForm(get(),options));
  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-nut-action]'); if(!button)return;
    event.preventDefault(); const action=button.dataset.nutAction, itemId=button.dataset.id;
    if(action==='view') {view=button.dataset.view;ctx.render();window.scrollTo(0,0);}
    if(action==='close')ctx.closeModal();
    if(action==='add')showFood({meal:button.dataset.meal});
    if(action==='edit'){const entry=get().entries.find(e=>e.id===itemId);if(entry)showFood({entry});}
    if(action==='choose'){const food=get().foods.find(f=>f.id===itemId);if(food)showFood({food});}
    if(action==='library-new')showFood({library:true});
    if(action==='library-edit'){const food=get().foods.find(f=>f.id===itemId);if(food)showFood({food,library:true});}
    if(action==='delete')await save(n=>{n.entries=n.entries.filter(e=>e.id!==itemId);});
    if(action==='library-delete')await save(n=>{n.foods=n.foods.filter(f=>f.id!==itemId);});
    if(action==='weight-add')ctx.showModal(weightForm());
    if(action==='weight-delete')await save(n=>{n.weights=n.weights.filter(w=>w.id!==itemId);});
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='nut-date') {if(validDate(event.target.value)){selectedDate=event.target.value;ctx.render();}return;}
    if(event.target.form?.id==='nut-food-form'&&event.target.name==='cached') {
      const form=event.target.form,food=get().foods.find(f=>f.id===event.target.value);
      form.dataset.food=food?.id||'';form.dataset.source=food?.source||'manual';form.dataset.barcode=food?.barcode||'';
      for(const key of ['name',...KEYS])form.elements.namedItem(key).value=food?.[key]??'';
    }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.id?.startsWith('nut-'))return;event.preventDefault();
    const values=new FormData(form);
    if(form.id==='nut-barcode-form') {
      const barcode=String(values.get('barcode')||'').trim();if(!/^\d{4,14}$/.test(barcode)){ctx.toast('Введи от 4 до 14 цифр штрихкода.',true);return;}
      const submit=form.querySelector('button[type="submit"]'),status=form.querySelector('#nut-lookup-status'); submit.disabled=true;status.textContent='Ищем продукт…';
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try {
        const response=await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,nutriments`,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
        if(!response.ok)throw new Error('Сервис сейчас недоступен. Введи данные с этикетки вручную.');
        const body=await response.json(),food=parseOFFProduct({...body,code:barcode});
        if(!form.isConnected)return;
        const target=document.getElementById('nut-food-form'); if(!target)return;
        for(const key of ['name',...KEYS])target.elements.namedItem(key).value=food[key]??'';
        target.elements.namedItem('cached').value='';target.dataset.food='';target.dataset.source='off';target.dataset.barcode=barcode;
        status.textContent='Найдено. Проверь этикетку и укажи порцию. Продукт сохранится после добавления записи.';
      }catch(error){if(form.isConnected)status.textContent=error.name==='AbortError'?'Сервис не ответил. Проверь интернет или введи данные вручную.':(error.message||'Не удалось найти продукт. Введи данные вручную.');}
      finally{clearTimeout(timer);submit.disabled=false;}
      return;
    }
    try {
      if(form.id==='nut-weight-form') {const weight={id:uid(),date:values.get('date'),kg:parseInput(values.get('kg')),note:String(values.get('note')||'').trim()};validateNutrition({foods:[],entries:[],weights:[weight]});await save(n=>n.weights.push(weight));}
      if(form.id==='nut-food-form') {
        const food={id:form.dataset.food||uid(),name:String(values.get('name')||'').trim(),source:form.dataset.source==='off'?'off':'manual'};
        if(form.dataset.barcode)food.barcode=form.dataset.barcode;
        for(const key of KEYS)food[key]=parseInput(values.get(key),true);
        const library=form.dataset.library==='yes';
        const entry=library?null:{id:form.dataset.entry||uid(),date:values.get('date'),meal:values.get('meal'),grams:parseInput(values.get('grams')),food:{...food}};
        validateNutrition({foods:[food],entries:entry?[entry]:[],weights:[]});
        const ok=await save(n=>{
          const existing=n.foods.findIndex(f=>f.id===food.id);
          if(existing<0)n.foods.push(food);else n.foods[existing]=food;
          if(entry){const index=n.entries.findIndex(e=>e.id===entry.id);if(index<0)n.entries.push(entry);else n.entries[index]=entry;}
        });
        if(ok&&entry){selectedDate=entry.date;ctx.render();}
      }
    }catch(error){ctx.toast(error.message==='Некорректные данные дневника питания.'?'Проверь дату, название и числа. Порция: до 5000 г; данные — на 100 г.':error.message,true);}
  });
}
