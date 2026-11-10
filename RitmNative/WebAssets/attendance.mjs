import {nativeRequest} from './routes.mjs';
const pad = n => String(n).padStart(2, '0');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { done: 'Посещение', missed: 'Пропуск', rest: 'Отдых', planned: 'По плану', untracked: 'До начала учёта' };
let shownMonth = null;
let selectedDate = null;

export function dateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const probe = new Date(year, month - 1, day, 12);
    return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day ? value : null;
  }
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const localDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const trackingStart = (data, today) => dateKey(data.attendance?.trackingSince) || dateKey(data.settings?.trackingSince) || today;
function scheduledOn(data, key) {
  const workouts = data.program?.workouts || [];
  const overrides = data.attendance?.overrides;
  const ids = own(overrides, key) ? overrides[key] : workouts.filter(w => w.day === localDate(key).getDay()).map(w => w.id);
  const byId = new Map(workouts.map(w => [w.id, w]));
  return [...new Set(ids || [])].map(id => byId.get(id)).filter(Boolean);
}

export function dayStatus(data, value, todayValue = new Date()) {
  const key = dateKey(value), today = dateKey(todayValue);
  if (!key || !today) throw new TypeError('Некорректная дата');
  const actual = (data.sessions || []).filter(s => Array.isArray(s.logs) && s.logs.length > 0 && dateKey(s.startedAt) === key);
  const scheduled = scheduledOn(data, key);
  const manual = data.attendance?.marks?.[key] || null;
  const tracked = key >= trackingStart(data, today);
  let status;
  if (key <= today && (actual.length || manual === 'done')) status = 'done';
  else if (key < today && !tracked) status = 'untracked';
  else if (manual === 'rest') status = 'rest';
  else if (key < today && manual === 'missed') status = 'missed';
  else if (scheduled.length) status = key < today ? 'missed' : 'planned';
  else status = 'rest';
  return { date: key, status, scheduled, actual, manual, tracked, isToday: key === today };
}

export function monthStats(data, monthKey, todayValue = new Date()) {
  const today = dateKey(todayValue);
  if (!/^\d{4}-\d{2}$/.test(monthKey) || !dateKey(`${monthKey}-01`) || !today) throw new TypeError('Некорректный месяц');
  const first = localDate(`${monthKey}-01`);
  const end = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  let attendedDays = 0, scheduledDays = 0;
  for (let day = 1; day <= end; day++) {
    const state = dayStatus(data, `${monthKey}-${pad(day)}`, today);
    if (state.date > today) continue;
    if (state.status === 'done') { attendedDays++; scheduledDays++; }
    else if (state.date < today && state.tracked && state.scheduled.length && state.manual !== 'rest') scheduledDays++;
  }
  const actual = (data.sessions || []).filter(s => Array.isArray(s.logs) && s.logs.length && dateKey(s.startedAt)?.startsWith(`${monthKey}-`) && dateKey(s.startedAt) <= today);
  const durationMs = actual.reduce((total, s) => {
    const start = new Date(s.startedAt).getTime(), finish = new Date(s.finishedAt).getTime();
    return total + (s.finishedAt != null && Number.isFinite(finish) && finish >= start ? finish - start : 0);
  }, 0);
  return { attendedDays, trainingCount: actual.length, recordedMinutes: Math.round(durationMs / 60000), scheduledDays, attendancePercent: scheduledDays ? Math.round(attendedDays * 100 / scheduledDays) : null };
}

function safeTree(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.keys(value).every(k => !badKeys.has(k) && safeTree(value[k], seen));
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function validateAttendance(value) {
  if (value === undefined) return true;
  if (!record(value) || !safeTree(value) || typeof value.trackingSince !== 'string' || dateKey(value.trackingSince) !== value.trackingSince) return false;
  if (!record(value.overrides) || !record(value.marks)) return false;
  return Object.entries(value.overrides).every(([key, ids]) => dateKey(key) === key && Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !badKeys.has(id))) &&
    Object.entries(value.marks).every(([key, mark]) => dateKey(key) === key && ['done', 'missed', 'rest'].includes(mark));
}

function ensureAttendance(data, today) {
  data.attendance ||= { trackingSince: trackingStart(data, today), overrides: {}, marks: {} };
  data.attendance.overrides ||= {};
  data.attendance.marks ||= {};
  return data.attendance;
}
export function setAttendanceMark(data, value, mark, todayValue = new Date()) {
  const key = dateKey(value), today = dateKey(todayValue);
  if (!key || !today || key > today || (mark !== null && !['done', 'missed', 'rest'].includes(mark))) return false;
  const attendance = ensureAttendance(data, today);
  if (mark === null) delete attendance.marks[key];
  else attendance.marks[key] = mark;
  return true;
}
export function transferWorkout(data, workoutId, fromValue, toValue, todayValue = new Date()) {
  const from = dateKey(fromValue), to = dateKey(toValue), today = dateKey(todayValue);
  if (!from || !to || !today || from === to || !scheduledOn(data, from).some(w => w.id === workoutId)) return false;
  const sourceIds = own(data.attendance?.overrides, from) ? data.attendance.overrides[from] : scheduledOn(data, from).map(w => w.id);
  const destinationIds = own(data.attendance?.overrides, to) ? data.attendance.overrides[to] : scheduledOn(data, to).map(w => w.id);
  const source = sourceIds.filter(id => id !== workoutId);
  const destination = [...new Set([...destinationIds, workoutId])];
  const attendance = ensureAttendance(data, today);
  attendance.overrides[from] = source;
  attendance.overrides[to] = destination;
  return true;
}

const icsEscape = value => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function foldLine(line) {
  const encoder = new TextEncoder();
  let folded = '', part = '';
  for (const char of line) {
    if (encoder.encode(part + char).length > 75) { folded += `${part}\r\n`; part = ' '; }
    part += char;
  }
  return folded + part;
}
export function buildReminderICS(startDate = new Date()) {
  const date = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(`${startDate}T00:00:00+03:00`) : new Date(startDate);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Некорректная дата');
  const moscow = new Date(date.getTime() + 3 * 3600000);
  let next = Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate(), 11, 30);
  while (next <= date.getTime() || ![1, 2, 4, 5].includes(new Date(next).getUTCDay())) next += 86400000;
  const eventDay = new Date(next).toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gym Notebook//Workout Reminders//RU', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Moscow', 'BEGIN:STANDARD', 'DTSTART:20141026T020000', 'TZOFFSETFROM:+0400', 'TZOFFSETTO:+0300', 'TZNAME:MSK', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:gym-mon-tue-thu-fri-1430@offline-workout.local', `DTSTAMP:${stamp}`, `DTSTART;TZID=Europe/Moscow:${eventDay}T143000`, 'DURATION:PT1H',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,TH,FR', `SUMMARY:${icsEscape('Тренировка в зале')}`,
    `DESCRIPTION:${icsEscape('Понедельник, вторник, четверг и пятница. Начало в 14:30 по московскому времени; напоминание в 14:00. Настройки уведомлений задаются в Календаре.')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT30M', `DESCRIPTION:${icsEscape('Через 30 минут тренировка в зале')}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

function prettyDate(key, options = { day: 'numeric', month: 'long' }) { return localDate(key).toLocaleDateString('ru-RU', options); }
export function renderAttendance(data) {
  const today = dateKey(new Date());
  shownMonth ||= today.slice(0, 7);
  const stats = monthStats(data, shownMonth, today);
  const first = localDate(`${shownMonth}-01`);
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: offset }, () => '<span class="att-blank" aria-hidden="true"></span>');
  for (let d = 1; d <= count; d++) {
    const key = `${shownMonth}-${pad(d)}`, state = dayStatus(data, key, today);
    const symbol = { done: '✓', missed: '×', rest: '–', planned: '•', untracked: '·' }[state.status];
    const detail = state.scheduled.map(w => w.title).join(', ');
    cells.push(`<button type="button" class="att-day att-${state.status}${state.isToday ? ' att-today' : ''}" data-att-date="${key}" aria-label="${esc(`${prettyDate(key)}: ${labels[state.status]}${state.isToday ? ', сегодня' : ''}${detail ? ', ' + detail : ''}`)}"${state.isToday ? ' aria-current="date"' : ''}><span>${d}</span><span class="att-day-symbol" aria-hidden="true">${symbol}</span></button>`);
  }
  return `<div class="att-content"><section class="att-intro"><span class="att-eyebrow">РИТМ ТРЕНИРОВОК</span><h1>Посещения</h1><p class="section-note">Каждый шаг складывается в результат.</p></section>
    <section class="att-calendar" aria-label="Календарь посещений"><div class="att-month-nav"><button type="button" class="icon-btn att-month-btn" data-att-month="-1" aria-label="Предыдущий месяц">‹</button><h2>${esc(first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }))}</h2><button type="button" class="icon-btn att-month-btn" data-att-month="1" aria-label="Следующий месяц">›</button></div>
      <div class="att-weekdays" aria-hidden="true">${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(w => `<span>${w}</span>`).join('')}</div><div class="att-grid">${cells.join('')}</div>
      <div class="att-legend"><span><i class="att-legend-done">✓</i>Посещение</span><span><i class="att-legend-missed">×</i>Пропуск</span><span><i class="att-legend-planned">•</i>План</span><span><i>–</i>Отдых</span></div>
      <p class="att-calendar-note">Учёт с ${esc(prettyDate(trackingStart(data, today)))}. Нажмите день, чтобы отметить посещение или перенести тренировку.</p></section>
    <section class="att-summary" aria-label="Итоги выбранного месяца"><div class="att-summary-heading"><h2>Этот месяц в цифрах</h2><span>${stats.attendancePercent === null ? 'Пока без оценки' : `${stats.attendancePercent}% посещений`}</span></div><div class="att-stat-grid"><div><strong>${stats.attendedDays}</strong><span>дней в зале</span></div><div><strong>${stats.trainingCount}</strong><span>тренировок с записями</span></div><div><strong>${stats.recordedMinutes}</strong><span>минут записано</span></div></div><p class="section-note att-stat-note">Процент учитывает прошедшие дни по плану и отмеченные посещения. Пустые записи не считаются тренировками. Ручная отметка не добавляет подходы и время.</p></section>
    <section class="att-reminders"><div class="att-reminder-icon" aria-hidden="true">◷</div><div><span class="att-eyebrow">ПУСТЬ КАЛЕНДАРЬ НАПОМНИТ</span><h2>В зал — по расписанию</h2><p>Пн, Вт, Чт, Пт · тренировка в 14:30<br><strong>Напоминание в 14:00 · Москва</strong></p></div><button type="button" class="primary full att-reminder-button" id="att-reminders">Добавить напоминания в Календарь iPhone</button><p class="section-note">Это уведомления Календаря, а не push приложения. Откройте файл и добавьте события в Календарь вручную. После импорта напоминания могут приходить при закрытом приложении, если разрешены уведомления Календаря. Добавляйте расписание один раз, чтобы избежать дублей.</p></section></div>`;
}

function dateModal(data, key) {
  const state = dayStatus(data, key);
  const pastOrToday = key <= dateKey(new Date());
  return `<div class="sheet-heading"><div><span class="att-eyebrow">${esc(labels[state.status])}</span><h2>${esc(prettyDate(key, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2></div><button type="button" class="icon-btn" id="att-close" aria-label="Закрыть">×</button></div>
  <div class="att-date-details"><h3>По плану</h3>${state.scheduled.length ? `<ul>${state.scheduled.map(w => `<li>${esc(w.title)}</li>`).join('')}</ul>` : '<p class="section-note">На этот день тренировок нет.</p>'}<h3>Фактически записано</h3>${state.actual.length ? `<ul>${state.actual.map(s => `<li>${esc(s.title || 'Тренировка')} · ${s.logs.length} записей${s.status === 'partial' ? ' · не завершена' : ''}</li>`).join('')}</ul>` : '<p class="section-note">Записанных подходов нет.</p>'}
  ${state.manual ? `<p class="att-manual-note">Ручная отметка: ${esc(labels[state.manual])}.</p>` : ''}
  ${pastOrToday ? `<div class="att-mark-actions"><button type="button" class="primary" data-att-mark="done">Был в зале</button><button type="button" class="secondary" data-att-mark="rest">День отдыха</button><button type="button" class="secondary full" data-att-mark="reset">Сбросить ручную отметку</button></div><p class="section-note">Отметки не создают подходы. Реальная запись с подходами всегда остаётся посещением.</p>` : '<p class="section-note">Будущее посещение можно отметить, когда наступит этот день.</p>'}
  ${state.scheduled.length ? `<form id="att-transfer"><h3>Перенести тренировку</h3><label class="field">Тренировка<select name="att-workout" required>${state.scheduled.map(w => `<option value="${esc(w.id)}">${esc(w.title)}</option>`).join('')}</select></label><label class="field">На дату<input type="date" name="att-destination" required value="${key}"></label><p class="section-note">Можно выбрать любой день недели. Записанные результаты останутся на исходной дате.</p><button type="submit" class="secondary full">Перенести</button></form>` : ''}</div>`;
}

export function installAttendance(ctx) {
  const click = async event => {
    const target = event.target.closest?.('[data-att-date], [data-att-month], [data-att-mark], #att-close, #att-reminders');
    if (!target) return;
    if (target.dataset.attDate) { selectedDate = target.dataset.attDate; ctx.showModal(dateModal(ctx.getData(), selectedDate)); }
    else if (target.dataset.attMonth) {
      const date = localDate(`${shownMonth || dateKey(new Date()).slice(0, 7)}-01`);
      date.setMonth(date.getMonth() + Number(target.dataset.attMonth));
      shownMonth = dateKey(date).slice(0, 7); ctx.render();
    } else if (target.id === 'att-close') ctx.closeModal();
    else if (target.dataset.attMark) {
      const mark = target.dataset.attMark === 'reset' ? null : target.dataset.attMark;
      let changed = false;
      const ok = await ctx.mutate(data => { changed = setAttendanceMark(data, selectedDate, mark); });
      if (ok && changed) { ctx.closeModal(); ctx.render(); ctx.toast(mark === null ? 'Ручная отметка сброшена' : 'Отметка сохранена'); }
    } else if (target.id === 'att-reminders') {
      try {
        const file = new File([buildReminderICS()], 'gym-reminders.ics', { type: 'text/calendar;charset=utf-8' });
        if(window.webkit?.messageHandlers?.ritm){await nativeRequest('shareFile',{name:file.name,mime:'text/calendar',content:await file.text()});ctx.toast('Откройте файл и добавьте события в Календарь');}
        else if (navigator.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({ files: [file], title: 'Расписание тренировок' });
          ctx.toast('Откройте файл и добавьте события в Календарь');
        } else {
          const url = URL.createObjectURL(file), link = document.createElement('a');
          link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          ctx.toast('Откройте файл .ics и добавьте события в Календарь');
        }
      } catch (error) { if (error?.name !== 'AbortError') ctx.toast('Не удалось открыть файл Календаря. Попробуйте ещё раз.'); }
    }
  };
  const submit = async event => {
    if (event.target.id !== 'att-transfer') return;
    event.preventDefault();
    const form = new FormData(event.target), destination = form.get('att-destination'), workout = form.get('att-workout');
    if (!dateKey(destination) || destination === selectedDate) { ctx.toast('Выберите другую дату'); return; }
    let changed = false;
    const ok = await ctx.mutate(data => { changed = transferWorkout(data, workout, selectedDate, destination); });
    if (ok && changed) { ctx.closeModal(); shownMonth = destination.slice(0, 7); ctx.render(); ctx.toast('Тренировка перенесена. Результаты сохранены на прежней дате.'); }
  };
  document.addEventListener('click', click);
  document.addEventListener('submit', submit);
  return () => { document.removeEventListener('click', click); document.removeEventListener('submit', submit); };
}
