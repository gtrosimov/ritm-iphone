import {validateBandData} from './band.mjs';
import {validateDeviceHealth} from './device-health.mjs';
import {validateNutrition} from './nutrition.mjs';
import {validateAttendance} from './attendance.mjs';
import {validateRunning} from './running.mjs';
const clone = value => structuredClone(value);
const numeric = (n,min=0,max=1000000) => typeof n==='number' && Number.isFinite(n) && n>=min && n<=max;
const text = s => typeof s==='string' && s.length>0 && s.length<=500;
const optionalText=(v,max=5000)=>v==null||(typeof v==='string'&&v.length<=max);
export const formatTarget=e=>e.seconds!=null?`${e.seconds} сек`:`${e.repsText||e.reps} повт.${e.repsSuffix?` ${e.repsSuffix}`:''}${e.weight!=null?` · ${e.weight} кг${e.assisted?' помощи':''}`:''}`;
// The update payload is supplied locally; public builds carry no personal program.
export function applyProgramUpdate(data,update,depth=0){
  if(!update||data.settings?.programUpdate===update.id)return false;
  if(depth>8)throw new Error('Слишком длинная цепочка обновлений программы.');
  if(!text(update.id)||!update.exercises||typeof update.exercises!=='object'||Array.isArray(update.exercises))throw new Error('Некорректное обновление программы.');
  const allowed=new Set(['name','reps','weight','seconds','move','muscles','steps','mistakes','assisted','note','uncertain','repsText','repsSuffix','sets']);
  const patches=Object.entries(update.exercises);
  for(const [id,patch]of patches)if(['__proto__','constructor','prototype'].includes(id)||!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!allowed.has(k)))throw new Error('Некорректное обновление упражнения.');
  if(update.previous)applyProgramUpdate(data,update.previous,depth+1);
  for(const [index,exercises]of [data.program?.exercises,data.active?.snapshot?.exercises].entries()){
    if(!exercises)continue;
    for(const [id,patch]of patches)if(Object.hasOwn(exercises,id)){const values=clone(patch);if(index===1)delete values.sets;Object.assign(exercises[id],values);}
  }
  data.settings??={};data.settings.programUpdate=update.id;
  validateBackup({format:1,...data});
  return true;
}
export function setsForExercise(exercise,group){
  const count=exercise?.sets??group.rounds;
  if(!Number.isInteger(count)||count<1||count>20)throw new Error('Количество подходов должно быть целым числом от 1 до 20.');
  return count;
}
function groupOK(g) {
  return g && Array.isArray(g.ids) && g.ids.length>0 && g.ids.length<=10 && g.ids.every(text)
    && Number.isInteger(g.rounds) && g.rounds>0 && g.rounds<=20 && numeric(g.rest,0,3600);
}
export function startSession(workout,now=Date.now(),exercises={}) {
  if(!workout || !text(workout.id) || !Array.isArray(workout.groups) || !workout.groups.length || workout.groups.length>100 || !workout.groups.every(groupOK))throw new Error('Проверьте упражнения и количество подходов в программе.');
  const queue=[];
  workout.groups.forEach((group,groupIndex)=>{
    const counts=Object.fromEntries(group.ids.map(id=>[id,setsForExercise(exercises[id],group)])),rounds=Math.max(...Object.values(counts));
    for(let round=1;round<=rounds;round++){
      const ids=group.ids.filter(id=>round<=counts[id]);
      ids.forEach((exerciseId,pairIndex)=>queue.push({exerciseId,round,rounds:counts[exerciseId],groupIndex,pairSize:ids.length,pairIndex,restAfter:pairIndex===ids.length-1&&round<rounds?group.rest:0}));
    }
  });
  if(queue.length>10000)throw new Error('Слишком много подходов в одной тренировке.');
  return {id:globalThis.crypto?.randomUUID?.()||`${now}-${Math.random().toString(36).slice(2)}`,workoutId:workout.id,title:workout.title||'Тренировка',startedAt:now,queue,index:0,logs:[],restUntil:0,status:'active'};
}
export function completeStep(session,result,now=Date.now()) {
  if(!session || session.mode==='friend' || session.status!=='active' || session.index>=session.queue.length)throw new Error('Тренировка уже завершена или проходит вне плана.');
  if(session.restUntil>now)throw new Error('Сначала закончите или пропустите отдых.');
  const hasTime=result.seconds!==null && result.seconds!==undefined;
  if(hasTime ? !numeric(result.seconds,1,86400) : (!numeric(result.reps,0,10000)||!Number.isInteger(result.reps)))throw new Error('Введите количество повторений или время.');
  if(result.weight!==null && result.weight!==undefined && !numeric(result.weight,0,2000))throw new Error('Вес должен быть от 0 до 2000 кг.');
  if(!optionalText(result.note,1000))throw new Error('Заметка должна быть текстом до 1000 символов.');
  const next=clone(session), step=next.queue[next.index];
  next.logs.push({exerciseId:step.exerciseId,round:step.round,reps:hasTime?null:result.reps,weight:result.weight??null,seconds:hasTime?result.seconds:null,at:now,note:result.note||''});
  next.index++;
  next.restUntil=step.restAfter>0?now+step.restAfter*1000:0;
  if(next.index>=next.queue.length){next.status='done';next.finishedAt=now;next.restUntil=0;}
  return next;
}
export function undoStep(session) {
  const next=clone(session);
  if(!next.logs.length)return next;
  next.logs.pop();next.index=Math.max(0,next.index-1);next.restUntil=0;next.status='active';delete next.finishedAt;
  return next;
}
export function deferCurrentGroup(session,targetGroupIndex){
  validateSession(session,true);
  if(session.mode==='friend'||!Number.isInteger(targetGroupIndex))throw new Error('Выбери другое упражнение из этой тренировки.');
  const next=clone(session),current=next.queue[next.index].groupIndex,remaining=next.queue.slice(next.index);
  const chosen=remaining.filter(q=>q.groupIndex===targetGroupIndex);
  if(targetGroupIndex===current||!chosen.length)throw new Error('Выбери другое упражнение из оставшихся.');
  next.queue=[...next.queue.slice(0,next.index),...chosen,...remaining.filter(q=>q.groupIndex!==targetGroupIndex&&q.groupIndex!==current),...remaining.filter(q=>q.groupIndex===current)];
  validateSession(next,true);return next;
}
export function remainingSeconds(until,now=Date.now()) {return Math.max(0,Math.ceil(((until||0)-now)/1000));}
export function startFriendSession(session,now=Date.now()) {
  validateSession(session,true);
  if(!numeric(now,0,1e15))throw new Error('Не удалось определить время начала тренировки с другом.');
  if(session.mode==='friend'||session.index!==0||session.logs.length||!session.snapshot)throw new Error('Выбрать тренировку с другом можно до первого выполненного подхода.');
  const next={...clone(session),mode:'friend',originalWorkoutId:session.workoutId,title:'Тренировка с другом',startedAt:now,queue:[],index:0,logs:[],restUntil:0,note:''};
  if(next.sensorData){next.sensorData.heartRate=next.sensorData.heartRate.filter(p=>p.at>=now);if(!next.sensorData.heartRate.length)delete next.sensorData;}
  validateSession(next,true);
  return next;
}
export function finishFriendSession(session,note='',now=Date.now()) {
  validateSession(session,true);
  if(session.mode!=='friend'||!optionalText(note,1000)||typeof note!=='string'||!numeric(now,session.startedAt,1e15))throw new Error('Не удалось завершить тренировку с другом. Проверьте время и заметку.');
  const next={...clone(session),note,status:'done',finishedAt:now,restUntil:0};
  validateSession(next);
  return next;
}
function validateSession(s,active=false) {
  if(!s || (s.mode!==undefined&&!['planned','friend'].includes(s.mode)) || !text(s.id) || !text(s.workoutId) || !text(s.title) || !numeric(s.startedAt,0,1e15) || !Array.isArray(s.queue) || s.queue.length>10000 || (s.mode!=='friend'&&!s.queue.length) || !Array.isArray(s.logs) || !Number.isInteger(s.index) || s.index!==s.logs.length || s.index>s.queue.length || !numeric(s.restUntil,0,1e15))throw new Error('В копии повреждена тренировка.');
  const friend=s.mode==='friend';
  if(friend&&(s.originalWorkoutId!==s.workoutId||!text(s.originalWorkoutId)||!s.snapshot||s.snapshot.workout?.id!==s.originalWorkoutId||s.queue.length||s.logs.length||s.index!==0||s.restUntil!==0||typeof s.note!=='string'||!optionalText(s.note,1000)||!['active','done'].includes(s.status)||(s.status==='active'&&s.finishedAt!==undefined)||(s.status==='done'&&!numeric(s.finishedAt,s.startedAt,1e15))))throw new Error('В копии повреждена тренировка с другом.');
  if(!friend&&s.originalWorkoutId!==undefined)throw new Error('В копии неверный режим тренировки.');
  if(!['active','done','partial'].includes(s.status) || (active && (s.status!=='active'||(!friend&&s.index>=s.queue.length))) || (!active && s.status==='active') || (s.status==='done' && s.index!==s.queue.length))throw new Error('В копии неверный статус тренировки.');
  if(s.status!=='active' && !numeric(s.finishedAt,0,1e15))throw new Error('В копии нет даты завершения.');
  for(const q of s.queue)if(!text(q.exerciseId)||!Number.isInteger(q.round)||q.round<1||!Number.isInteger(q.rounds)||q.rounds<q.round||q.rounds>20||!Number.isInteger(q.pairSize)||q.pairSize<1||q.pairSize>10||!Number.isInteger(q.pairIndex)||q.pairIndex<0||q.pairIndex>=q.pairSize||!Number.isInteger(q.groupIndex)||q.groupIndex<0||q.groupIndex>100||!numeric(q.restAfter,0,3600))throw new Error('В копии повреждены подходы.');
  if(s.snapshot!=null){if(!s.snapshot.workout||!s.snapshot.exercises)throw new Error('В копии повреждена программа тренировки.');validateProgram({workouts:[s.snapshot.workout],exercises:s.snapshot.exercises});if(!s.queue.every(q=>Object.hasOwn(s.snapshot.exercises,q.exerciseId)))throw new Error('В копии потеряно упражнение.');}
  validateBandData(s.sensorData);
  s.logs.forEach((l,i)=>{
    if(l.exerciseId!==s.queue[i].exerciseId || l.round!==s.queue[i].round || !numeric(l.at,0,1e15) || !optionalText(l.note,1000) || (l.seconds!=null?!numeric(l.seconds,1,86400):(!numeric(l.reps,0,10000)||!Number.isInteger(l.reps))) || (l.weight!=null&&!numeric(l.weight,0,2000)))throw new Error('В копии поврежден результат подхода.');
  });
}
function validateProgram(program){
  const fail=()=>{throw new Error('Это не резервная копия Ритм или файл повреждён.');};
  const {exercises,workouts}=program;
  if(!exercises||typeof exercises!=='object'||Array.isArray(exercises)||!Array.isArray(workouts)||workouts.length>100||Object.keys(exercises).length>1000)fail();
  for(const [id,e] of Object.entries(exercises)){
    if(!text(id)||!e||e.id!==id||!text(e.name)||['__proto__','constructor','prototype'].includes(id))fail();
    if(e.reps!=null&&(!Number.isInteger(e.reps)||!numeric(e.reps,0,10000)))fail();
    if(e.seconds!=null&&!numeric(e.seconds,1,86400))fail();
    if(e.weight!=null&&!numeric(e.weight,0,2000))fail();
    if(e.sets!=null&&(!Number.isInteger(e.sets)||!numeric(e.sets,1,20)))fail();
    if(e.reps==null&&e.seconds==null)fail();
    for(const key of ['note','uncertain','muscles','move','repsText','repsSuffix'])if(!optionalText(e[key]))fail();
    for(const key of ['steps','mistakes'])if(e[key]!=null&&(!Array.isArray(e[key])||e[key].length>20||!e[key].every(v=>optionalText(v,1000)&&typeof v==='string')))fail();
    if(e.assisted!=null&&typeof e.assisted!=='boolean')fail();
  }
  const ids=new Set();
  for(const w of workouts){
    if(!w||!text(w.id)||ids.has(w.id)||!text(w.title)||!Array.isArray(w.groups)||!w.groups.length||w.groups.length>100||!w.groups.every(groupOK))fail();
    ids.add(w.id);
    for(const key of ['label','short','subtitle'])if(!optionalText(w[key],500))fail();
    if(w.day!=null&&(!Number.isInteger(w.day)||w.day<0||w.day>6))fail();
    for(const g of w.groups)if(!g.ids.every(id=>Object.hasOwn(exercises,id)))fail();
  }
}
export function validateBackup(value) {
  if(!value||value.format!==1||!value.program||!Array.isArray(value.sessions)||value.sessions.length>10000)throw new Error('Это не резервная копия Ритм или файл повреждён.');
  validateProgram(value.program);
  value.sessions.forEach(s=>validateSession(s));
  if(value.active!=null)validateSession(value.active,true);
  if(value.settings!=null&&(typeof value.settings!=='object'||Array.isArray(value.settings)))throw new Error('В копии повреждены настройки.');
  validateDeviceHealth(value.deviceHealth);validateNutrition(value.nutrition);if(!validateAttendance(value.attendance))throw new Error('В копии повреждён календарь.');validateRunning(value.running);
  return clone(value);
}
