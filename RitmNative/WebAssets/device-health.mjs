const MAX_SAMPLES = 50000, MAX_XML = 20 * 1024 * 1024;
const TYPES = {
  steps: {unit:'count',min:0,max:1000000}, heartRate:{unit:'bpm',min:1,max:350},
  restingHeartRate:{unit:'bpm',min:1,max:350}, activeEnergy:{unit:'kcal',min:0,max:100000},
  distance:{unit:'m',min:0,max:1000000}, oxygen:{unit:'%',min:0,max:100}, sleep:{unit:'category'}
};
const STAGES = ['awake','core','deep','rem','asleep','inBed'];
const APPLE = {
  HKQuantityTypeIdentifierStepCount:'steps', HKQuantityTypeIdentifierHeartRate:'heartRate',
  HKQuantityTypeIdentifierRestingHeartRate:'restingHeartRate', HKQuantityTypeIdentifierActiveEnergyBurned:'activeEnergy',
  HKQuantityTypeIdentifierDistanceWalkingRunning:'distance', HKQuantityTypeIdentifierOxygenSaturation:'oxygen',
  HKCategoryTypeIdentifierSleepAnalysis:'sleep'
};
const APPLE_SLEEP = {
  HKCategoryValueSleepAnalysisAwake:'awake', HKCategoryValueSleepAnalysisAsleepCore:'core',
  HKCategoryValueSleepAnalysisAsleepDeep:'deep', HKCategoryValueSleepAnalysisAsleepREM:'rem',
  HKCategoryValueSleepAnalysisAsleepUnspecified:'asleep', HKCategoryValueSleepAnalysisAsleep:'asleep',
  HKCategoryValueSleepAnalysisInBed:'inBed'
};
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail = message => { throw new Error(message || 'Некорректный архив показателей.'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function keys(value,allowed) { if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k))) fail(); }
function string(value,max) { if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value)) fail(); }
function localDate(d=new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dayBounds(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Проверь выбранную дату.');
  const [y,m,d]=value.split('-').map(Number), start=new Date(y,m-1,d);
  if(y<2000||y>2100||localDate(start)!==value) fail('Проверь выбранную дату.');
  return [start.getTime(),new Date(y,m-1,d+1).getTime()];
}
// Parse an explicit timezone and verify calendar fields before Date.parse can normalize them.
function timestamp(value) {
  if(typeof value!=='string') fail();
  const match=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:\s?)(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if(!match) fail('В записи нет корректной даты с часовым поясом.');
  const [,ys,ms,ds,hs,mins,ss,fraction='',zone]=match;
  const [y,m,d,h,mi,s]=[ys,ms,ds,hs,mins,ss].map(Number), calendar=new Date(Date.UTC(y,m-1,d));
  if(y<2000||y>2100||calendar.getUTCFullYear()!==y||calendar.getUTCMonth()!==m-1||calendar.getUTCDate()!==d||h>23||mi>59||s>59) fail();
  if(zone!=='Z') { const z=zone.replace(':',''); if(Number(z.slice(1,3))>14||Number(z.slice(3))>59||(Number(z.slice(1,3))===14&&Number(z.slice(3))!==0)) fail(); }
  const iso=`${ys}-${ms}-${ds}T${hs}:${mins}:${ss}${fraction?'.'+fraction:''}${zone==='Z'?'Z':zone.replace(/^([+-]\d{2})(\d{2})$/,'$1:$2')}`;
  const time=Date.parse(iso);
  if(!Number.isFinite(time)||time<Date.UTC(2000,0,1)||time>Date.now()+86400000) fail('Дата записи вне допустимого диапазона.');
  return time;
}
function validateSample(sample) {
  keys(sample,['id','type','startAt','endAt','value','unit','source']);
  if(typeof sample.id!=='string'||!/^[-_a-zA-Z0-9]{1,100}$/.test(sample.id)||typeof sample.type!=='string'||!Object.hasOwn(TYPES,sample.type)) fail();
  string(sample.source,200);
  const start=timestamp(sample.startAt), end=timestamp(sample.endAt);
  if(end<start||end-start>31*86400000) fail('Некорректный интервал записи.');
  const rule=TYPES[sample.type];
  if(sample.unit!==rule.unit) fail();
  if(sample.type==='sleep') { if(!STAGES.includes(sample.value)||end===start) fail(); }
  else if(typeof sample.value!=='number'||!Number.isFinite(sample.value)||sample.value<rule.min||sample.value>rule.max||(sample.type==='steps'&&!Number.isInteger(sample.value))) fail();
}
export function validateDeviceHealth(value) {
  if(value===undefined) return undefined;
  keys(value,['samples','lastImportedAt']);
  if(!Array.isArray(value.samples)||value.samples.length>MAX_SAMPLES||typeof value.lastImportedAt!=='number'||!Number.isInteger(value.lastImportedAt)||value.lastImportedAt<Date.UTC(2000,0,1)||value.lastImportedAt>Date.now()+86400000) fail();
  const ids=new Set(), identities=new Set();
  for(const sample of value.samples) { validateSample(sample); const identity=sampleKey(sample); if(ids.has(sample.id)||identities.has(identity)) fail('Архив содержит повторные записи.'); ids.add(sample.id); identities.add(identity); }
  return true;
}
function sampleKey(s) { return JSON.stringify([s.type,timestamp(s.startAt),timestamp(s.endAt),s.value,s.unit,s.source]); }
function sampleId(key) {
  let a=2166136261,b=5381; for(let i=0;i<key.length;i++) { a=Math.imul(a^key.charCodeAt(i),16777619); b=Math.imul(b,33)^key.charCodeAt(i); }
  return `h${(a>>>0).toString(36)}_${(b>>>0).toString(36)}`;
}
export function mergeHealthSamples(existing,incoming) {
  if(!Array.isArray(existing)||!Array.isArray(incoming)||existing.length>MAX_SAMPLES||incoming.length>MAX_SAMPLES) fail();
  const merged=[], seen=new Set(), ids=new Set();
  for(const s of [...existing,...incoming]) {
    validateSample(s); const key=sampleKey(s); if(seen.has(key)) continue;
    const copy={...s,id:sampleId(key)};
    if(ids.has(copy.id)) fail('Конфликт записей архива.');
    seen.add(key);ids.add(copy.id);merged.push(copy);
    if(merged.length>MAX_SAMPLES) fail('В архиве может быть не более 50 000 записей.');
  }
  return merged.sort((a,b)=>timestamp(a.startAt)-timestamp(b.startAt)||a.id.localeCompare(b.id));
}
export function preprocessHealthXML(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_XML) fail('XML должен быть не больше 20 МиБ.');
  if(/<!\s*ENTITY\b/i.test(text)) fail('Объявления ENTITY в XML не поддерживаются.');
  const declarations=[...text.matchAll(/<!\s*DOCTYPE\b/gi)];
  if(!declarations.length) return text;
  if(declarations.length!==1) fail('Некорректное объявление DOCTYPE.');
  const offset=declarations[0].index,tail=text.slice(offset);
  const opener=/^<!DOCTYPE\s+HealthData\s*\[/.exec(tail);
  if(!opener)fail('Поддерживается только внутренний DOCTYPE HealthData без внешних ресурсов.');
  const end=tail.indexOf(']>');
  if(end<0||end>65536)fail('Слишком большое или незавершённое объявление DOCTYPE.');
  const body=tail.slice(opener[0].length,end);
  if(/\b(?:SYSTEM|PUBLIC)\b|[%&]/i.test(body))fail('Внешние ресурсы и сущности в XML запрещены.');
  // Apple export DTD consists of schema declarations only. Do not evaluate the DTD:
  // recognize a deliberately narrow grammar and remove it before DOMParser sees it.
  const name='[A-Za-z_][A-Za-z0-9_.:-]*';
  const element=new RegExp(`^<!ELEMENT\\s+${name}\\s+(?:EMPTY|ANY|\\([A-Za-z0-9_.:#,|?*+()\\s-]+\\)[?*+]?)\\s*>`);
  const attlist=new RegExp(`^<!ATTLIST\\s+${name}(?:\\s+${name}\\s+CDATA\\s+#(?:REQUIRED|IMPLIED))+\\s*>`);
  let rest=body.trim(),count=0;
  while(rest) {
    const match=element.exec(rest)||attlist.exec(rest);
    if(!match||++count>500)fail('Неподдерживаемое объявление внутри DOCTYPE.');
    rest=rest.slice(match[0].length).trim();
  }
  if(!count)fail('Пустой DOCTYPE не поддерживается.');
  const result=text.slice(0,offset)+tail.slice(end+2);
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(result))fail('Некорректное объявление XML.');
  return result;
}
export function parseHealthXML(text) {
  const xml=preprocessHealthXML(text);
  if(typeof DOMParser==='undefined') fail('Импорт XML доступен в браузере.');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror')||doc.documentElement?.nodeName!=='HealthData') fail('Ожидается корректный export.xml из Apple Health.');
  const records=doc.getElementsByTagName('Record'), samples=[];
  let skipped=0,unsupported=0;
  // The file size cap bounds XML nodes; no metadata or profile fields are copied.
  for(const record of records) {
    const type=APPLE[record.getAttribute('type')];
    if(!type) { unsupported++;continue; }
    try {
      let value=record.getAttribute('value'), unit=record.getAttribute('unit')||'';
      if(type==='sleep') { value=APPLE_SLEEP[value];unit='category'; }
      else {
        if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)) fail(); value=Number(value);
        if(type==='steps') { if(unit!=='count') fail(); }
        if(type==='heartRate'||type==='restingHeartRate') { if(unit!=='count/min') fail();unit='bpm'; }
        if(type==='activeEnergy') { if(unit==='kJ') value/=4.184;else if(unit!=='kcal') fail();unit='kcal'; }
        if(type==='distance') { if(unit==='km') value*=1000;else if(unit!=='m') fail();unit='m'; }
        if(type==='oxygen') { if(unit!=='%'||value>1) fail();value*=100; }
      }
      const sample={id:'parsed',type,startAt:new Date(timestamp(record.getAttribute('startDate'))).toISOString(),endAt:new Date(timestamp(record.getAttribute('endDate'))).toISOString(),value,unit,source:record.getAttribute('sourceName')};
      validateSample(sample);sample.id=sampleId(sampleKey(sample));samples.push(sample);
      if(samples.length>MAX_SAMPLES) fail('Слишком много записей: максимум 50 000.');
    } catch(error) { if(samples.length>MAX_SAMPLES) throw error;skipped++; }
  }
  const unique=mergeHealthSamples([],samples);
  return {samples:unique,skipped,unsupported,duplicates:samples.length-unique.length};
}
function unionMilliseconds(ranges) {
  if(!ranges.length) return 0;
  const sorted=ranges.slice().sort((a,b)=>a[0]-b[0]); let total=0,[start,end]=sorted[0];
  for(const [a,b] of sorted.slice(1)) { if(a<=end) end=Math.max(end,b);else { total+=end-start;start=a;end=b; } }
  return total+end-start;
}
function sampleStats(samples) {
  if(!samples.length) return {count:0,mean:null,min:null,max:null};
  let total=0,min=Infinity,max=-Infinity;for(const s of samples) {total+=s.value;min=Math.min(min,s.value);max=Math.max(max,s.value);}
  return {count:samples.length,mean:total/samples.length,min,max};
}
export function summarizeHealth(samples,date,source) {
  if(!Array.isArray(samples)||samples.length>MAX_SAMPLES) fail();
  const [dayStart,dayEnd]=dayBounds(date);
  string(source,200);
  const selected=mergeHealthSamples([],samples).filter(s=>s.source===source).map(s=>({...s,start:timestamp(s.startAt),end:timestamp(s.endAt)}));
  const touches=s=>s.start===s.end?s.start>=dayStart&&s.start<dayEnd:s.start<dayEnd&&s.end>dayStart;
  const today=selected.filter(touches), result={date,source,count:today.length};
  for(const type of ['steps','distance','activeEnergy']) {
    const rows=today.filter(s=>s.type===type).sort((a,b)=>a.start-b.start||a.end-b.end);
    let overlap=false, boundary=false, latest=-Infinity,instant=null;
    for(const r of rows) {
      if(r.start<dayStart||r.end>dayEnd) boundary=true;
      if(r.start<latest||instant===r.start) overlap=true;
      latest=Math.max(latest,r.end);instant=r.start===r.end?r.start:null;
    }
    result[type]={count:rows.length,total:rows.length&&!overlap&&!boundary?rows.reduce((sum,s)=>sum+s.value,0):null,ambiguous:overlap||boundary,overlap,boundary};
  }
  // Spot measurements belong to their starting instant; no duration weighting is invented.
  for(const type of ['heartRate','restingHeartRate','oxygen']) result[type]=sampleStats(selected.filter(s=>s.type===type&&s.start>=dayStart&&s.start<dayEnd));
  const sleep=today.filter(s=>s.type==='sleep'), ranges=rows=>rows.map(s=>[Math.max(dayStart,s.start),Math.min(dayEnd,s.end)]);
  const asleep=sleep.filter(s=>['asleep','core','deep','rem'].includes(s.value));
  result.sleep={count:sleep.length,minutes:asleep.length?unionMilliseconds(ranges(asleep))/60000:null,inBedMinutes:sleep.some(s=>s.value==='inBed')?unionMilliseconds(ranges(sleep.filter(s=>s.value==='inBed')))/60000:null,stages:{}};
  for(const stage of STAGES) {const rows=sleep.filter(s=>s.value===stage);result.sleep.stages[stage]=rows.length?unionMilliseconds(ranges(rows))/60000:null;}
  result.sleep.stageOverlap=unionMilliseconds(ranges(asleep))<['asleep','core','deep','rem'].reduce((sum,stage)=>sum+unionMilliseconds(ranges(asleep.filter(s=>s.value===stage))),0);
  return result;
}
let selectedDate=localDate(),selectedSource='';
const empty=()=>({samples:[],lastImportedAt:Date.now()});
const fmt=n=>n===null||n===undefined?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
const sourcesOf=samples=>[...new Set(samples.map(s=>s.source))].sort((a,b)=>a.localeCompare(b,'ru'));
function metric(label,value,unit,note='') {return `<div class="health-metric"><span>${label}</span><strong>${fmt(value)}${value==null?'':` <small>${unit}</small>`}</strong>${note?`<p>${note}</p>`:''}</div>`;}
function totalNote(stat) {return stat.overlap?'Есть пересекающиеся записи: итог не рассчитан.':stat.boundary?'Есть запись на границе суток: итог не рассчитан.':stat.count?`${stat.count} записей`:'Нет записей';}
export function renderDeviceHealth(data) {
  const health=data.deviceHealth||empty(),sources=sourcesOf(health.samples);
  if(!sources.includes(selectedSource)) selectedSource=sources[0]||'';
  const summary=selectedSource?summarizeHealth(health.samples,selectedDate,selectedSource):null;
  return `<section class="health-module"><p class="eyebrow">Показатели устройства</p><h2>Архив здоровья</h2><p class="section-note">Автоматическая синхронизация с Mi Band 6 пока не подключена. Здесь можно просмотреть записи из XML-архива Apple Health, если приложение устройства передало их в «Здоровье».</p><div class="health-toolbar"><button type="button" class="primary" data-health-action="import">Импортировать XML</button>${sources.length?'<button type="button" class="secondary" data-health-action="clear">Очистить архив</button>':''}</div><p class="section-note">Файл обрабатывается на этом устройстве и никуда не отправляется. Импорт не меняет питание и вес.</p><div class="health-filters"><label class="field">День<input id="health-date" type="date" value="${esc(selectedDate)}" min="2000-01-01" max="2100-12-31"></label><label class="field">Один источник<select id="health-source" ${sources.length?'':'disabled'}>${sources.map(s=>`<option value="${esc(s)}" ${s===selectedSource?'selected':''}>${esc(s)}</option>`).join('')||'<option>Нет источников</option>'}</select></label></div>${summary?`<p class="section-note">Показан только источник «${esc(selectedSource)}». Данные разных источников не складываются.</p><div class="health-grid">${metric('Шаги',summary.steps.total,'шагов',totalNote(summary.steps))}${metric('Расстояние',summary.distance.total===null?null:summary.distance.total/1000,'км',totalNote(summary.distance))}${metric('Активная энергия',summary.activeEnergy.total,'ккал',totalNote(summary.activeEnergy))}${metric('Пульс · среднее',summary.heartRate.mean,'уд/мин',summary.heartRate.count?`${summary.heartRate.count} измерений · от ${fmt(summary.heartRate.min)} до ${fmt(summary.heartRate.max)}`:'Нет измерений')}${metric('Пульс в покое · среднее',summary.restingHeartRate.mean,'уд/мин',summary.restingHeartRate.count?`${summary.restingHeartRate.count} измерений · от ${fmt(summary.restingHeartRate.min)} до ${fmt(summary.restingHeartRate.max)}`:'Нет измерений')}${metric('SpO₂ · среднее',summary.oxygen.mean,'%',summary.oxygen.count?`${summary.oxygen.count} измерений · от ${fmt(summary.oxygen.min)} до ${fmt(summary.oxygen.max)}`:'Нет измерений')}${metric('Сон в пределах суток',summary.sleep.minutes===null?null:summary.sleep.minutes/60,'ч','Объединение интервалов сна; время в постели отдельно.')}${metric('В постели',summary.sleep.inBedMinutes===null?null:summary.sleep.inBedMinutes/60,'ч','Не прибавляется ко сну.')}</div><details class="health-details"><summary>Стадии сна и расчёт</summary><p>Сон обрезан по границам выбранного дня в часовом поясе этого устройства. Пересекающиеся интервалы сна объединяются. Средний пульс — обычное среднее имеющихся измерений.</p><dl>${[['core','Базовый'],['deep','Глубокий'],['rem','Быстрый'],['asleep','Сон без стадии'],['awake','Бодрствование']].map(([k,label])=>`<div><dt>${label}</dt><dd>${fmt(summary.sleep.stages[k])} мин</dd></div>`).join('')}</dl>${summary.sleep.stageOverlap?'<p>Стадии пересекаются: их длительности нельзя складывать. Общий сон учитывает каждую минуту один раз.</p>':''}</details><p class="section-note">В архиве ${health.samples.length} записей. Последний импорт: ${esc(new Date(health.lastImportedAt).toLocaleString('ru-RU'))}.</p>`:'<p class="health-empty">Архив пуст. Значения появятся после подтверждённого импорта.</p>'}<details class="health-details"><summary>Формат, ограничения и источники</summary><p>Поддерживается export.xml из Apple Health до 20 МиБ и до 50 000 записей: шаги, пульс, пульс в покое, активная энергия, расстояние ходьбы/бега, SpO₂ и сон. ZIP сначала распакуй и выбери export.xml. Архивы Zepp Life, CSV, маршруты, тренировки, вес, питание и личные сведения не импортируются. Неподдерживаемые типы, единицы и некорректные записи пропускаются с отчётом.</p><p>Исходные числа могут различаться с итогами «Здоровья», где применяются собственные приоритеты источников. Пересечения шагов, расстояния и энергии не суммируются; записи на границе суток не делятся приблизительно.</p><p><a href="https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios" target="_blank" rel="noopener noreferrer">Apple: экспорт данных здоровья</a> · <a href="https://developer.apple.com/documentation/healthkit/data-types" target="_blank" rel="noopener noreferrer">Apple HealthKit: типы данных</a></p></details></section>`;
}
export function installDeviceHealth(ctx) {
  let pending=null,busy=false,disposed=false;
  const close=()=>{pending=null;ctx.closeModal();};
  const heading=title=>`<div class="sheet-heading"><h2>${title}</h2></div>`;
  async function save(fn) {
    if(busy||disposed)return false;busy=true;
    try {const ok=await ctx.mutate(data=>{fn(data);validateDeviceHealth(data.deviceHealth);});if(ok){close();ctx.render();}return ok;}
    catch(error){ctx.toast(error.message||'Не удалось сохранить архив.',true);return false;}
    finally {busy=false;}
  }
  async function click(event) {
    const button=event.target.closest?.('[data-health-action]');if(!button)return;event.preventDefault();
    const action=button.dataset.healthAction;
    if(action==='close')close();
    if(action==='import') {pending=null;ctx.showModal(`${heading('Импорт архива')}<p class="section-note">Выбери export.xml из Apple Health. Если у тебя ZIP, сначала распакуй его. До подтверждения записи не сохраняются. Обработка полностью локальная.</p><label class="field">Файл XML · до 20 МиБ<input id="health-file" type="file" accept=".xml,application/xml,text/xml"></label><p id="health-import-status" role="status"></p>`);}
    if(action==='clear') {pending=null;ctx.showModal(`${heading('Очистить архив?')}<p>Будут удалены все импортированные показатели здоровья. Исходный XML останется у тебя.</p><button type="button" class="danger full" data-health-action="confirm-clear">Удалить весь архив</button>`);}
    if(action==='confirm-clear')await save(data=>{delete data.deviceHealth;});
    if(action==='confirm-import'&&pending) {const incoming=pending;await save(data=>{data.deviceHealth={samples:mergeHealthSamples(data.deviceHealth?.samples||[],incoming),lastImportedAt:Date.now()};});}
  }
  async function change(event) {
    if(event.target.id==='health-date'){try{dayBounds(event.target.value);selectedDate=event.target.value;ctx.render();}catch(error){ctx.toast(error.message,true);}return;}
    if(event.target.id==='health-source'){selectedSource=event.target.value;ctx.render();return;}
    if(event.target.id!=='health-file')return;
    const input=event.target,file=input.files?.[0],status=document.getElementById('health-import-status');pending=null;
    if(!file)return;
    try {
      if(!/\.xml$/i.test(file.name)) fail('Нужен файл .xml. ZIP сначала распакуй и выбери export.xml.');
      if(file.size>MAX_XML)fail('Файл должен быть не больше 20 МиБ.');
      if(status)status.textContent='Читаем XML на этом устройстве…';
      const parsed=parseHealthXML(await file.text());if(disposed||!input.isConnected)return;
      const existing=ctx.getData().deviceHealth?.samples||[],merged=mergeHealthSamples(existing,parsed.samples),added=merged.length-existing.length;
      pending=parsed.samples;
      ctx.showModal(`${heading('Проверь импорт')}<p>Поддерживаемых уникальных записей: <strong>${parsed.samples.length}</strong>. Новых: <strong>${added}</strong>. Уже в архиве: ${parsed.samples.length-added}. Повторов внутри файла: ${parsed.duplicates}.</p><p>Пропущено некорректных записей: ${parsed.skipped}. Неподдерживаемых типов: ${parsed.unsupported}.</p><p>Источники: ${sourcesOf(parsed.samples).map(esc).join(', ')||'нет'}.</p><p class="section-note">Сохраняются только показатели, время и название источника. Личные сведения из XML не сохраняются. Файл не отправляется в сеть.</p>${parsed.samples.length?'<button type="button" class="primary full" data-health-action="confirm-import">Подтвердить импорт</button>':'<p>Нет поддерживаемых записей для импорта.</p>'}<button type="button" class="secondary full" data-health-action="close">Отмена</button>`);
    } catch(error) {pending=null;if(status?.isConnected)status.textContent=error.message;else ctx.toast(error.message,true);}
  }
  document.addEventListener('click',click);document.addEventListener('change',change);
  return ()=>{disposed=true;pending=null;document.removeEventListener('click',click);document.removeEventListener('change',change);};
}
