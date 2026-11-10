import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsdom from 'jsdom';

const { JSDOM } = jsdom;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'dist/index.html');
if (!fs.existsSync(htmlPath)) {
  console.error('dist/index.html がない。先に npm run build を実行する。');
  process.exit(1);
}

const dom = new JSDOM(fs.readFileSync(htmlPath, 'utf8'), {
  runScripts: 'dangerously',
  url: 'https://example.test/',
  beforeParse(window) {
    // アプリの loadState で使う。jsdom の window には無い。
    window.structuredClone = (v) => JSON.parse(JSON.stringify(v));
  },
});

const { window } = dom;
const { document } = window;
const $ = (sel) => document.querySelector(sel);
const all = (sel) => [...document.querySelectorAll(sel)];
const text = (sel) => ($(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
const fire = (el, type = 'input') => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const setInput = (sel, value) => {
  const el = $(sel);
  if (!el) throw new Error(`input not found: ${sel}`);
  el.value = value;
  fire(el, 'input');
};
const toggle = (sel, checked) => {
  const el = $(sel);
  el.checked = checked;
  fire(el, 'input');
};
const heroLevel = () => {
  const m = /Lv (\d+)/.exec(text('#resultPanel'));
  return m ? Number(m[1]) : null;
};
const landingValue = (label) => {
  const k = all('#resultPanel .landing-side span').find(el => el.textContent.trim() === label);
  return k && k.nextElementSibling ? k.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : '';
};
const panelOrder = () => all('main .panel-head h2').map(el => el.textContent.trim());
const weekDays = () => Number(/（(\d)日）/.exec(all('#timelineRows tr')[0].textContent)?.[1]);
const seg = (id, v) => document.querySelector(`button[data-s="${id}"][data-v="${v}"]`);
const wseg = (id, v) => document.querySelector(`button[data-w="${id}"][data-v="${v}"]`);
const futureBox = (id) => document.querySelector(`input[data-future="${id}"]`);
const budget = () => all('#weeklyBudget .budget').map(p => p.textContent.replace(/\s+/g, ' ').trim());

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log('ok   ' + label + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.log('FAIL ' + label + (detail ? ' (' + detail + ')' : '')); }
}

console.log('# one page');
ok('title has season name', document.title.includes('聖霊紀行'), document.title);
ok('three game inputs exist', !!($('#level') && $('#exp') && $('#weekEarned')));
ok('labels use game wording',
  document.body.textContent.includes('紀行レベル') &&
  document.body.textContent.includes('紀行経験') &&
  document.body.textContent.includes('今週の獲得経験値'));
ok('today done is on the main card', !!document.querySelector('.panel-body [data-bind="todayDone"]'));
ok('no step navigation', all('[data-nav]').length === 0);
ok('no per-field description text', all('.desc').length === 0);
ok('no slider duplicate', all('input[type="range"]').length === 0);
ok('no level purchase', !document.body.textContent.includes('Lv購入'));

console.log('\n# layout');
ok('landing bar sits outside main', $('#resultPanel').closest('main') === null && $('#resultPanel').closest('.landing') !== null);
ok('landing bar is labelled 計画着地点', text('#resultPanel').includes('計画着地点'), text('#resultPanel').slice(0, 30));
ok('season comes before weekly', (() => {
  const o = panelOrder();
  return o.indexOf('シーズン任務') >= 0 && o.indexOf('シーズン任務') < o.indexOf('ウィークリー');
})(), panelOrder().join(' / '));

console.log('\n# inputs drive the projection');
setInput('#nowOverride', '2026-12-10T12:00');
setInput('#level', '12');
setInput('#exp', '340');
setInput('#weekEarned', '5200');
const lv12 = heroLevel();
ok('projection above the current level', lv12 > 12, String(lv12));
ok('hero shows the target', text('#resultPanel').includes('/ 50'));
ok('deficit shown as EXP', /[\d,]+ EXP/.test(landingValue('目標まで')), landingValue('目標まで'));

setInput('#level', '20');
ok('higher level raises the projection', heroLevel() > lv12, `${lv12} -> ${heroLevel()}`);
const lv20 = heroLevel();
setInput('#level', '12');
ok('lowering level restores it', heroLevel() === lv12, String(heroLevel()));

console.log('\n# weekly: this week and next weeks');
const budgetNow = budget();
ok('two budget lines', budgetNow.length === 2, JSON.stringify(budgetNow));
ok('this week line shows the room to skip', budgetNow[0].includes('今週は') && budgetNow[0].includes('まで抜ける'), budgetNow[0]);
ok('next weeks line shows 1,660', budgetNow[1].includes('来週以降は') && budgetNow[1].includes('1,660'), budgetNow[1]);
ok('all twelve weeklies listed', all('#weeklyRows tr').length === 12, String(all('#weeklyRows tr').length));
ok('both columns exist', all('#weeklyRows tr')[0].querySelector('.seg') !== null && all('#weeklyRows tr')[0].querySelector('input[data-future]') !== null);

const cheap = all('#weeklyRows tr').find(tr => tr.querySelector('td.exp').textContent.trim() === '450');
const cheapId = cheap.querySelector('button[data-w]').dataset.w;
const thisBefore = budget()[0];
wseg(cheapId, 'none').click();
ok('今週やらない lowers the this-week room', budget()[0] !== thisBefore && budget()[0].includes('まで抜ける') || budget()[0].includes('足りない'), budget()[0]);
const thisAfter = budget()[0];

futureBox(cheapId).checked = false;
fire(futureBox(cheapId), 'input');
ok('来週以降を外すと来週以降が減る', budget()[1].includes('1,210'), budget()[1]);
ok('今週の表示は変わらない', budget()[0] === thisAfter, budget()[0]);
wseg(cheapId, 'done').click();
ok('済は今週の枠から外れる', budget()[0].includes('まで抜ける') || budget()[0].includes('足りない'), budget()[0]);

// 来週以降が効くのは先の週があるとき（12/10 だと今週しか残っていない）
setInput('#nowOverride', '2026-11-10T19:27');
const lvWithFuture = heroLevel();
const futureIds = all('input[data-future]').map(el => el.dataset.future);
for (const id of futureIds) { const el = futureBox(id); el.checked = false; fire(el, 'input'); }
ok('来週以降を全部外すと足りない', budget()[1].includes('足りない') && budget()[1].includes('5,135'), budget()[1]);
ok('来週以降を全部外すと着地点が下がる', heroLevel() < lvWithFuture, `${lvWithFuture} -> ${heroLevel()}`);
ok('result warns about the shortfall', text('#resultPanel').includes('足りない'), text('#resultPanel').slice(-60));

for (const id of futureIds) { const el = futureBox(id); el.checked = true; fire(el, 'input'); }
ok('戻すと着地点も戻る', heroLevel() === lvWithFuture, String(heroLevel()));
setInput('#nowOverride', '2026-12-10T12:00');
ok('基準日時を戻すと着地点も戻る', heroLevel() === lv12, String(heroLevel()));

console.log('\n# season: nothing planned by default');
const rows = all('#seasonRows tr');
ok('every season mission listed', rows.length === 11, String(rows.length));
ok('nothing is planned up front', text('#seasonTotals').includes('やる0件'), text('#seasonTotals'));

const liveRow = rows[rows.length - 1];
const liveId = liveRow.querySelector('button[data-s]').dataset.s;
seg(liveId, 'plan').click();
ok('やる adds it to the plan', text('#seasonTotals').includes('やる1件'), text('#seasonTotals'));
const lvPlan = heroLevel();
ok('やる raises the projection', lvPlan > lv12, `${lv12} -> ${lvPlan}`);

seg(liveId, 'done').click();
ok('済 is reported separately', text('#seasonTotals').includes('済1件'), text('#seasonTotals'));
ok('済 is not added again', heroLevel() === lv12, String(heroLevel()));

seg(liveId, 'none').click();
ok('やらない clears it', text('#seasonTotals').includes('やる0件'), text('#seasonTotals'));

console.log('\n# expired plans');
const expiredRow = rows[0];
const expiredId = expiredRow.querySelector('button[data-s]').dataset.s;
ok('expired row is flagged', expiredRow.textContent.includes('期限切れ'), expiredRow.textContent.slice(0, 40));
seg(expiredId, 'plan').click();
ok('expired plan is not counted', text('#seasonTotals').includes('やる0件'), text('#seasonTotals'));
ok('expired plan is reported', text('#resultPanel').includes('期限切れ'), text('#resultPanel').slice(-60));
seg(expiredId, 'none').click();

console.log('\n# settings');
setInput('#target', '30');
ok('target change rewrites the hero', text('#resultPanel').includes('/ 30'), text('#resultPanel').slice(0, 40));
setInput('#target', '50');

const tier = $('#tier');
tier.value = 'shinju';
fire(tier, 'change');
ok('pearl checkbox appears for 真珠の歌', $('#pearlRow').hidden === false);
const beforePearl = heroLevel();
toggle('[data-bind="pearlPending"]', true);
ok('pearl Lv+10 raises the projection', heroLevel() > beforePearl, `${beforePearl} -> ${heroLevel()}`);
toggle('[data-bind="pearlPending"]', false);
tier.value = 'earth';
fire(tier, 'change');
ok('pearl checkbox hides again', $('#pearlRow').hidden === true);

console.log('\n# timeline');
ok('timeline has rows', all('#timelineRows tr').length > 0, String(all('#timelineRows tr').length));
ok('current week is first', all('#timelineRows tr')[0].classList.contains('now-row'));
const daysBefore = weekDays();
toggle('[data-bind="todayDone"]', true);
ok('today done removes a day', weekDays() === daysBefore - 1, `${daysBefore} -> ${weekDays()}`);
toggle('[data-bind="todayDone"]', false);
ok('unchecking restores the day', weekDays() === daysBefore, String(weekDays()));

console.log('\n# persistence');
ok('state saved to localStorage', !!window.localStorage.getItem('genshin-bp-planner-v2'));

window.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
