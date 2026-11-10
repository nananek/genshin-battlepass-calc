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
    weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { skip: false }])),
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

  function compute(state) {
    let nowMs = state.nowOverride ? parseJst(state.nowOverride) : Date.now();
    if (!Number.isFinite(nowMs)) nowMs = Date.now();
    let endMs = parseJst(state.seasonEnd);
    if (!Number.isFinite(endMs)) endMs = parseJst(DEFAULT_STATE.seasonEnd);

    const targetTotal = (state.target - 1) * LEVEL_EXP;
    const pearlBonus = state.tier === 'shinju' && state.pearlPending ? 10000 : 0;
    const arMax = WEEKLY.reduce((s, m) => s + (m.ar <= state.ar ? m.exp : 0), 0);
    const weeklyPool = WEEKLY.reduce(
      (s, m) => s + (m.ar <= state.ar && !state.weekly[m.id]?.skip ? m.exp : 0), 0);
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
      const rawWeekly = days.length ? weeklyPool : 0;
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

    const weeklyFull = Math.min(WEEK_CAP, DAILY_EXP * 7 + weeklyPool);
    const weeklyNeeded = Math.max(0, WEEK_CAP - DAILY_EXP * 7);

    return {
      nowMs, endMs, targetTotal, pearlBonus, arMax, weeklyPool, weeklyNeeded, dailyExp: DAILY_EXP,
      total, totalNoSeason: total - plannedSeasonExp, projectedLevel,
      weeks, reached, totalOverflow,
      missions, planned, plannedSeasonExp, expired,
      deficit,
      weeklyFull, weeklyShort: Math.max(0, WEEK_CAP - (DAILY_EXP * 7 + weeklyPool)),
      skipBudget: weeklyPool - Math.max(0, WEEK_CAP - DAILY_EXP * 7),
      currentWeek: weeks[0] || null,
    };
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
            if (typeof saved.weekly[id]?.skip === 'boolean') out.weekly[id] = { skip: saved.weekly[id].skip };
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
    renderTimeline(d);
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
    if (d.weeklyShort > 0) {
      notes.push(`<p class="note gold">ウィークリーの選択では週 ${num(d.weeklyPool)} EXP まで。デイリー7日分と合わせても週上限には ${num(d.weeklyShort)} EXP 足りない。</p>`);
    }
    if (d.expired.length > 0) {
      notes.push(`<p class="note red">期限切れの任務が${d.expired.length}件ある。見込みには加えていない。</p>`);
    }

    $('#resultPanel').innerHTML = `
      <div class="result-hero">
        <div class="big">Lv ${d.projectedLevel}<small> / ${state.target}</small></div>
        <div class="sub">${reachedText}</div>
      </div>
      <div class="kv">
        <div class="k">目標まで</div>
        <div class="v ${ok ? 'good' : 'bad'}">${ok ? '到達済み' : `${num(d.deficit)} EXP`}</div>
        <div class="k">シーズン任務を除くと</div>
        <div class="v">Lv ${noSeasonLevel}</div>
      </div>
      ${notes.length ? `<div class="notes">${notes.join('')}</div>` : ''}`;
  }

  function renderWeekly(d) {
    $('#weeklyRows').innerHTML = WEEKLY.map(m => {
      const skip = !!state.weekly[m.id]?.skip;
      const locked = m.ar > state.ar;
      const badge = m.ar > 20 ? `<span class="badge ar">AR${m.ar}〜</span>` : '';
      return `<tr class="${skip || locked ? 'off' : ''}">
        <td data-label="任務"><span class="m-name">${esc(m.name)}</span> ${badge}</td>
        <td class="exp" data-label="紀行経験">${num(m.exp)}</td>
        <td data-label="抜く">
          <label class="chk"><input type="checkbox" data-skip="${m.id}" ${skip ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>抜く</span></label>
        </td>
      </tr>`;
    }).join('');

    const ok = d.skipBudget >= 0;
    $('#weeklyBudget').className = 'budget ' + (ok ? 'ok' : 'bad');
    const basis = `<span>必要 ${num(d.weeklyNeeded)} ／ 全部 ${num(d.arMax)}</span>`;
    $('#weeklyBudget').innerHTML = ok
      ? `あと <b>${num(d.skipBudget)}</b> EXP まで抜ける${basis}`
      : `<b>${num(-d.skipBudget)}</b> EXP 足りない${basis}`;
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

  function renderTimeline(d) {
    $('#timelineRows').innerHTML = d.weeks.map(w => {
      const period = `${fmtDate(w.ws)}〜${fmtDate(w.ws + 6 * DAY)}`;
      return `<tr class="${w.isCurrent ? 'now-row' : ''}">
        <td>${period}（${w.days}日）${w.isCurrent ? ' <span class="badge">今週</span>' : ''}</td>
        <td class="num">${num(w.rawDaily)}</td>
        <td class="num">${num(w.rawWeekly)}</td>
        <td class="num">${num(w.seasonExp)}</td>
        <td class="num">${num(w.gain)}${w.overflow > 0 ? `<div class="waste">上限 −${num(w.overflow)}</div>` : ''}</td>
        <td class="num">${num(w.total)}</td>
        <td class="num lv">${w.level}</td>
      </tr>`;
    }).join('');
    $('#timelineHint').textContent = `全${d.weeks.length}週／週${num(d.weeklyFull)} EXP まで`;
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
    const id = e.target.dataset?.skip;
    if (!id) return;
    state.weekly[id] = { skip: e.target.checked };
    save();
    render();
  });

  document.addEventListener('click', (e) => {
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
