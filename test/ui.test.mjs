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
const heroLevel = () => {
  const m = /Lv (\d+)/.exec(text('#resultPanel'));
  return m ? Number(m[1]) : null;
};
const kvLine = (label) => {
  const k = all('#resultPanel .kv .k').find(el => el.textContent.trim() === label);
  return k ? k.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : '';
};
const weekDays = () => Number(/（(\d)日）/.exec(all('#timelineRows tr')[0].textContent)?.[1]);

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
  document.body.textContent.includes('このレベルの経験値') &&
  document.body.textContent.includes('今週の獲得経験値'));
ok('no step navigation', all('[data-nav]').length === 0);
ok('no slider duplicate', all('input[type="range"]').length === 0);
ok('no per-field description text', all('.desc').length === 0);

console.log('\n# inputs drive the projection');
setInput('#nowOverride', '2026-12-10T12:00');
setInput('#level', '12');
setInput('#exp', '340');
setInput('#weekEarned', '5200');
const lv12 = heroLevel();
ok('projection above the current level', lv12 > 12, String(lv12));
ok('hero shows the target', text('#resultPanel').includes('/ 50'));
ok('deficit shown as EXP', /[\d,]+ EXP/.test(kvLine('目標まで')), kvLine('目標まで'));

setInput('#level', '20');
ok('higher level raises the projection', heroLevel() > lv12, `${lv12} -> ${heroLevel()}`);
const lv20 = heroLevel();
setInput('#level', '12');
ok('lowering level restores it', heroLevel() === lv12, String(heroLevel()));

console.log('\n# season missions');
const rows = all('#seasonRows tr');
ok('every season mission listed', rows.length === 11, String(rows.length));
ok('expired plan is reported', text('#resultPanel').includes('期限切れ'), text('#resultPanel').slice(-80));
ok('totals match the computed plan', text('#seasonTotals').includes('やる10件'), text('#seasonTotals'));

const lvBase = heroLevel();
const liveRow = rows[rows.length - 1];
const liveId = liveRow.querySelector('button[data-s]').dataset.s;
liveRow.querySelector('button[data-v="none"]').click();
ok('やらない removes it from the plan', text('#seasonTotals').includes('やる9件'), text('#seasonTotals'));
const lvNone = heroLevel();
ok('やらない lowers the projection', lvNone < lvBase, `${lvBase} -> ${lvNone}`);

document.querySelector(`button[data-s="${liveId}"][data-v="done"]`).click();
ok('済 is counted separately', text('#seasonTotals').includes('済1件'), text('#seasonTotals'));
ok('済 keeps it out of the plan like やらない', heroLevel() === lvNone, String(heroLevel()));

document.querySelector(`button[data-s="${liveId}"][data-v="plan"]`).click();
ok('plan restores the projection', heroLevel() === lvBase, `${heroLevel()} vs ${lvBase}`);

console.log('\n# settings');
setInput('#ar', '20');
ok('low AR shows the weekly shortfall', text('#resultPanel').includes('週上限に'), text('#resultPanel').slice(-100));
setInput('#ar', '60');
ok('AR60 has no shortfall note', !text('#resultPanel').includes('週上限に'));

setInput('#target', '30');
ok('target change rewrites the hero', text('#resultPanel').includes('/ 30'), text('#resultPanel').slice(0, 40));
setInput('#target', '50');

const tier = $('#tier');
tier.value = 'shinju';
fire(tier, 'change');
ok('pearl checkbox appears for 真珠の歌', $('#pearlRow').hidden === false);
const beforePearl = heroLevel();
const pearl = document.querySelector('[data-bind="pearlPending"]');
pearl.checked = true;
fire(pearl, 'input');
ok('pearl Lv+10 raises the projection', heroLevel() > beforePearl, `${beforePearl} -> ${heroLevel()}`);
pearl.checked = false;
fire(pearl, 'input');
fire(tier, 'change');
tier.value = 'earth';
fire(tier, 'change');
ok('pearl checkbox hides again', $('#pearlRow').hidden === true);

console.log('\n# timeline');
ok('timeline has rows', all('#timelineRows tr').length > 0, String(all('#timelineRows tr').length));
ok('current week is first', all('#timelineRows tr')[0].classList.contains('now-row'));
const daysBefore = weekDays();
const today = document.querySelector('[data-bind="todayDone"]');
today.checked = true;
fire(today, 'input');
ok('today done removes a day', weekDays() === daysBefore - 1, `${daysBefore} -> ${weekDays()}`);
today.checked = false;
fire(today, 'input');
ok('unchecking restores the day', weekDays() === daysBefore, String(weekDays()));

console.log('\n# persistence');
ok('state saved to localStorage', !!window.localStorage.getItem('genshin-bp-planner-v2'));

window.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
