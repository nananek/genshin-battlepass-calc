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
const visibleCopy = () => ['main', '.landing', '.modal'].map(sel => text(sel)).join(' ');
const seg = (id, v) => document.querySelector(`button[data-s="${id}"][data-v="${v}"]`);
const wseg = (id, v) => document.querySelector(`button[data-w="${id}"][data-v="${v}"]`);
const futureBox = (id) => document.querySelector(`input[data-future="${id}"]`);
const budget = () => all('#weeklyBudget .budget').map(p => p.textContent.replace(/\s+/g, ' ').trim());
// 問診票の質問順（1問ずつ聞く）
const QKEYS = ['events', 'abyss', 'theater', 'stygian', 'artifacts', 'pull', 'tcg', 'farm', 'cook', 'forge', 'friendpot', 'furniture'];
const answerKeys = () => [...QKEYS];
const gotoQ = (key) => {
  const i = QKEYS.indexOf(key);
  const dots = all('.quiz-dot');
  if (!dots[i]) throw new Error(`quiz is not open: ${key}`);
  dots[i].click();
};
const answer = (key, yes) => {
  gotoQ(key);
  document.querySelector(`button[data-a="${key}"][data-v="${yes ? 'yes' : 'no'}"]`).click();
};
const answerAll = (yes) => { for (const k of answerKeys()) answer(k, yes); };
const quizOn = (key) => {
  gotoQ(key);
  return document.querySelector(`button[data-a="${key}"][data-v="yes"]`).classList.contains('on');
};
const seasonRows = () => all('#seasonRows tr');
const rowId = (tr) => tr.querySelector('button[data-s]').dataset.s;

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
ok('no plan dropdown', $('#tier') === null);
ok('no purchase option at all', !['main', '.landing', '.modal'].map(sel => text(sel)).join(' ').includes('真珠の歌'));
ok('no step navigation', all('[data-nav]').length === 0);
ok('no per-field description text', all('.desc').length === 0);
ok('no slider duplicate', all('input[type="range"]').length === 0);
ok('no level purchase', !['main', '.landing', '.modal'].map(sel => text(sel)).join(' ').includes('Lv購入'));

console.log('\n# layout');
ok('landing bar sits outside main', $('#resultPanel').closest('main') === null && $('#resultPanel').closest('.landing') !== null);
ok('landing bar is labelled 計画着地点', text('#resultPanel').includes('計画着地点'), text('#resultPanel').slice(0, 30));
ok('the CTA comes before the mission tables', (() => {
  const cta = $('#quizOpen').closest('section');
  const season = $('#seasonRows').closest('section');
  return cta.compareDocumentPosition(season) & window.Node.DOCUMENT_POSITION_FOLLOWING;
})(), panelOrder().join(' / '));
ok('the CTA is worded as an action', text('#quizOpen').includes('質問に答えて消化計画を立てる'), text('#quizOpen'));
ok('season comes before weekly', (() => {
  const o = panelOrder();
  return o.indexOf('シーズン任務') >= 0 && o.indexOf('シーズン任務') < o.indexOf('ウィークリー');
})(), panelOrder().join(' / '));

console.log('\n# quiz');
ok('quiz is closed at first', $('#quizModal').hidden === true);
ok('no 問診票 wording in the UI', !visibleCopy().includes('問診票'), visibleCopy().includes('問診票') ? 'found' : 'none');
$('#quizOpen').click();
ok('button opens the questionnaire', $('#quizModal').hidden === false);
ok('one question at a time', all('button[data-a]').length === 2, String(all('button[data-a]').length));
ok('question has an illustration', all('#quizBody svg.quiz-art').length === 1);
ok('step shows 1 / 12', text('#quizStep') === '1 / 12', text('#quizStep'));
ok('first question is the event one', text('#quizBody').includes('イベント任務'), text('#quizBody').slice(0, 40));
ok('twelve progress dots', all('.quiz-dot').length === 12, String(all('.quiz-dot').length));
ok('prev is disabled on the first question', document.querySelector('[data-quiz-prev]').disabled === true);

document.querySelector('button[data-a="events"][data-v="yes"]').click();
ok('answering advances to the next question', text('#quizStep') === '2 / 12' && text('#quizBody').includes('深境螺旋'), `${text('#quizStep')} ${text('#quizBody').slice(0, 20)}`);
document.querySelector('[data-quiz-prev]').click();
ok('prev returns to the previous question', text('#quizStep') === '1 / 12', text('#quizStep'));
all('.quiz-dot')[4].click();
ok('dots jump to a question', text('#quizStep') === '5 / 12' && text('#quizBody').includes('聖遺物'), text('#quizStep'));
ok('count is shown on the button', /はい \d+ \/ 12/.test(text('#quizCount')), text('#quizCount'));
ok('events default to yes', quizOn('events'));
ok('artifacts default to yes', quizOn('artifacts'));
ok('cooking defaults to yes', quizOn('cook'));
ok('hard content defaults to no', !quizOn('abyss') && !quizOn('theater') && !quizOn('stygian'));
ok('七聖召喚 defaults to no', !quizOn('tcg'));
gotoQ('pull');
ok('モラの質問は行動で書く', text('#quizBody').includes('今週だけモラをたくさん使う'), text('#quizBody').slice(0, 30));

answer('furniture', false);
ok('answering the last question shows the summary', text('#quizStep') === 'おわり' && text('#quizBody').includes('おつかれ'), text('#quizBody').slice(0, 30));
ok('summary lists the result', text('#quizBody').includes('シーズン任務') && /Lv \d+/.test(text('#quizBody')), text('#quizBody').slice(0, 60));
document.querySelector('.modal-foot [data-quiz-close]').click();
ok('closing hides the questionnaire', $('#quizModal').hidden === true);
$('#quizOpen').click();
ok('reopening starts at the first question', text('#quizStep') === '1 / 12', text('#quizStep'));

console.log('\n# quiz fills the tables');
setInput('#nowOverride', '2026-12-10T12:00');
ok('events and artifacts are planned from the start', text('#seasonTotals').includes('やる7件 9,300'), text('#seasonTotals'));
ok('only the easy weeklies are in', budget()[0].includes('ウィークリー 1,710'), budget()[0]);

answer('pull', true);
ok('ガチャを回すとモラが今週に入る', budget()[0].includes('ウィークリー 2,160'), budget()[0]);
answer('tcg', true);
ok('七聖召喚はいで+675', budget()[0].includes('ウィークリー 2,835'), budget()[0]);
answer('farm', true);
ok('周回はいで秘境・ボス・地脈が入る', budget()[0].includes('ウィークリー 5,535'), budget()[0]);
answer('cook', false);
ok('料理いいえで-360', budget()[0].includes('ウィークリー 5,175'), budget()[0]);

answer('artifacts', false);
ok('聖遺物いいえでイベントだけ残る', text('#seasonTotals').includes('やる4件 5,700'), text('#seasonTotals'));
answer('events', false);
ok('イベントいいえで全部外れる', text('#seasonTotals').includes('やる0件'), text('#seasonTotals'));
answer('abyss', true);
ok('螺旋はいで1件入る', text('#seasonTotals').includes('やる1件 2,250'), text('#seasonTotals'));
answer('abyss', false);
ok('螺旋いいえで戻る', text('#seasonTotals').includes('やる0件'), text('#seasonTotals'));

console.log('\n# season table');
const rows = seasonRows();
ok('every season mission listed', rows.length === 11, String(rows.length));
ok('events come first', rows[0].textContent.includes('全域防衛'), rows[0].textContent.slice(0, 30));
ok('mora-free order matches the data file', (() => {
  const cats = rows.map(tr => tr.querySelector('.badge')?.textContent.trim());
  return cats.join(',') === 'イベント,イベント,イベント,イベント,常設,常設,常設,常設,高難度,高難度,高難度';
})(), rows.map(tr => tr.querySelector('.badge')?.textContent.trim()).join(','));
ok('幽境 is above 螺旋 and シアター', (() => {
  const i = (kw) => rows.findIndex(tr => tr.textContent.includes(kw));
  return i('幽境') > 0 && i('幽境') < i('深境螺旋') && i('深境螺旋') < i('幻想シアター');
})(), rows.map(tr => tr.querySelector('.m-name')?.textContent.trim().slice(0, 8)).join(' / '));

const liveRow = rows[rows.length - 1];
const liveId = rowId(liveRow);
const lvBase = heroLevel();
seg(liveId, 'plan').click();
ok('やる adds it to the plan', text('#seasonTotals').includes('やる1件'), text('#seasonTotals'));
ok('やる raises the projection', heroLevel() > lvBase, `${lvBase} -> ${heroLevel()}`);
seg(liveId, 'done').click();
ok('済 is reported separately', text('#seasonTotals').includes('済1件'), text('#seasonTotals'));
ok('済 is not added again', heroLevel() === lvBase, String(heroLevel()));
seg(liveId, 'none').click();

console.log('\n# expired plans');
const expiredRow = rows.find(tr => tr.textContent.includes('期限切れ'));
ok('expired row is flagged', !!expiredRow, expiredRow ? expiredRow.textContent.slice(0, 30) : 'none');
const expiredId = rowId(expiredRow);
seg(expiredId, 'plan').click();
ok('expired plan is not counted', text('#seasonTotals').includes('やる0件'), text('#seasonTotals'));
ok('expired plan is reported', text('#resultPanel').includes('期限切れ'), text('#resultPanel').slice(-60));
seg(expiredId, 'none').click();

console.log('\n# weekly table');
setInput('#nowOverride', '2026-11-10T19:27');
$('#quizOpen').click();
answerAll(true);
ok('two budget lines', budget().length === 2, JSON.stringify(budget()));
ok('all twelve weeklies listed', all('#weeklyRows tr').length === 12, String(all('#weeklyRows tr').length));
ok('both columns exist', all('#weeklyRows tr')[0].querySelector('.seg') !== null && all('#weeklyRows tr')[0].querySelector('input[data-future]') !== null);
ok('今週 has every weekly', budget()[0].includes('ウィークリー 6,795'), budget()[0]);
ok('来週以降 drops the first-week-only mora', budget()[1].includes('ウィークリー 6,345'), budget()[1]);
ok('goal met shows the room to skip', budget()[1].includes('まで抜ける') && !budget()[1].includes('足りない'), budget()[1]);

const cheap = all('#weeklyRows tr').find(tr => tr.querySelector('td.exp').textContent.trim() === '450');
const cheapId = cheap.querySelector('button[data-w]').dataset.w;
futureBox(cheapId).checked = false;
fire(futureBox(cheapId), 'input');
ok('来週以降を外すと1週のウィークリーが減る', budget()[1].includes('ウィークリー 5,895'), budget()[1]);
ok('今週の列は来週以降に影響されない', budget()[0].includes('ウィークリー 6,795'), budget()[0]);
wseg(cheapId, 'none').click();
ok('今週やらないと今週のウィークリーが減る', budget()[0].includes('ウィークリー 6,345'), budget()[0]);
wseg(cheapId, 'plan').click();

const lvFull = heroLevel();
const futureIds = all('input[data-future]').map(el => el.dataset.future);
for (const id of futureIds) { const el = futureBox(id); el.checked = false; fire(el, 'input'); }
ok('全部外すと足りないに変わる', budget()[1].includes('足りない'), budget()[1]);
ok('着地点も下がる', heroLevel() < lvFull, `${lvFull} -> ${heroLevel()}`);
ok('no cap-based note in the bar', !text('#resultPanel').includes('週上限'), text('#resultPanel').slice(-60));
ok('bar reports the shortage instead', /不足[\s\d,]+EXP/.test(text('#resultPanel')), text('#resultPanel').slice(-50));
for (const id of futureIds) { const el = futureBox(id); el.checked = true; fire(el, 'input'); }
ok('戻すと抜ける表示に戻る', budget()[1].includes('まで抜ける'), budget()[1]);

console.log('\n# chart');
ok('chart is an svg', $('#chart') && $('#chart').tagName.toLowerCase() === 'svg');
ok('chart has a target line', all('#chart .target').length === 1);
const weeks = Number(/全(\d+)週/.exec(text('#chartHint'))?.[1]);
ok('chart plots now plus every week', all('#chart circle').length === weeks + 1, `${all('#chart circle').length} dots / ${weeks} weeks`);
ok('chart is described for screen readers', ($('#chart').getAttribute('aria-label') || '').includes('目標'), $('#chart').getAttribute('aria-label'));

console.log('\n# inputs');
setInput('#level', '12');
setInput('#exp', '340');
setInput('#weekEarned', '5200');
const lv12 = heroLevel();
ok('hero shows the target', text('#resultPanel').includes('/ 50'));
ok('landing bar shows the surplus', /[\d,]+ EXP/.test(landingValue('余り')) || /[\d,]+ EXP/.test(landingValue('不足')), text('#resultPanel').slice(0, 80));
setInput('#level', '20');
ok('higher level raises the projection', heroLevel() >= lv12, `${lv12} -> ${heroLevel()}`);
setInput('#level', '12');
setInput('#target', '30');
ok('target change rewrites the hero', text('#resultPanel').includes('/ 30'), text('#resultPanel').slice(0, 40));
setInput('#target', '50');

console.log('\n# today');
const dailyBefore = /デイリー ([\d,]+)/.exec(budget()[0])?.[1];
toggle('[data-bind="todayDone"]', true);
const dailyAfter = /デイリー ([\d,]+)/.exec(budget()[0])?.[1];
ok('today done removes a day from the week', dailyBefore !== dailyAfter && Number(dailyAfter.replace(/,/g, '')) < Number(dailyBefore.replace(/,/g, '')), `${dailyBefore} -> ${dailyAfter}`);
toggle('[data-bind="todayDone"]', false);
ok('unchecking restores it', /デイリー ([\d,]+)/.exec(budget()[0])?.[1] === dailyBefore, budget()[0]);

console.log('\n# ai hand-off');
ok('destinations are hidden before asking', $('#aiTargets').hidden === true);
$('#aiAsk').click();
const prompt = text('#aiPromptPreview');
ok('prompt shows the current numbers', prompt.includes('紀行Lv') && prompt.includes('今週の獲得経験値'), prompt.slice(0, 40));
ok('prompt lists the missions', prompt.includes('七聖召喚') && prompt.includes('深境螺旋'), 'missions');
ok('prompt states the rules', prompt.includes('週10,000') && prompt.includes('シーズン任務は週上限の対象外'), 'rules');
ok('prompt asks for a weekly plan', prompt.includes('週ごとの目安'), 'ask');
ok('three destinations appear', $('#aiTargets').hidden === false && all('.ai-target').length === 3, String(all('.ai-target').length));
ok('chatgpt link carries the prompt', ($('#aiChatgpt').getAttribute('href') || '').startsWith('https://chatgpt.com/?q='));
ok('claude link carries the prompt', ($('#aiClaude').getAttribute('href') || '').startsWith('https://claude.ai/new?q='));
ok('gemini link also carries the prompt', ($('#aiGemini').getAttribute('href') || '').startsWith('https://gemini.google.com/app?q='), ($('#aiGemini').getAttribute('href') || '').slice(0, 40));
ok('prompt is kept for copying', $('#aiPrompt').value.length > 200, String($('#aiPrompt').value.length));

console.log('\n# persistence');
ok('state saved to localStorage', !!window.localStorage.getItem('genshin-bp-planner-v4'));

window.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
