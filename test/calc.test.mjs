import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/season.json'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');

const marker = '  // ---------- state ----------';
const cut = app.indexOf(marker);
if (cut < 0) throw new Error('src/app.js に状態セクションのマーカーがない');

const prefix = app.slice(0, cut);
const code =
  'globalThis.window = globalThis;\n' +
  'globalThis.window.__BP_DATA__ = ' + JSON.stringify(data) + ';\n' +
  prefix +
  '\nglobalThis.BP = { compute, parseJst, gameDayStart, weekStart, WEEKLY, SEASON, DAILY, DAY, TZ };\n})();\n';
await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const { DAILY, WEEKLY, SEASON, compute, parseJst, gameDayStart, weekStart } = globalThis.BP;

const dailyTotal = DAILY.reduce((s, m) => s + m.exp, 0);
const weeklyTotal = WEEKLY.reduce((s, m) => s + m.exp, 0);
const seasonTotal = SEASON.reduce((s, m) => s + m.exp, 0);
const NOW = '2026-11-10T19:27';

let pass = 0;
let fail = 0;
function eq(label, actual, expected) {
  if (Object.is(actual, expected)) { pass++; console.log('ok   ' + label + ' = ' + actual); }
  else { fail++; console.log('FAIL ' + label + ' actual=' + actual + ' expected=' + expected); }
}
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log('ok   ' + label + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.log('FAIL ' + label + (detail ? ' (' + detail + ')' : '')); }
}
function section(name) { console.log('\n# ' + name); }

const base = {
  target: 50,
  level: 1,
  exp: 0,
  weekEarned: 0,
  todayDone: false,
  ar: 60,
  seasonEnd: data.season.end,
  nowOverride: NOW,
  weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'plan', future: true }])),
  season: Object.fromEntries(SEASON.map(m => [m.id, { status: 'none' }])),
};
const allPlan = Object.fromEntries(SEASON.map(m => [m.id, { status: 'plan' }]));

section('data');
eq('daily total', dailyTotal, 695);
eq('weekly total', weeklyTotal, 6795);
eq('season total', seasonTotal, 16800); // 聖霊紀行のスナップショット。シーズン更新時に見直す。
const allIds = [...DAILY, ...WEEKLY, ...SEASON].map(m => m.id);
ok('unique ids', new Set(allIds).size === allIds.length);
ok('season end after start', parseJst(data.season.end) > parseJst(data.season.start));
ok('all season missions start before end', SEASON.every(m => parseJst(m.from) < parseJst(data.season.end)));

section('date boundaries');
eq('04:59 is previous game day',
  new Date(gameDayStart(parseJst('2026-11-10T04:59')) + 9 * 3600e3).toISOString().slice(0, 10), '2026-11-09');
eq('05:00 starts new game day',
  new Date(gameDayStart(parseJst('2026-11-10T05:00')) + 9 * 3600e3).toISOString().slice(0, 10), '2026-11-10');
eq('week starts Monday 05:00',
  new Date(weekStart(parseJst('2026-11-10T05:00')) + 9 * 3600e3).toISOString().slice(0, 16), '2026-11-09T05:00');

section('daily + weekly');
const d0 = compute(base);
ok('weeks are contiguous 7 days', d0.weeks.every((w, i) => i === 0 || w.ws - d0.weeks[i - 1].ws === 7 * 86400000));
ok('cap respected every week', d0.weeks.every(w => w.applied <= 10000));
ok('full weeks reach the cap', d0.weeks.slice(1).every(w => w.applied === 10000));
eq('current week days', d0.weeks[0].days, 6); // 11/10(火) 19:27、月曜の分はもう終わっている
eq('weekly per week', d0.weeklyFull, 10000);
eq('weekly max at ar60', d0.weeklyFull, 10000);
ok('total increases monotonically', d0.weeks.every((w, i) => i === 0 || w.total >= d0.weeks[i - 1].total));
ok('level within 1..50', d0.weeks.every(w => w.level >= 1 && w.level <= 50));

section('this week');
const capNow = compute({ ...base, weekEarned: 9000 });
eq('room after 9000 earned', capNow.currentWeek.applied, Math.min(1000, capNow.currentWeek.rawDaily + capNow.currentWeek.rawWeekly));
eq('overflow counts the rest', capNow.currentWeek.overflow, Math.max(0, capNow.currentWeek.rawDaily + capNow.currentWeek.rawWeekly - 1000));
const noToday = compute({ ...base, todayDone: true });
eq('today done removes one day', noToday.currentWeek.days, d0.currentWeek.days - 1);
eq('today done removes 695 from the plan', noToday.currentWeek.rawDaily, d0.currentWeek.rawDaily - dailyTotal);

section('season missions');
const plan = compute({ ...base, season: allPlan });
eq('season adds exactly its total', plan.total - d0.total, seasonTotal);
eq('season is outside the week cap', plan.weeks.reduce((s, w) => s + w.applied, 0), d0.weeks.reduce((s, w) => s + w.applied, 0));
eq('no-season equals base', plan.totalNoSeason, plan.total - seasonTotal);
eq('planned season exp', plan.plannedSeasonExp, seasonTotal);

const done = compute({ ...base, season: Object.fromEntries(SEASON.map(m => [m.id, { status: 'done' }])) });
eq('done missions add nothing', done.total, d0.total);
eq('done missions are not planned', done.plannedSeasonExp, 0);

section('expired plans');
const after = compute({ ...base, nowOverride: '2026-11-22T12:00', season: allPlan });
eq('expired mission dropped', after.plannedSeasonExp, seasonTotal - 1500);
eq('expired counted once', after.expired.length, 1);

section('ar');
for (const ar of [20, 28, 32, 60]) {
  const d = compute({ ...base, ar });
  const expected = WEEKLY.filter(m => m.ar <= ar).reduce((s, m) => s + m.exp, 0);
  eq(`ar${ar} weekly max`, d.arMax, expected);
}
eq('ar20 week max', compute({ ...base, ar: 20 }).weeklyFull, dailyTotal * 7 + 4545);
eq('ar28 week max', compute({ ...base, ar: 28 }).weeklyFull, 10000);
ok('ar20 raw weekly below cap', compute({ ...base, ar: 20 }).weeks[1].rawDaily + compute({ ...base, ar: 20 }).weeks[1].rawWeekly < 10000);

section('target and purchase');
const short = compute({ ...base, level: 1, exp: 0, target: 50, nowOverride: '2026-12-10T12:00' });
ok('deficit exists', short.deficit > 0, `deficit=${short.deficit}`);
eq('deficit matches target', short.deficit, 49000 - short.total);
const reachedTarget = compute({ ...base, target: 2, level: 3 });
eq('reached target has no deficit', reachedTarget.deficit, 0);
ok('reached date set', reachedTarget.reached !== null, String(reachedTarget.reached));

section('weekly: this week vs next weeks');
const weeklyNeeded = 10000 - dailyTotal * 7;
eq('this week pool', d0.thisWeekPool, weeklyTotal);
eq('next week pool', d0.nextWeekPool, weeklyTotal);
eq('current week uses this week', d0.weeks[0].rawWeekly, d0.thisWeekPool);
eq('later weeks use next weeks', d0.weeks[1].rawWeekly, d0.nextWeekPool);
eq('needed from weeklies', d0.weeklyNeeded, weeklyNeeded);
eq('room to skip next weeks', d0.nextWeekBudget, weeklyTotal - weeklyNeeded);

const noneBoth = Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'none', future: false }]));
const dropped = compute({ ...base, weekly: noneBoth });
eq('dropping everything removes the weekly exp', dropped.thisWeekPool + dropped.nextWeekPool, 0);
eq('dropping everything caps a full week at dailies', dropped.weeks[1].applied, dailyTotal * 7);
eq('dropping everything goes negative', dropped.nextWeekBudget, -weeklyNeeded);

const oneDone = Object.fromEntries(WEEKLY.map(m => [m.id, {
  thisWeek: m.id === WEEKLY[0].id ? 'done' : 'plan',
  future: true,
}]));
const doneOne = compute({ ...base, weekly: oneDone });
eq('done stays out of this week pool', doneOne.thisWeekPool, weeklyTotal - WEEKLY[0].exp);
eq('done is reported separately', doneOne.doneThisWeek, WEEKLY[0].exp);
eq('done does not change next weeks', doneOne.nextWeekPool, weeklyTotal);

section('weekly: this week room');
const earned = compute({ ...base, weekEarned: 8000 });
eq('this week need after 8000 earned', earned.thisWeekNeed,
  Math.max(0, 2000 - earned.weeks[0].rawDaily));
eq('this week budget follows the room', earned.thisWeekBudget, earned.thisWeekPool - earned.thisWeekNeed);
const noFuture = compute({ ...base, weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'plan', future: false }])) });
eq('future off leaves this week alone', noFuture.weeks[0].rawWeekly, weeklyTotal);
eq('future off lowers later weeks', noFuture.weeks[1].rawWeekly, 0);

section('past season');
const past = compute({ ...base, seasonEnd: '2026-11-09T04:59' });
eq('past season has no weeks', past.weeks.length, 0);
ok('past season finite', Number.isFinite(past.total) && Number.isFinite(past.deficit));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
