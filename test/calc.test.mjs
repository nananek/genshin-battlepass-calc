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
  '\nglobalThis.BP = { run, compute, parseJst, gameDayStart, weekStart, WEEKLY, SEASON, DAILY, DAY, TZ };\n})();\n';
await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const { DAILY, WEEKLY, SEASON, compute, parseJst, gameDayStart, weekStart } = globalThis.BP;

const dailyTotal = DAILY.reduce((s, m) => s + m.exp, 0);
const weeklyTotal = WEEKLY.reduce((s, m) => s + m.exp, 0);
const seasonTotal = SEASON.reduce((s, m) => s + m.exp, 0);

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

section('data');
eq('daily total', dailyTotal, 695);
eq('weekly total', weeklyTotal, 6795);
eq('season total', seasonTotal, 16800); // 聖霊紀行のスナップショット。シーズン更新時に見直す。
const allIds = [...DAILY, ...WEEKLY, ...SEASON].map(m => m.id);
ok('unique ids', new Set(allIds).size === allIds.length);
ok('season end after start', parseJst(data.season.end) > parseJst(data.season.start));
ok('all season missions start before end', SEASON.every(m => parseJst(m.from) < parseJst(data.season.end)));

const base = {
  target: 50,
  level: 1,
  exp: 0,
  weekEarned: 0,
  todayDone: false,
  playDays: 7,
  ar: 60,
  tier: 'earth',
  pearlPending: false,
  seasonEnd: data.season.end,
  nowOverride: '2026-11-10T19:27',
  daily: Object.fromEntries(DAILY.map(m => [m.id, true])),
  weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'none', future: false }])),
  season: Object.fromEntries(SEASON.map(m => [m.id, { status: 'none' }])),
  custom: [],
};

section('date boundaries');
eq('04:59 is previous game day',
  new Date(gameDayStart(parseJst('2026-11-10T04:59')) + 9 * 3600e3).toISOString().slice(0, 10), '2026-11-09');
eq('05:00 starts new game day',
  new Date(gameDayStart(parseJst('2026-11-10T05:00')) + 9 * 3600e3).toISOString().slice(0, 10), '2026-11-10');
eq('week starts Monday 05:00',
  new Date(weekStart(parseJst('2026-11-10T05:00')) + 9 * 3600e3).toISOString().slice(0, 16), '2026-11-09T05:00');

section('daily only');
const dailyOnly = compute(base);
const totalDays = dailyOnly.weeks.reduce((s, w) => s + w.days, 0);
eq('daily only total', dailyOnly.total, dailyTotal * totalDays);
eq('daily only level', dailyOnly.projectedLevel, Math.min(50, Math.floor(dailyOnly.total / 1000) + 1));
ok('daily only finite', Number.isFinite(dailyOnly.total) && Number.isFinite(dailyOnly.deficit));
ok('daily only cap respected', dailyOnly.weeks.every(w => w.applied <= 10000));

section('weekly cap');
const firstWeekly = WEEKLY[0];
const cap = compute({
  ...base,
  weekEarned: 9000,
  weekly: { ...base.weekly, [firstWeekly.id]: { thisWeek: 'plan', future: false } },
});
const raw = cap.currentWeek.rawDaily + cap.currentWeek.rawWeekly;
eq('remaining cap', 10000 - 9000, 1000);
eq('cap applied', cap.currentWeek.applied, Math.min(1000, raw));
eq('cap overflow', cap.currentWeek.overflow, Math.max(0, raw - 1000));

section('today done');
const noToday = compute({ ...base, todayDone: true });
ok('today done reduces days', noToday.weeks[0].days < dailyOnly.weeks[0].days);
eq('today done applied', noToday.weeks[0].applied, dailyTotal * noToday.weeks[0].days);

section('season missions');
const allSeason = Object.fromEntries(SEASON.map(m => [m.id, { status: 'plan' }]));
const seasonPlan = compute({ ...base, season: allSeason });
eq('planned season total', seasonPlan.plannedSeasonExp, seasonTotal);
eq('season plan total', seasonPlan.total, dailyOnly.total + seasonTotal);
ok('season plan no NaN', Number.isFinite(seasonPlan.total) && seasonPlan.weeks.every(w => Number.isFinite(w.total)));

section('weekly missions');
const allFuture = Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'none', future: true }]));
const allWeekly = compute({ ...base, weekly: allFuture });
const expectedAllWeekly = allWeekly.weeks.reduce(
  (s, w) => s + Math.min(10000, dailyTotal * w.days + (w.isCurrent ? 0 : weeklyTotal)), 0);
eq('all weekly total', allWeekly.total, expectedAllWeekly);
ok('all weekly cap respected', allWeekly.weeks.every(w => w.applied <= 10000));
ok('weekly overflow counted', allWeekly.totalOverflow === allWeekly.weeks.reduce((s, w) => s + w.overflow, 0));

section('everything');
const everything = compute({ ...base, weekly: allFuture, season: allSeason });
eq('everything total', everything.total, allWeekly.total + seasonTotal);
eq('reached consistency', everything.reached !== null, everything.total >= 49000);

section('ar');
for (const ar of [20, 28, 32, 60]) {
  const d = compute({ ...base, ar });
  const expected = WEEKLY.filter(m => m.ar <= ar).reduce((s, m) => s + m.exp, 0);
  eq(`ar${ar} max`, d.arMax, expected);
}

section('custom mission');
const custom = compute({
  ...base,
  custom: [{ id: 'custom-test', name: 'テスト', exp: 1000, status: 'plan' }],
});
eq('custom planned', custom.plannedSeasonExp, 1000);
eq('custom total', custom.total, dailyOnly.total + 1000);

section('pearl');
const pearl = compute({ ...base, tier: 'shinju', pearlPending: true });
eq('pearl total', pearl.total, dailyOnly.total + 10000);
eq('pearl level', pearl.projectedLevel, Math.min(50, Math.floor(pearl.total / 1000) + 1));

section('reverse');
const reverse = compute({ ...base, season: allSeason });
ok('reverse deficit exists', reverse.deficit > 0, `deficit=${reverse.deficit}`);
ok('reverse extra found', reverse.extraNeeded !== null, `extra=${reverse.extraNeeded}`);
if (reverse.extraNeeded !== null) {
  ok('reverse extra within max', reverse.extraNeeded >= 0 && reverse.extraNeeded <= reverse.maxExtra,
    `${reverse.extraNeeded} <= ${reverse.maxExtra}`);
}

section('past season');
const past = compute({ ...base, seasonEnd: '2026-11-09T04:59' });
eq('past season has no weeks', past.weeks.length, 0);
ok('past season finite', Number.isFinite(past.total) && Number.isFinite(past.deficit));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
