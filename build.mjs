import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const data = JSON.parse(read('data/season.json'));
const template = read('src/index.html');
const style = read('src/style.css');
const app = read('src/app.js');

const errors = [];
const need = (cond, msg) => { if (!cond) errors.push(msg); };
const parseJst = (s) => {
  if (typeof s !== 'string' || !s) return NaN;
  const v = s.length === 16 ? s + ':00' : s;
  return new Date(v + '+09:00').getTime();
};

need(data.season && data.season.name, 'season.name が空');
need(data.season && data.season.startLabel, 'season.startLabel が空');
need(data.season && data.season.endLabel, 'season.endLabel が空');
need(Number.isFinite(parseJst(data.season?.start)), 'season.start が不正');
need(Number.isFinite(parseJst(data.season?.end)), 'season.end が不正');
need(parseJst(data.season?.end) > parseJst(data.season?.start), 'season.end が season.start 以前');

for (const key of ['daily', 'weekly', 'seasonMissions']) {
  need(Array.isArray(data[key]) && data[key].length > 0, `${key} が空`);
}

const ids = new Set();
for (const key of ['daily', 'weekly', 'seasonMissions']) {
  for (const m of (data[key] || [])) {
    need(m.id && /^[a-z0-9-]+$/i.test(m.id), `${key}: id が不正 (${m.id})`);
    need(m.name && String(m.name).trim(), `${key}: name が空 (${m.id})`);
    need(Number.isInteger(m.exp) && m.exp > 0, `${key}: exp が不正 (${m.id})`);
    need(!ids.has(m.id), `id が重複 (${m.id})`);
    ids.add(m.id);
  }
}

for (const m of (data.seasonMissions || [])) {
  const from = parseJst(m.from);
  const deadline = parseJst(m.deadline);
  need(Number.isFinite(from), `seasonMissions: from が不正 (${m.id})`);
  need(Number.isFinite(deadline), `seasonMissions: deadline が不正 (${m.id})`);
  need(deadline >= from, `seasonMissions: deadline が from 以前 (${m.id})`);
  need(from < parseJst(data.season?.end), `seasonMissions: from がシーズン終了以降 (${m.id})`);
  need(['event', 'hard', 'fixed'].includes(m.cat), `seasonMissions: cat が不正 (${m.id})`);
}

for (const key of ['daily', 'weekly', 'seasonMissions']) {
  for (const m of (data[key] || [])) {
    if (key === 'weekly') need(Number.isInteger(m.ar) && m.ar >= 20 && m.ar <= 60, `weekly: ar が不正 (${m.id})`);
  }
}

for (const token of ['/*__STYLE__*/', '/*__DATA__*/', '/*__APP__*/', '{{SEASON_ID}}', '{{SEASON_NAME}}', '{{SEASON_START}}', '{{SEASON_END}}', '{{VERIFIED}}', '{{SOURCE_UPDATED}}']) {
  need(template.includes(token), `テンプレートに ${token} がない`);
}
need(!app.includes('</script>'), 'app.js に </script> が含まれる');
need(!style.includes('</style>'), 'style.css に </style> が含まれる');

if (errors.length) {
  console.error('データ/テンプレートの検証に失敗した:');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}

const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');
let out = template
  .replaceAll('/*__STYLE__*/', style)
  .replaceAll('/*__DATA__*/', safeJson)
  .replaceAll('/*__APP__*/', app)
  .replaceAll('{{SEASON_ID}}', String(data.season.id))
  .replaceAll('{{SEASON_NAME}}', data.season.name)
  .replaceAll('{{SEASON_START}}', data.season.startLabel)
  .replaceAll('{{SEASON_END}}', data.season.endLabel)
  .replaceAll('{{VERIFIED}}', data.season.verified)
  .replaceAll('{{SOURCE_UPDATED}}', data.season.sourceUpdated);

if (/\{\{[A-Z_]+\}\}/.test(out) || /\/\*__[A-Z]+__\*\//.test(out)) {
  console.error('未置換のプレースホルダーが残っている');
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), out);

const weeklyTotal = data.weekly.reduce((s, m) => s + m.exp, 0);
const seasonTotal = data.seasonMissions.reduce((s, m) => s + m.exp, 0);
console.log(`built dist/index.html (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB)`);
console.log(`season: ${data.season.name} (${data.season.startLabel} - ${data.season.endLabel})`);
console.log(`daily ${data.daily.length} / weekly ${data.weekly.length} (${weeklyTotal} EXP) / season ${data.seasonMissions.length} (${seasonTotal} EXP)`);
