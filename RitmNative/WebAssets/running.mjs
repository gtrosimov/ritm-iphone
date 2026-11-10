import {renderRecorder,routeRecordButton,validateTrackedFields,validateActiveRoute,nativeRequest} from './routes.mjs';
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const DAY = 86400000;
const MAX_DATE = Date.UTC(2201, 0, 1);
let selectedWeek = null;

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function pacePerKm(distanceMetres, seconds) {
  requireValue(finite(distanceMetres, Number.MIN_VALUE, 100000) && finite(seconds, Number.MIN_VALUE, 86400), 'Укажите положительные дистанцию и время.');
  const pace = seconds * 1000 / distanceMetres;
  requireValue(Number.isFinite(pace), 'Не удалось рассчитать темп для этих значений.');
  return pace;
}

export function validateRunning(value) {
  if (value === undefined) return true;
  requireValue(isObject(value), 'Некорректные данные бега.');
  requireValue(validDate(value.startDate), 'Некорректная дата начала плана.');
  requireValue(value.baselineSeconds === null || finite(value.baselineSeconds, 1, 86400), 'Некорректное исходное время.');
  requireValue(typeof value.agreedLoad === 'boolean', 'Некорректная отметка согласования нагрузки.');
  validateActiveRoute(value.activeRoute);if(value.deletedNativeIds!==undefined){requireValue(Array.isArray(value.deletedNativeIds)&&value.deletedNativeIds.length<=10000&&value.deletedNativeIds.every(x=>typeof x==='string'&&x.startsWith('native-')&&x.length<=110),'Повреждены отметки удалённых пробежек.');}
  requireValue(Array.isArray(value.records) && value.records.length <= 10000, 'Некорректный журнал бега.');
  const ids = new Set();
  for (const record of value.records) {
    requireValue(isObject(record), 'Некорректная запись бега.');validateTrackedFields(record);
    requireValue(typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 100 && !ids.has(record.id), 'Некорректный или повторяющийся идентификатор бега.');
    ids.add(record.id);
    requireValue(validDate(record.date), 'Некорректная дата пробежки.');
    requireValue(finite(record.startedAt, 0, MAX_DATE) && finite(record.finishedAt, 0, MAX_DATE) && record.finishedAt >= record.startedAt, 'Некорректное время записи пробежки.');
    requireValue(finite(record.distanceMetres, 1, 100000) && finite(record.seconds, 1, 86400), 'Некорректные дистанция или длительность пробежки.');
    requireValue(typeof record.note === 'string' && record.note.length <= 2000, 'Заметка должна содержать до 2000 символов.');
  }
  return true;
}

function initialRunning() {
  return { startDate: localDate(), baselineSeconds: null, agreedLoad: false, records: [] };
}

function runningData(data) {
  return data?.running ?? initialRunning();
}

export function addCalendarMonths(dateString, months) {
  requireValue(validDate(dateString) && Number.isInteger(months) && Math.abs(months) <= 1200, 'Некорректная календарная дата.');
  const [year, month, day] = dateString.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function addDays(dateString, days) {
  return new Date(Date.parse(`${dateString}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

const STAGES = [
  { from: 1, to: 4, title: 'Привыкнуть к ритму', detail: 'Два лёгких выхода по 15–20 минут вместе с ходьбой. Начните и закончите ходьбой, чередуйте её с коротким комфортным бегом. Можно говорить полными фразами. Без ускорений и максимальных тестов.' },
  { from: 5, to: 8, title: 'Спокойная база', detail: 'Комфортные лёгкие выходы по 20–25 минут, 2 раза в неделю. Третий — только при полном восстановлении и после согласования общей нагрузки. Ходьба остаётся частью занятия.' },
  { from: 9, to: 12, title: 'Техника и лёгкость', detail: 'После актуального замера и согласования нагрузки: техника и короткие расслабленные ускорения под контролем тренера. Это не спринт. Основная часть остаётся лёгкой.' },
  { from: 13, to: 18, title: 'Контролируемые отрезки', detail: 'С тренером можно подобрать короткие контролируемые интервалы и достаточный отдых. Темп и объём — по текущей готовности, без обязательного темпа цели.' },
  { from: 19, to: 23, title: 'Подготовка к километру', detail: 'Работа с темпом цели возможна только после актуального замера и корректировки плана тренером. Если восстановление ухудшилось — повторите лёгкий этап или снизьте нагрузку.' },
  { from: 24, to: 26, title: 'Свежесть и готовность', detail: 'Снизьте нагрузку по согласованному плану. Контрольный километр — только при готовности и хорошем самочувствии, без обязательства уложиться в дату.' },
];

export function getRunningPlan(data, requestedWeek = null, now = new Date()) {
  const running = runningData(data);
  const today = localDate(now);
  const automaticWeek = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${running.startDate}T00:00:00Z`)) / (7 * DAY)) + 1;
  const week = Math.max(1, Math.min(26, Number.isFinite(requestedWeek) ? Math.trunc(requestedWeek) : automaticWeek));
  return { week, weekStart: addDays(running.startDate, (week - 1) * 7), weekEnd: addDays(running.startDate, week * 7 - 1), goalDate: addCalendarMonths(running.startDate, 6), startDate: running.startDate, stage: STAGES.find(stage => week >= stage.from && week <= stage.to), unlocked: running.baselineSeconds !== null && running.agreedLoad === true };
}

function duration(seconds) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function dateLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function runningAsSessions(data) {
  return (data?.running?.records ?? []).map(record => ({ id: `run-${record.id}`, title: 'Бег', startedAt: record.startedAt, finishedAt: record.finishedAt, status: 'done', logs: [{ distanceMetres: record.distanceMetres, seconds: record.seconds }] }));
}

export function renderRunningHistory(data) {
  const records = [...(data?.running?.records ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt);
  if (!records.length) return '<div class="empty-state run-empty">Пока без записей. После выхода добавьте дистанцию и фактическое время.</div>';
  return `<div class="run-history">${records.map(record => `<article class="run-entry"><div class="run-entry-head"><strong>${esc(dateLabel(record.date))}</strong><button type="button" class="icon-btn run-delete" data-run-action="delete" data-run-id="${esc(record.id)}" aria-label="Удалить запись за ${esc(dateLabel(record.date))}">Удалить</button></div><div class="run-entry-values"><span>${esc(record.distanceMetres)} м</span><span>${duration(record.seconds)}</span><span>${duration(pacePerKm(record.distanceMetres, record.seconds))} / км</span></div>${record.note ? `<p class="run-note">${esc(record.note)}</p>` : ''}${routeRecordButton(record)}</article>`).join('')}</div>`;
}

function renderChart(running) {
  const records = running.records.filter(record => record.distanceMetres === 1000).sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);
  if (!records.length) return '<p class="section-note">График появится после первой записи ровно 1000 м. Время с других дистанций не пересчитывается в результат километра.</p>';
  const min = Math.min(240, ...records.map(record => record.seconds));
  const max = Math.max(240, ...records.map(record => record.seconds));
  const range = Math.max(30, max - min);
  const y = seconds => 22 + (seconds - min) / range * 100;
  const x = index => records.length === 1 ? 155 : 28 + index / (records.length - 1) * 254;
  const points = records.map((record, index) => `${x(index)},${y(record.seconds)}`).join(' ');
  return `<figure class="run-chart"><figcaption>Фактический километр · выше — быстрее</figcaption><svg viewBox="0 0 310 155" role="img" aria-label="Время фактических пробежек на 1000 метров. Цель 4 минуты."><line x1="20" x2="290" y1="${y(240)}" y2="${y(240)}" class="run-goal-line"/><text x="24" y="${Math.max(13, y(240) - 6)}">Цель 4:00</text><polyline points="${points}" class="run-chart-path"/>${records.map((record, index) => `<circle cx="${x(index)}" cy="${y(record.seconds)}" r="4" data-run-point="${esc(record.id)}"><title>${esc(dateLabel(record.date))}: ${duration(record.seconds)}</title></circle>`).join('')}</svg><p class="section-note">${records.length} ${records.length === 1 ? 'замер' : 'замеров'} на 1000 м. Линия соединяет записи, а не прогнозирует результат.</p><details><summary>Результаты графика</summary><ul>${records.map(record => `<li>${esc(dateLabel(record.date))} — ${duration(record.seconds)}</li>`).join('')}</ul></details></figure>`;
}

function renderSlots(plan) {
  const early = plan.week <= 4;
  const easy = early ? '15–20 мин с ходьбой' : 'Лёгкий выход по готовности';
  const slots = [
    ['Пн', '06:00', easy, 'До зала — только лёгкая нагрузка, если общий план согласован.'],
    ['Вт', 'Зал', 'День ног', 'Без дополнительного бега.'],
    ['Ср', '06:00', easy, 'Только если ноги восстановились после вторника. Иначе прогулка или отдых.'],
    ['Чт', 'Зал', 'По плану зала', 'Без дополнительного бега.'],
    ['Пт', 'Зал', 'День ног', 'Без дополнительного бега.'],
    ['Сб', 'Отдых', 'Полный день отдыха', 'Без запланированных тренировок.'],
    ['Вс', '06:00', early ? 'Прогулка по желанию' : 'Прогулка или лёгкий выход', early ? 'Третий бег пока не нужен.' : 'Бег — только позднее, при восстановлении и согласованной нагрузке.'],
  ];
  return `<div class="run-slots">${slots.map(([day, time, title, note]) => `<div class="run-slot"><div><b>${day}</b><small>${time}</small></div><div><strong>${title}</strong><p>${note}</p></div></div>`).join('')}</div>`;
}

export function renderRunning(data) {
  const running = runningData(data);
  const plan = getRunningPlan(data, selectedWeek);
  const actual = running.records.filter(record => record.distanceMetres === 1000);
  const best = actual.length ? Math.min(...actual.map(record => record.seconds)) : null;
  const remaining = running.baselineSeconds === null ? null : running.baselineSeconds - 240;
  return `<div class="run-page">${renderRecorder(data)}
    <section class="run-hero"><p class="run-eyebrow">СПОКОЙНО К СВОЕЙ ЦЕЛИ</p><h1>Километр за 4:00</h1><p>Ориентир на шесть месяцев. Дата и результат зависят от готовности.</p><div class="run-goal-date">До ${esc(dateLabel(plan.goalDate))}</div><button type="button" class="secondary" data-run-action="profile">Настроить начало и исходный результат</button></section>
    <div class="stats-strip run-stats"><div><strong>${running.baselineSeconds === null ? '—' : duration(running.baselineSeconds)}</strong><span>Исходный 1 км</span></div><div><strong>${best === null ? '—' : duration(best)}</strong><span>Лучший 1 км</span></div><div><strong>${running.records.length}</strong><span>Выходов в журнале</span></div></div>
    <p class="section-note run-coordination">Бег нужно согласовать с тренером и врачом с учётом четырёх дней зала. Начальный график — предложение для обсуждения, а не обязательная нагрузка. Восстановление важнее номера недели.</p>
    <section class="run-card"><div class="run-section-head"><h2>План на 26 недель</h2><label class="run-week-label" for="run-week">Неделя<select id="run-week" name="run-week">${Array.from({ length: 26 }, (_, index) => `<option value="${index + 1}"${plan.week === index + 1 ? ' selected' : ''}>${index + 1} / 26</option>`).join('')}</select></label></div><p class="run-date-range">${esc(dateLabel(plan.weekStart))} — ${esc(dateLabel(plan.weekEnd))}</p><p class="run-phase">Этап ${plan.stage.from}–${plan.stage.to} · ${plan.stage.title}</p><p>${plan.week >= 9 && !plan.unlocked ? 'Пока сохраняйте комфортный лёгкий бег с ходьбой. Точный темп после актуального замера и согласования нагрузки.' : plan.stage.detail}</p>${plan.week >= 9 ? `<p class="section-note">${plan.unlocked ? 'Исходное время и ваша отметка согласования сохранены. Дальнейшие отрезки и темп подберите с тренером; приложение их автоматически не назначает.' : 'Для обсуждения следующего этапа сохраните фактическое время 1 км и отметьте согласование общей нагрузки. Специально проводить максимальный тест сейчас не нужно.'}</p>` : ''}<p class="section-note">Переходы условные: повторить неделю или сделать паузу — нормально. Утренний выход не должен сокращать сон.</p>${renderSlots(plan)}</section>
    <section class="run-card"><h2>Ориентир и факты</h2><p>4:00 на 1 км = 15 км/ч · 400 м за 1:36 · 200 м за 0:48.</p><p class="section-note">Это арифметика цели, а не темп для текущих тренировок.</p><p>${remaining === null ? 'Исходное время пока неизвестно. Добавьте существующий актуальный замер, когда он будет.' : remaining > 0 ? `Между исходным результатом и целью — ${duration(remaining)}. Это разница времени, а не прогноз улучшения.` : 'Исходный результат уже соответствует цели или быстрее неё. Дальнейшую цель обсудите с тренером.'}</p>${renderChart(running)}</section>
    <section class="run-card"><div class="run-section-head"><h2>Журнал бега</h2><button type="button" class="primary" data-run-action="add">+ Запись</button></div><p class="section-note">Записывайте реальную дистанцию и время. Темп считается по ним; GPS не требуется.</p>${renderRunningHistory(data)}</section>
    <details class="run-card run-safety"><summary>Восстановление и источники</summary><p>При боли остановитесь. При необычной слабости, головокружении или боли в груди прекратите занятие и обратитесь за помощью. Не компенсируйте пропуски дополнительными тренировками.</p><p>Постепенное чередование ходьбы и бега и дни восстановления: <a href="https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/" target="_blank" rel="noopener noreferrer">NHS Couch to 5K</a>. Баланс общей нагрузки и отдыха у юных спортсменов: <a href="https://www.healthychildren.org/English/health-issues/injuries-emergencies/sports-injuries/Pages/Preventing-Overuse-Injuries.aspx" target="_blank" rel="noopener noreferrer">American Academy of Pediatrics</a>. Это общие принципы, не готовый индивидуальный план.</p></details>
  </div>`;
}

function profileForm(data) {
  const running = runningData(data);
  const minutes = running.baselineSeconds === null ? '' : Math.floor(running.baselineSeconds / 60);
  const seconds = running.baselineSeconds === null ? '' : running.baselineSeconds % 60;
  return `<form id="run-profile"><h2>Начало и исходный километр</h2><label class="field">Дата начала<input name="startDate" type="date" min="2000-01-01" max="2200-12-31" value="${esc(running.startDate)}" required></label><p class="section-note">Только актуальный фактический замер 1000 м. Можно оставить пустым; в первые четыре недели максимальные тесты не нужны.</p><div class="entry-fields"><label class="field">Минуты<input name="minutes" type="number" min="0" max="1440" step="1" inputmode="numeric" value="${esc(minutes)}"></label><label class="field">Секунды<input name="seconds" type="number" min="0" max="59" step="1" inputmode="numeric" value="${esc(seconds)}"></label></div><label class="run-check"><input type="checkbox" name="agreedLoad"${running.agreedLoad ? ' checked' : ''}><span>Нагрузку обсудил(а) с тренером и врачом</span></label><p class="section-note">Это ваша отметка, приложение не проверяет согласование.</p><p class="run-form-error" role="alert"></p><button class="primary full" type="submit">Сохранить</button></form>`;
}

function recordForm() {
  return `<form id="run-record"><h2>Записать пробежку</h2><label class="field">Дата<input name="date" type="date" min="2000-01-01" max="2200-12-31" value="${localDate()}" required></label><label class="field">Дистанция, метры<input name="distance" type="number" min="1" max="100000" step="1" inputmode="numeric" placeholder="Например, 1000" required></label><div class="entry-fields"><label class="field">Минуты<input name="minutes" type="number" min="0" max="1440" step="1" inputmode="numeric" required></label><label class="field">Секунды<input name="seconds" type="number" min="0" max="59" step="1" inputmode="numeric" value="0" required></label></div><label class="field">Заметка<textarea name="note" maxlength="2000" rows="3" placeholder="Самочувствие, ходьба, условия"></textarea></label><p class="section-note">Сохраняется фактическое время. Длительность может включать ходьбу — отметьте это в заметке.</p><p class="run-form-error" role="alert"></p><button class="primary full" type="submit">Добавить в журнал</button></form>`;
}

function readDuration(form, optional = false) {
  const minutesValue = form.elements.minutes.value.trim();
  const secondsValue = form.elements.seconds.value.trim();
  if (optional && !minutesValue && !secondsValue) return null;
  const minutes = Number(minutesValue || 0);
  const seconds = Number(secondsValue || 0);
  requireValue(Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440 && Number.isInteger(seconds) && seconds >= 0 && seconds <= 59, 'Укажите целые минуты и секунды от 0 до 59.');
  const total = minutes * 60 + seconds;
  requireValue(total > 0 && total <= 86400, 'Длительность должна быть больше нуля и не более 24 часов.');
  return total;
}

// The host owns persistence and validation of the full app data. All writes use mutate.
export function installRunning(ctx) {
  const click = async event => {
    const button = event.target.closest?.('[data-run-action]');
    if (!button) return;
    const action = button.dataset.runAction;
    if (action === 'profile') ctx.showModal(profileForm(ctx.getData()));
    if (action === 'add') ctx.showModal(recordForm());
    if (action === 'delete') {
      const record = runningData(ctx.getData()).records.find(item => item.id === button.dataset.runId);
      if (!record) return;
      ctx.showModal(`<div><h2>Удалить запись?</h2><p>${esc(dateLabel(record.date))} · ${esc(record.distanceMetres)} м · ${duration(record.seconds)}</p><p class="section-note">Запись исчезнет из журнала и истории посещений.</p><button type="button" class="primary full" data-run-action="confirm-delete" data-run-id="${esc(record.id)}">Удалить эту запись</button></div>`);
    }
    if (action === 'confirm-delete') {
      button.disabled = true;
      try {
        const removed=runningData(ctx.getData()).records.find(record=>record.id===button.dataset.runId);
        const saved = await ctx.mutate(data => {
          data.running ??= initialRunning();if(removed?.source==='iphone-native'){data.running.deletedNativeIds=[...new Set([...(data.running.deletedNativeIds||[]),removed.id])];}
          data.running.records = data.running.records.filter(record => record.id !== button.dataset.runId);
        });
        if (saved) { ctx.closeModal(); ctx.render(); ctx.toast('Запись удалена');if(removed?.source==='iphone-native'&&window.webkit?.messageHandlers?.ritm)try{await nativeRequest('deleteRun',{id:removed.id.slice(7)});}catch{ctx.toast('Запись скрыта из истории. Очистка хранилища iPhone повторится при следующем подключении.');} }
      } catch (error) { ctx.toast(error.message || 'Не удалось удалить запись'); }
      finally { button.disabled = false; }
    }
  };
  const change = event => {
    if (event.target.id !== 'run-week') return;
    selectedWeek = Math.max(1, Math.min(26, Number(event.target.value)));
    ctx.render();
  };
  const submit = async event => {
    const form = event.target;
    if (form.id !== 'run-profile' && form.id !== 'run-record') return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('.run-form-error');
    errorBox.textContent = '';
    button.disabled = true;
    try {
      let update;
      if (form.id === 'run-profile') {
        const startDate = form.elements.startDate.value;
        requireValue(validDate(startDate), 'Укажите корректную дату начала.');
        const baselineSeconds = readDuration(form, true);
        const agreedLoad = form.elements.agreedLoad.checked;
        update = running => Object.assign(running, { startDate, baselineSeconds, agreedLoad });
      } else {
        const date = form.elements.date.value;
        requireValue(validDate(date), 'Укажите корректную дату пробежки.');
        const distanceMetres = Number(form.elements.distance.value);
        requireValue(Number.isInteger(distanceMetres) && finite(distanceMetres, 1, 100000), 'Дистанция: целое число от 1 до 100000 метров.');
        const seconds = readDuration(form);
        const note = form.elements.note.value.trim();
        requireValue(note.length <= 2000, 'Заметка должна содержать до 2000 символов.');
        // Manual entries have no measured start time; noon on the chosen day is a stable attendance timestamp.
        const startedAt = new Date(`${date}T12:00:00`).getTime();
        const record = { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, date, startedAt, finishedAt: startedAt + seconds * 1000, distanceMetres, seconds, note };
        update = running => running.records.push(record);
      }
      const saved = await ctx.mutate(data => {
        data.running ??= initialRunning();
        update(data.running);
        validateRunning(data.running);
      });
      if (saved) { if (form.id === 'run-profile') selectedWeek = null; ctx.closeModal(); ctx.render(); ctx.toast('Сохранено'); }
      else errorBox.textContent = 'Не удалось сохранить. Попробуйте ещё раз.';
    } catch (error) { errorBox.textContent = error.message || 'Проверьте введённые данные.'; }
    finally { button.disabled = false; }
  };
  document.addEventListener('click', click);
  document.addEventListener('change', change);
  document.addEventListener('submit', submit);
  return () => {
    document.removeEventListener('click', click);
    document.removeEventListener('change', change);
    document.removeEventListener('submit', submit);
  };
}
