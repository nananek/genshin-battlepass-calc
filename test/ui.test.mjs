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
    // アプリの loadState / リセットで使う。jsdom の window には無い。
    window.structuredClone = (v) => JSON.parse(JSON.stringify(v));
  },
});

const { window } = dom;
const { document } = window;
const $ = (sel) => document.querySelector(sel);
const text = (sel) => ($(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
const visibleStep = () => $('.step:not([hidden])')?.dataset.step;
const setInput = (sel, value) => {
  const el = $(sel);
  if (!el) throw new Error(`input not found: ${sel}`);
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log('ok   ' + label + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.log('FAIL ' + label + (detail ? ' (' + detail + ')' : '')); }
}

console.log('# step UI');
ok('title has season name', document.title.includes('聖霊紀行'), document.title);
ok('starts at step 1', visibleStep() === '1', visibleStep());
ok('prev disabled at step 1', $('[data-nav="prev"]').disabled === true);
ok('step 1 is active', $('[data-step-go="1"]').classList.contains('active'));
ok('step position 1 / 4', text('#stepPos') === '1 / 4', text('#stepPos'));

setInput('#nowOverride', '2026-11-10T19:27');
setInput('#level', '12');
setInput('#exp', '340');
setInput('#weekEarned', '5200');

ok('current level reflected', text('#summaryCards').includes('Lv 12'), text('#summaryCards').slice(0, 80));

$('[data-nav="next"]').click();
ok('next goes to step 2', visibleStep() === '2', visibleStep());
ok('step 2 is active', $('[data-step-go="2"]').classList.contains('active'));
ok('prev enabled at step 2', $('[data-nav="prev"]').disabled === false);
ok('step position 2 / 4', text('#stepPos') === '2 / 4', text('#stepPos'));

$('button[data-w="boss"][data-v="plan"]').click();
ok('weekly plan adds 450', text('#weeklyTotals').includes('予定 450'), text('#weeklyTotals'));
ok('week panel reflects plan', text('#weekBody').includes('1,350') || text('#weekBody').includes('450'),
  text('#weekBody').slice(0, 120));

$('[data-nav="next"]').click();
ok('next goes to step 3', visibleStep() === '3', visibleStep());
ok('step 3 is active', $('[data-step-go="3"]').classList.contains('active'));

$('button[data-s="stygian"][data-v="plan"]').click();
ok('season plan adds 1,500', text('#seasonTotals').includes('予定 1,500'), text('#seasonTotals'));

$('[data-nav="next"]').click();
ok('next goes to step 4', visibleStep() === '4', visibleStep());
ok('step 4 is active', $('[data-step-go="4"]').classList.contains('active'));
ok('next becomes restart at step 4', text('[data-nav="next"]') === '最初へ', text('[data-nav="next"]'));
ok('summary shows current level', text('#summaryCards').includes('Lv 12'));
ok('result shows projected level', /Lv \d+/.test(text('#resultPanel')), text('#resultPanel').slice(0, 80));
ok('timeline has rows', $('#timelineRows').children.length > 0, String($('#timelineRows').children.length));

$('[data-nav="next"]').click();
ok('restart returns to step 1', visibleStep() === '1', visibleStep());
ok('next label returns', text('[data-nav="next"]') === '次へ', text('[data-nav="next"]'));

$('[data-step-go="3"]').click();
ok('stepper jumps to step 3', visibleStep() === '3', visibleStep());
ok('stepper active follows', $('[data-step-go="3"]').classList.contains('active'));
ok('step position 3 / 4', text('#stepPos') === '3 / 4', text('#stepPos'));

$('[data-nav="prev"]').click();
ok('prev returns to step 2', visibleStep() === '2', visibleStep());

window.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
