(() => {
  'use strict';

  const DAY = 86400000;
  const TZ = 9 * 3600000;
  const RESET_HOUR = 5; // アジアサーバーの04:00リセット = JST 05:00
  const WEEK_CAP = 10000;
  const LEVEL_EXP = 1000;
  const MAX_LEVEL = 50;
  const STORE_KEY = 'genshin-bp-planner-v2';

  const DATA = window.__BP_DATA__;
  const SEASON_META = DATA.season;
  const DAILY = DATA.daily;
  const WEEKLY = DATA.weekly;
  const SEASON = DATA.seasonMissions;

  const CAT_LABEL = { event: 'イベント', hard: '高難度', fixed: '常設' };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const DAILY_EXP = DAILY.reduce((s, m) => s + m.exp, 0);

  // 入力は紀行画面から拾える数字だけ。デイリーは毎日、ウィークリーは選んだものを毎週やる前提。
  const DEFAULT_STATE = {
    target: 50,
    level: 1,
    exp: 0,
    weekEarned: 0,
    todayDone: false,
    ar: 60,
    tier: 'earth',
    pearlPending: false,
    seasonEnd: SEASON_META.end,
    nowOverride: '',
    weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'plan', future: true }])),
    season: Object.fromEntries(SEASON.map(m => [m.id, { status: 'none' }])),
  };

  // ---------- date helpers (JST, 05:00 reset) ----------
  function parseJst(v) {
    if (!v || typeof v !== 'string') return NaN;
    const s = v.length === 16 ? v + ':00' : v;
    return new Date(s + '+09:00').getTime();
  }
  function gameDayStart(ms) {
    const d = new Date(ms + TZ);
    let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RESET_HOUR) - TZ;
    if (ms < start) start -= DAY;
    return start;
  }
  function gameWeekday(ms) {
    const d = new Date(gameDayStart(ms) + TZ);
    return (d.getUTCDay() + 6) % 7; // 0 = 月曜
  }
  function weekStart(ms) {
    return gameDayStart(ms) - gameWeekday(ms) * DAY;
  }
  function fmtDate(ms) {
    const d = new Date(ms + TZ);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }
  function fmtDateW(ms) {
    const d = new Date(ms + TZ);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
  }
  function daysUntil(ms, now) {
    return Math.ceil((ms - now) / DAY);
  }

  // その週にデイリーを回せる日。今日すでに消化済みなら今日は除く。
  function usableDays(ws, nowMs, endMs, todayDone) {
    const out = [];
    const today = gameDayStart(nowMs);
    for (let i = 0; i < 7; i++) {
      const ds = ws + i * DAY;
      const from = Math.max(ds, nowMs);
      const to = Math.min(ds + DAY, endMs);
      if (to - from < 2 * 3600000) continue;
      if (ds === today && todayDone) continue;
      out.push(ds);
    }
    return out;
  }

  function missionsOf(state) {
    return SEASON.map(m => ({
      ...m,
      status: state.season[m.id]?.status || 'none',
      fromMs: parseJst(m.from),
      deadlineMs: parseJst(m.deadline),
    }));
  }

  function simulate(state, pools) {
    const { thisWeekPool, nextWeekPool, arMax, doneThisWeek } = pools;
    let nowMs = state.nowOverride ? parseJst(state.nowOverride) : Date.now();
    if (!Number.isFinite(nowMs)) nowMs = Date.now();
    let endMs = parseJst(state.seasonEnd);
    if (!Number.isFinite(endMs)) endMs = parseJst(DEFAULT_STATE.seasonEnd);

    const targetTotal = (state.target - 1) * LEVEL_EXP;
    const pearlBonus = state.tier === 'shinju' && state.pearlPending ? 10000 : 0;
    let total = (state.level - 1) * LEVEL_EXP + state.exp + pearlBonus;

    const missions = missionsOf(state);
    const planned = [];
    const expired = [];
    const events = new Map();
    for (const m of missions) {
      if (m.status !== 'plan') continue;
      const start = Math.max(m.fromMs, nowMs);
      if (m.deadlineMs < nowMs || start >= m.deadlineMs || start >= endMs) {
        expired.push(m);
        continue;
      }
      planned.push(m);
      const day = gameDayStart(start);
      events.set(day, (events.get(day) || 0) + m.exp);
    }

    const weekStarts = [];
    for (let ws = weekStart(nowMs); ws < endMs; ws += 7 * DAY) weekStarts.push(ws);

    const weeks = [];
    let reached = total >= targetTotal ? nowMs : null;
    let totalOverflow = 0;

    for (const ws of weekStarts) {
      const isCurrent = ws === weekStart(nowMs);
      const days = usableDays(ws, nowMs, endMs, state.todayDone);
      const rawDaily = DAILY_EXP * days.length;
      const rawWeekly = days.length ? (isCurrent ? thisWeekPool : nextWeekPool) : 0;
      const startUsed = isCurrent ? Math.min(WEEK_CAP, Math.max(0, state.weekEarned)) : 0;
      const room = Math.max(0, WEEK_CAP - startUsed);
      const raw = rawDaily + rawWeekly;
      const applied = Math.min(raw, room);
      const overflow = raw - applied;
      totalOverflow += overflow;

      let seasonExp = 0;
      for (const [day, exp] of events) {
        if (day >= ws && day < ws + 7 * DAY) seasonExp += exp;
      }

      // 日単位で積んで到達日を出す
      let weekRoom = room;
      let weeklyLeft = rawWeekly;
      for (let i = 0; i < 7; i++) {
        const ds = ws + i * DAY;
        if (ds >= endMs) break;
        if (days.includes(ds)) {
          let add = DAILY_EXP;
          if (weeklyLeft > 0) { add += weeklyLeft; weeklyLeft = 0; }
          const take = Math.min(add, weekRoom);
          weekRoom -= take;
          total += take;
        }
        const se = events.get(ds) || 0;
        if (se) total += se;
        if (reached === null && total >= targetTotal) reached = ds;
      }

      weeks.push({
        ws,
        isCurrent,
        days: days.length,
        rawDaily,
        rawWeekly,
        applied,
        overflow,
        seasonExp,
        gain: applied + seasonExp,
        total,
        level: Math.min(MAX_LEVEL, Math.floor(total / LEVEL_EXP) + 1),
      });
    }

    const plannedSeasonExp = planned.reduce((s, m) => s + m.exp, 0);
    const projectedLevel = Math.min(MAX_LEVEL, Math.floor(total / LEVEL_EXP) + 1);
    const deficit = Math.max(0, targetTotal - total);
    const startTotal = (state.level - 1) * LEVEL_EXP + state.exp + pearlBonus;
    const needNow = Math.max(0, targetTotal - startTotal);
    const weeksLeft = weeks.length;
    const needPerWeek = weeksLeft ? Math.ceil(needNow / weeksLeft) : needNow;
    const surplus = Math.max(0, total - targetTotal);

    const weeklyFull = Math.min(WEEK_CAP, DAILY_EXP * 7 + nextWeekPool);
    const weeklyNeeded = Math.max(0, WEEK_CAP - DAILY_EXP * 7);
    const weeklyEarned7 = DAILY_EXP * 7;
    const current = weeks[0] || null;
    const weekRoom = current ? Math.max(0, WEEK_CAP - Math.min(WEEK_CAP, Math.max(0, state.weekEarned))) : 0;
    const thisWeekNeed = Math.max(0, weekRoom - (current ? current.rawDaily : 0));

    return {
      nowMs, endMs, targetTotal, pearlBonus, arMax, weeklyNeeded, dailyExp: DAILY_EXP,
      thisWeekPool, nextWeekPool, doneThisWeek, weekRoom, thisWeekNeed,
      thisWeekBudget: thisWeekPool - thisWeekNeed,
      nextWeekBudget: nextWeekPool - weeklyNeeded,
      total, totalNoSeason: total - plannedSeasonExp, projectedLevel,
      weeks, reached, totalOverflow,
      missions, planned, plannedSeasonExp, expired,
      deficit, surplus, startTotal, needNow, needPerWeek, weeksLeft, weeklyEarned7,
      weeklyFull,
      currentWeek: weeks[0] || null,
    };
  }

  // 抜ける量は「上限を埋められるか」ではなく「目標に届くか」で測る。
  function compute(state) {
    const wOf = (id) => state.weekly[id] || {};
    const sumW = (pred) => WEEKLY.reduce((s, m) => s + (m.ar <= state.ar && pred(m) ? m.exp : 0), 0);
    const pools = {
      arMax: sumW(() => true),
      thisWeekPool: sumW(m => wOf(m.id).thisWeek === 'plan'),
      nextWeekPool: sumW(m => wOf(m.id).future === true),
      doneThisWeek: sumW(m => wOf(m.id).thisWeek === 'done'),
    };
    const base = simulate(state, pools);
    const met = base.total >= base.targetTotal;

    // 抜いても目標に届く最大の EXP。上限を埋められるかではなく、目標で測る。
    const maxDrop = (key) => {
      if (simulate(state, { ...pools, [key]: 0 }).total >= base.targetTotal) return Infinity;
      let lo = 0;
      let hi = pools[key];
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (simulate(state, { ...pools, [key]: pools[key] - mid }).total >= base.targetTotal) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const goalBudget = met ? maxDrop('nextWeekPool') : null;
    const goalBudgetThis = met ? maxDrop('thisWeekPool') : 0;
    return { ...base, pools, goalBudget, goalBudgetThis };
  }

  // ---------- state ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      return mergeState(DEFAULT_STATE, JSON.parse(raw));
    } catch (_) {
      return structuredClone(DEFAULT_STATE);
    }
  }
  function mergeState(def, saved) {
    const out = structuredClone(def);
    if (!saved || typeof saved !== 'object') return out;
    for (const k of Object.keys(def)) {
      if (saved[k] === undefined) continue;
      if (k === 'weekly') {
        if (saved.weekly && typeof saved.weekly === 'object') {
          for (const id of Object.keys(def.weekly)) {
            const v = saved.weekly[id];
            if (!v) continue;
            const thisWeek = ['done', 'plan', 'none'].includes(v.thisWeek) ? v.thisWeek : def.weekly[id].thisWeek;
            const future = typeof v.future === 'boolean' ? v.future : def.weekly[id].future;
            out.weekly[id] = { thisWeek, future };
          }
        }
      } else if (k === 'season') {
        if (saved.season && typeof saved.season === 'object') {
          for (const id of Object.keys(def.season)) {
            const st = saved.season[id]?.status;
            if (st === 'done' || st === 'plan' || st === 'none') out.season[id] = { status: st };
          }
        }
      } else {
        out[k] = saved[k];
      }
    }
    return out;
  }

  let state = loadState();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      const el = document.getElementById('saveState');
      if (el) {
        el.textContent = '保存済み';
        clearTimeout(save._t);
        save._t = setTimeout(() => { el.textContent = ''; }, 1200);
      }
    } catch (_) {}
  }

  // ---------- render ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Math.round(v).toLocaleString('ja-JP');

  function render() {
    const d = compute(state);
    renderCountdown(d);
    renderResult(d);
    renderWeekly(d);
    renderSeason(d);
    renderChart(d);
    $('#pearlRow').hidden = state.tier !== 'shinju';
  }

  function renderCountdown(d) {
    const el = $('#countdown');
    if (d.endMs <= d.nowMs) {
      el.innerHTML = '<span class="big">シーズン終了</span>';
      return;
    }
    const leftDays = Math.max(0, (d.endMs - d.nowMs) / DAY);
    const resetIn = Math.max(0, daysUntil(weekStart(d.nowMs) + 7 * DAY, d.nowMs));
    el.innerHTML = `
      <span class="big">残り ${leftDays.toFixed(1)} 日</span>
      <span class="small">週の切り替えまで ${resetIn} 日</span>`;
  }

  function renderResult(d) {
    const ok = d.total >= d.targetTotal;
    const reachedText = !d.reached
      ? 'シーズン内には届かない'
      : d.reached <= d.nowMs ? 'すでに到達している' : `${fmtDateW(d.reached)}に到達`;
    const noSeasonLevel = Math.min(MAX_LEVEL, Math.floor(d.totalNoSeason / LEVEL_EXP) + 1);

    const notes = [];
    if (d.expired.length > 0) {
      notes.push(`<p class="note red">期限切れの任務が${d.expired.length}件ある。見込みには加えていない。</p>`);
    }

    $('#resultPanel').innerHTML = `
      <div class="landing-now">
        <div class="big"><span class="cap">計画着地点</span> Lv ${d.projectedLevel}<small> / ${state.target}</small></div>
        <div class="sub">${reachedText}</div>
      </div>
      <div class="landing-side">
        <div><span>${ok ? '余り' : '不足'}</span><b class="${ok ? 'good' : 'bad'}">${num(ok ? d.surplus : d.deficit)} EXP</b></div>
        <div><span>シーズン任務を除くと</span><b>Lv ${noSeasonLevel}</b></div>
      </div>
      ${notes.length ? `<div class="notes">${notes.join('')}</div>` : ''}`;
  }

  function renderWeekly(d) {
    $('#weeklyRows').innerHTML = WEEKLY.map(m => {
      const st = state.weekly[m.id] || {};
      const tw = st.thisWeek || 'none';
      const locked = m.ar > state.ar;
      const badge = m.ar > 20 ? `<span class="badge ar">AR${m.ar}〜</span>` : '';
      return `<tr class="${locked ? 'off' : ''}">
        <td data-label="任務"><span class="m-name">${esc(m.name)}</span> ${badge}</td>
        <td class="exp" data-label="紀行経験">${num(m.exp)}</td>
        <td data-label="今週">
          <div class="seg">
            <button type="button" data-w="${m.id}" data-v="done" class="${tw === 'done' ? 'on done' : ''}">済</button>
            <button type="button" data-w="${m.id}" data-v="plan" class="${tw === 'plan' ? 'on plan' : ''}">やる</button>
            <button type="button" data-w="${m.id}" data-v="none" class="${tw === 'none' ? 'on none' : ''}">やらない</button>
          </div>
        </td>
        <td data-label="来週以降">
          <label class="chk"><input type="checkbox" data-future="${m.id}" ${st.future ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>毎週</span></label>
        </td>
      </tr>`;
    }).join('');

    const basisThis = `今週の残り: デイリー ${num(d.currentWeek ? d.currentWeek.rawDaily : 0)} ／ ウィークリー ${num(d.thisWeekPool)}`;
    const basisNext = `1週あたり: デイリー ${num(d.weeklyEarned7)} ／ ウィークリー ${num(d.nextWeekPool)}`;

    const skipText = (label, budget) =>
      !Number.isFinite(budget)
        ? `${label}は全部抜いても目標に届く`
        : budget > 0
          ? `${label}は あと <b>${num(budget)}</b> EXP まで抜ける`
          : `${label}は1件も抜けない`;

    const goal = `<p class="goal-line">目標まで ${num(d.needNow)} EXP ／ 残り${d.weeksLeft}週 ／ 1週あたり ${num(d.needPerWeek)} EXP 必要</p>`;

    const thisHtml = goal + `<p class="budget ${Number.isFinite(d.goalBudgetThis) && d.goalBudgetThis === 0 ? 'gold' : 'ok'}">${skipText('今週', d.goalBudgetThis)}<span>${basisThis}</span></p>`;
    let nextHtml = '';
    if (d.weeksLeft <= 1) {
      nextHtml = ''; // 残りが今週だけなら来週以降の話は出さない
    } else if (d.goalBudget === null) {
      nextHtml = `<p class="budget bad">目標まで <b>${num(d.deficit)}</b> EXP 足りない<span>${basisNext}</span></p>`;
    } else {
      nextHtml = `<p class="budget ${Number.isFinite(d.goalBudget) && d.goalBudget === 0 ? 'gold' : 'ok'}">${skipText('来週以降', d.goalBudget)}<span>${basisNext}</span></p>`;
    }

    $('#weeklyBudget').innerHTML = thisHtml + nextHtml;
  }

  function renderSeason(d) {
    const missions = [...d.missions].sort((a, b) => (a.deadlineMs - b.deadlineMs) || (a.exp - b.exp));
    $('#seasonRows').innerHTML = missions.map(m => {
      const expired = m.deadlineMs < d.nowMs;
      const days = daysUntil(m.deadlineMs, d.nowMs);
      const soon = !expired && days <= 7;
      const deadline = expired
        ? '<span class="badge expired">期限切れ</span>'
        : soon
          ? `<span class="badge soon">あと${days}日</span>`
          : `<span class="muted">${fmtDate(m.deadlineMs)}</span>`;
      return `<tr>
        <td data-label="任務">
          <div class="m-name">${esc(m.name)} <span class="badge ${m.cat}">${CAT_LABEL[m.cat] || m.cat}</span></div>
        </td>
        <td class="exp" data-label="紀行経験">${num(m.exp)}</td>
        <td data-label="期限">${deadline}</td>
        <td data-label="状態">
          <div class="seg">
            <button type="button" data-s="${m.id}" data-v="done" class="${m.status === 'done' ? 'on done' : ''}">済</button>
            <button type="button" data-s="${m.id}" data-v="plan" class="${m.status === 'plan' ? 'on plan' : ''}">やる</button>
            <button type="button" data-s="${m.id}" data-v="none" class="${m.status === 'none' ? 'on none' : ''}">やらない</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    const done = missions.filter(m => m.status === 'done');
    $('#seasonTotals').textContent = `やる${d.planned.length}件 ${num(d.plannedSeasonExp)} EXP／済${done.length}件`;
  }

  function renderChart(d) {
    const W = 640, H = 220;
    const L = 58, R = 24, T = 30, B = 30;
    const rawMax = Math.max((MAX_LEVEL - 1) * LEVEL_EXP, d.total, d.targetTotal);
    const maxExp = Math.ceil(rawMax / 10000) * 10000;
    const startTotal = (state.level - 1) * LEVEL_EXP + state.exp + d.pearlBonus;
    const pts = [{ at: null, total: startTotal, level: Math.min(MAX_LEVEL, Math.floor(startTotal / LEVEL_EXP) + 1) }]
      .concat(d.weeks.map(w => ({ at: w.ws + 6 * DAY, total: w.total, level: w.level })));

    const n = pts.length;
    const X = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const Y = (v) => T + (1 - Math.min(Math.max(v, 0), maxExp) / maxExp) * (H - T - B);

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.total).toFixed(1)}`).join(' ');
    const area = `${line} L${X(n - 1).toFixed(1)},${H - B} L${X(0).toFixed(1)},${H - B} Z`;

    const grid = [0, maxExp / 2, maxExp].map(v =>
      `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"></line>
       <text class="tick" x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${num(v)}</text>`).join('');

    const step = n > 7 ? 2 : 1;
    const ticks = pts.map((p, i) => {
      if (i % step !== 0 && i !== n - 1) return '';
      const label = p.at === null ? 'いま' : fmtDate(p.at);
      return `<text class="tick" x="${X(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${label}</text>`;
    }).join('');

    const dots = pts.map((p, i) =>
      `<circle class="dot${p.at === null ? ' start' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(p.total).toFixed(1)}" r="${i === n - 1 ? 5 : 4}"></circle>
       <text class="lv" x="${X(i).toFixed(1)}" y="${(Y(p.total) - 10).toFixed(1)}" text-anchor="middle">${p.level}</text>`).join('');

    const targetY = Y(d.targetTotal);
    const target = `
      <line class="target" x1="${L}" x2="${W - R}" y1="${targetY.toFixed(1)}" y2="${targetY.toFixed(1)}"></line>
      <text class="target-label" x="${W - R}" y="${(targetY - 6).toFixed(1)}" text-anchor="end">目標 Lv${state.target}</text>`;

    $('#chart').innerHTML = `${grid}<path class="area" d="${area}"></path><path class="plot" d="${line}"></path>${target}${dots}${ticks}`;
    $('#chart').setAttribute('aria-label',
      `累計EXPの推移。いま ${num(startTotal)}、シーズン終了時 ${num(d.total)}、目標 ${num(d.targetTotal)}`);
    $('#chartHint').textContent = `全${d.weeks.length}週`;
  }

  function bindInputs() {
    for (const key of ['target', 'level', 'exp', 'weekEarned', 'ar', 'tier', 'seasonEnd', 'nowOverride']) {
      const el = document.querySelectorAll(`[data-bind="${key}"]`);
      el.forEach(n => { n.value = state[key]; });
    }
    for (const key of ['todayDone', 'pearlPending']) {
      document.querySelectorAll(`[data-bind="${key}"]`).forEach(n => { n.checked = !!state[key]; });
    }
  }

  const CLAMP = {
    level: [1, 50], target: [1, 50], exp: [0, 999],
    weekEarned: [0, 10000], ar: [20, 60],
  };

  document.addEventListener('input', (e) => {
    const t = e.target;
    const key = t.dataset.bind;
    if (!key) return;
    if (t.type === 'checkbox') {
      state[key] = t.checked;
    } else if (t.type === 'number') {
      let v = t.value === '' ? 0 : Number(t.value);
      if (!Number.isFinite(v)) v = 0;
      v = Math.round(v);
      const range = CLAMP[key];
      if (range) v = Math.max(range[0], Math.min(range[1], v));
      state[key] = v;
    } else {
      if (key === 'seasonEnd' && !t.value) return;
      if ((key === 'seasonEnd' || key === 'nowOverride') && t.value && !Number.isFinite(parseJst(t.value))) return;
      state[key] = t.value;
    }
    save();
    render();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.tagName === 'SELECT' && t.dataset.bind === 'tier') {
      state.tier = t.value;
      save();
      render();
    }
  });

  document.addEventListener('input', (e) => {
    const id = e.target.dataset?.future;
    if (!id) return;
    state.weekly[id] = { ...(state.weekly[id] || {}), future: e.target.checked };
    save();
    render();
  });

  document.addEventListener('click', (e) => {
    const w = e.target.closest('button[data-w]');
    if (w) {
      const id = w.dataset.w;
      state.weekly[id] = { ...(state.weekly[id] || {}), thisWeek: w.dataset.v };
      save();
      render();
      return;
    }
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    const id = b.dataset.s;
    state.season[id] = { status: b.dataset.v };
    save();
    render();
  });

  bindInputs();
  render();
})();
