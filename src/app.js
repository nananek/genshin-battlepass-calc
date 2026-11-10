(() => {
  'use strict';

  const DAY = 86400000;
  const TZ = 9 * 3600000;
  const RESET_HOUR = 5; // Asiaサーバーの04:00リセット = JST 05:00
  const WEEK_CAP = 10000;
  const LEVEL_EXP = 1000;
  const MAX_LEVEL = 50;
  const STORE_KEY = 'genshin-bp-planner-v1';

  const DATA = window.__BP_DATA__;
  const SEASON_META = DATA.season;
  const DAILY = DATA.daily;
  const WEEKLY = DATA.weekly;
  const SEASON = DATA.seasonMissions;

  const CAT_LABEL = { event: 'イベント', hard: '高難度', fixed: '常設', custom: '追加' };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  const DEFAULT_STATE = {
    target: 50,
    level: 1,
    exp: 0,
    weekEarned: 0,
    todayDone: false,
    playDays: 7,
    ar: 60,
    tier: 'earth',
    pearlPending: false,
    seasonEnd: SEASON_META.end,
    nowOverride: '',
    daily: { login: true, commission: true, ore: true, resin: true },
    weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'none', future: false }])),
    season: Object.fromEntries(SEASON.map(m => [m.id, { status: 'none' }])),
    custom: [],
  };

  // ---------- date helpers (JST, 05:00 reset) ----------
  function parseJst(v) {
    if (!v) return NaN;
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
    return (d.getUTCDay() + 6) % 7; // 0 = Monday
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
  function fmtDeadline(ms) {
    const d = new Date(ms + TZ);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
  }
  function daysUntil(ms, now) {
    return Math.ceil((ms - now) / DAY);
  }

  function usableDays(ws, nowMs, endMs, todayDone) {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const ds = ws + i * DAY;
      const de = ds + DAY;
      const from = Math.max(ds, nowMs);
      const to = Math.min(de, endMs);
      if (to - from < 2 * 3600000) continue;
      if (ds === gameDayStart(nowMs) && todayDone) continue;
      out.push(ds);
    }
    return out;
  }

  function getSeasonMissions(state) {
    const base = SEASON.map(m => ({
      ...m,
      status: state.season[m.id]?.status || 'none',
      fromMs: parseJst(m.from),
      deadlineMs: parseJst(m.deadline),
    }));
    const custom = state.custom.map(m => ({
      ...m,
      cat: 'custom',
      status: m.status || 'none',
      fromMs: parseJst(SEASON_META.start),
      deadlineMs: parseJst(state.seasonEnd),
    }));
    return [...base, ...custom];
  }

  function sumWeekly(state, key, value) {
    return WEEKLY.reduce((s, m) => {
      const v = state.weekly[m.id];
      if (!v) return s;
      if (key === 'future' ? v.future === value : v[key] === value) return s + m.exp;
      return s;
    }, 0);
  }

  function run(state, extraFutureWeekly) {
    let nowMs = state.nowOverride ? parseJst(state.nowOverride) : Date.now();
    if (!Number.isFinite(nowMs)) nowMs = Date.now();
    let endMs = parseJst(state.seasonEnd);
    if (!Number.isFinite(endMs)) endMs = parseJst(DEFAULT_STATE.seasonEnd);
    const dailyExp = DAILY.reduce((s, m) => s + (state.daily[m.id] !== false ? m.exp : 0), 0);
    const targetTotal = (state.target - 1) * LEVEL_EXP;
    const pearlBonus = state.tier === 'shinju' && state.pearlPending ? 10000 : 0;
    let total = (state.level - 1) * LEVEL_EXP + state.exp + pearlBonus;

    const missions = getSeasonMissions(state);
    const events = new Map();
    const expired = [];
    const plannedMissions = [];
    for (const m of missions) {
      if (m.status !== 'plan') continue;
      const start = Math.max(m.fromMs, nowMs);
      if (m.deadlineMs < nowMs || start > m.deadlineMs || start >= endMs) {
        expired.push(m);
        continue;
      }
      plannedMissions.push(m);
      const day = gameDayStart(start);
      events.set(day, (events.get(day) || 0) + m.exp);
    }

    const futureWeekly = sumWeekly(state, 'future', true) + (extraFutureWeekly || 0);
    const plannedThisWeek = sumWeekly(state, 'thisWeek', 'plan');

    const weekStarts = [];
    for (let ws = weekStart(nowMs); ws < endMs; ws += 7 * DAY) weekStarts.push(ws);

    const weeks = [];
    let reached = total >= targetTotal ? nowMs : null;
    let totalOverflow = 0;

    for (const ws of weekStarts) {
      const isCurrent = ws === weekStart(nowMs);
      const allDays = usableDays(ws, nowMs, endMs, state.todayDone);
      const usedDays = allDays.slice(0, Math.max(0, Math.min(7, state.playDays)));
      const rawDaily = dailyExp * usedDays.length;
      const weeklyExp = isCurrent ? plannedThisWeek : futureWeekly;
      const rawWeekly = usedDays.length > 0 && weeklyExp ? weeklyExp : 0;
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

      // day-level pass: adds the week's EXP and records the reach date
      let weekRoom = room;
      let weeklyLeft = rawWeekly;
      for (let i = 0; i < 7; i++) {
        const ds = ws + i * DAY;
        if (ds >= endMs) break;
        const isPlay = usedDays.includes(ds);
        if (isPlay) {
          let add = dailyExp;
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
        days: usedDays.length,
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

    const projectedTotal = Math.min(MAX_LEVEL * LEVEL_EXP - LEVEL_EXP + 999, total);
    const projectedLevel = Math.min(MAX_LEVEL, Math.floor(total / LEVEL_EXP) + 1);
    const projectedExp = projectedLevel >= MAX_LEVEL ? 0 : total % LEVEL_EXP;
    const deficit = Math.max(0, targetTotal - total);
    let buyLevels = deficit > 0 ? Math.ceil(deficit / LEVEL_EXP) : 0;
    buyLevels = Math.min(buyLevels, Math.max(0, MAX_LEVEL - projectedLevel));

    const arMax = WEEKLY.reduce((s, m) => s + (m.ar <= state.ar ? m.exp : 0), 0);
    const allWeekly = WEEKLY.reduce((s, m) => s + m.exp, 0);
    const dailyMax = DAILY.reduce((s, m) => s + m.exp, 0);
    const futureWeeks = weeks.filter(w => !w.isCurrent);
    const saturated = futureWeeks.length > 0 && futureWeeks.every(w => w.rawDaily + w.rawWeekly >= WEEK_CAP);

    return {
      nowMs, endMs, dailyExp, targetTotal, pearlBonus,
      total, projectedTotal, projectedLevel, projectedExp,
      weeks, reached, totalOverflow,
      missions, expired, plannedMissions,
      plannedSeasonExp: plannedMissions.reduce((s, m) => s + m.exp, 0),
      futureWeekly, plannedThisWeek,
      deficit, buyLevels, buyOverage: buyLevels * LEVEL_EXP - deficit, buyCost: buyLevels * 150,
      arMax, allWeekly, dailyMax, saturated,
      futureWeeks,
      currentWeek: weeks[0] || null,
      weekStarts,
    };
  }

  function compute(state) {
    const base = run(state, 0);
    let extraNeeded = null;
    let maxExtraTotal = null;
    if (base.deficit > 0 && base.futureWeeks.length > 0) {
      const maxExtra = Math.max(0, base.arMax - base.futureWeekly);
      const maxRun = run(state, maxExtra);
      maxExtraTotal = maxRun.total;
      if (maxRun.deficit <= 0) {
        let lo = 0, hi = maxExtra;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (run(state, mid).deficit <= 0) hi = mid; else lo = mid + 1;
        }
        extraNeeded = lo;
      }
    }
    return { ...base, extraNeeded, maxExtraTotal, maxExtra: Math.max(0, base.arMax - base.futureWeekly) };
  }

  // ---------- state ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const saved = JSON.parse(raw);
      return mergeState(DEFAULT_STATE, saved);
    } catch (_) {
      return structuredClone(DEFAULT_STATE);
    }
  }
  function mergeState(def, saved) {
    const out = structuredClone(def);
    if (!saved || typeof saved !== 'object') return out;
    for (const k of Object.keys(def)) {
      if (saved[k] === undefined) continue;
      if (k === 'weekly' || k === 'season' || k === 'daily') {
        if (typeof saved[k] === 'object' && saved[k]) {
          for (const id of Object.keys(def[k])) {
            if (saved[k][id] !== undefined) {
              out[k][id] = typeof def[k][id] === 'object'
                ? { ...def[k][id], ...saved[k][id] }
                : saved[k][id];
            }
          }
        }
      } else {
        out[k] = saved[k];
      }
    }
    if (!Array.isArray(out.custom)) out.custom = [];
    out.custom = out.custom.filter(m => m && typeof m.exp === 'number' && typeof m.name === 'string');
    return out;
  }

  let state = loadState();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      const el = document.getElementById('saveState');
      if (el) {
        el.textContent = '保存済み';
        el.style.color = 'var(--green)';
        clearTimeout(save._t);
        save._t = setTimeout(() => { el.textContent = ''; }, 1200);
      }
    } catch (_) {}
  }

  // ---------- render helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function levelLabel(total) {
    const lv = Math.min(MAX_LEVEL, Math.floor(total / LEVEL_EXP) + 1);
    const exp = lv >= MAX_LEVEL ? null : total % LEVEL_EXP;
    return { lv, exp };
  }

  function render() {
    const d = compute(state);
    renderCountdown(d);
    renderSummary(d);
    renderWeekPanel(d);
    renderWeekly(d);
    renderSeason(d);
    renderResult(d);
    renderTimeline(d);
    $('#pearlRow').style.display = state.tier === 'shinju' ? '' : 'none';
    $('#weeklyHint').textContent = `AR${state.ar} の最大 ${d.arMax.toLocaleString()} EXP`;
  }

  function renderCountdown(d) {
    const el = $('#countdown');
    if (d.endMs <= d.nowMs) {
      el.innerHTML = `<span class="big">シーズン終了</span><span class="small">終了日時を過ぎている。設定から変更できる。</span>`;
      return;
    }
    const left = (d.endMs - d.nowMs) / DAY;
    const days = d.weeks.reduce((s, w) => s + w.days, 0);
    el.innerHTML = `
      <span class="big">残り ${(Math.round(left * 10) / 10).toFixed(1)} 日</span>
      <span class="small">デイリーを消化できる日数 ${days} 日 ／ 今週のリセットまで ${daysUntil(weekStart(d.nowMs) + 7 * DAY, d.nowMs)} 日</span>
      <span class="small">基準 ${fmtDateW(d.nowMs)} ${String(new Date(d.nowMs + TZ).getUTCHours()).padStart(2, '0')}:${String(new Date(d.nowMs + TZ).getUTCMinutes()).padStart(2, '0')}</span>`;
  }

  function renderSummary(d) {
    const cur = levelLabel((state.level - 1) * LEVEL_EXP + state.exp);
    const effectiveCurrent = (state.level - 1) * LEVEL_EXP + state.exp + (state.tier === 'shinju' && state.pearlPending ? 10000 : 0);
    const need = Math.max(0, d.targetTotal - effectiveCurrent);
    const reachedOk = d.total >= d.targetTotal;
    const cls = reachedOk ? 'ok' : (d.deficit <= 0 ? 'ok' : (d.extraNeeded !== null || d.buyLevels <= 3 ? 'warn' : 'bad'));
    const week = d.currentWeek;
    const weekNow = Math.min(WEEK_CAP, state.weekEarned);
    const weekEnd = week ? weekNow + week.applied : weekNow;

    $('#summaryCards').innerHTML = `
      <div class="s-card">
        <div class="label">現在</div>
        <div class="value">Lv ${cur.lv}<small>${cur.exp === null ? '（MAX）' : `（${cur.exp} / 1,000）`}</small></div>
        <div class="sub">累計 ${((state.level - 1) * LEVEL_EXP + state.exp).toLocaleString()} EXP</div>
      </div>
      <div class="s-card">
        <div class="label">目標</div>
        <div class="value">Lv ${state.target}<small>まで ${need.toLocaleString()} EXP</small></div>
        <div class="sub">${state.target >= 50 ? 'Lv50 = 上限' : state.target >= 30 ? 'Lv30以上 = 紀行宝匣' : 'Lv30未満'}</div>
      </div>
      <div class="s-card ${cls}">
        <div class="label">この計画の着地</div>
        <div class="value">Lv ${d.projectedLevel}<small>${reachedOk ? '目標到達' : `あと ${d.deficit.toLocaleString()} EXP`}</small></div>
        <div class="sub">${d.reached ? (d.reached <= d.nowMs ? 'すでに到達' : `${fmtDateW(d.reached)} 到達見込み`) : 'シーズン内の到達なし'}</div>
      </div>
      <div class="s-card">
        <div class="label">今週</div>
        <div class="value">${weekNow.toLocaleString()}<small>/ 10,000</small></div>
        <div class="sub">${week ? `このあと +${week.applied.toLocaleString()} → ${Math.min(WEEK_CAP, weekEnd).toLocaleString()}` : '今週のデータなし'}</div>
      </div>`;
  }

  function renderWeekPanel(d) {
    const week = d.currentWeek;
    if (!week) {
      $('#weekBody').innerHTML = `<p class="note red">シーズンが終了している。設定の「シーズン終了日時」を確認する。</p>`;
      return;
    }
    const earned = Math.min(WEEK_CAP, Math.max(0, state.weekEarned));
    const capLeft = Math.max(0, WEEK_CAP - earned);
    const raw = week.rawDaily + week.rawWeekly;
    const applied = week.applied;
    const overflow = week.overflow;
    const after = earned + applied;
    const pct = v => Math.max(0, Math.min(100, v / WEEK_CAP * 100));
    const dailyOnly = d.dailyExp * 7;
    const doneExp = sumWeekly(state, 'thisWeek', 'done');
    const dailyCount = DAILY.filter(m => state.daily[m.id] !== false).length;
    const consistency = doneExp > earned
      ? `<p class="note red">済にした任務の合計は ${doneExp.toLocaleString()} EXP。入力した今週獲得 ${earned.toLocaleString()} EXP より大きい。今週の獲得値に入れ忘れていないか確認する。</p>`
      : '';
    const breakdown = (earned > 0 || doneExp > 0)
      ? `<p class="note">入力した今週獲得 ${earned.toLocaleString()} の内訳目安：済の任務 ${doneExp.toLocaleString()} ／ デイリー等 ${Math.max(0, earned - doneExp).toLocaleString()}。</p>`
      : '';

    let msg = '';
    if (raw === 0) {
      msg = `<p class="note">このあとの予定は0。ウィークリーの「今週」を「予定」にすると、ここに加算見込みが出る。</p>`;
    } else if (overflow > 0) {
      msg = `<p class="note red">デイリー残り ${week.rawDaily.toLocaleString()} ＋ ウィークリー予定 ${week.rawWeekly.toLocaleString()} = ${raw.toLocaleString()} のうち、<b>${overflow.toLocaleString()} EXP は週上限で切り捨て</b>。今週は ${applied.toLocaleString()} だけ加算される。</p>`;
    } else {
      msg = `<p class="note green">デイリー残り ${week.rawDaily.toLocaleString()} ＋ ウィークリー予定 ${week.rawWeekly.toLocaleString()} = ${raw.toLocaleString()}。すべて加算できて、今週は ${after.toLocaleString()} / 10,000 で終わる。</p>`;
    }

    $('#weekBody').innerHTML = `
      <div class="meter-labels">
        <div class="now">${earned.toLocaleString()}<span> / 10,000</span></div>
        <div class="remain">残り枠 ${capLeft.toLocaleString()} EXP</div>
      </div>
      <div class="meter" role="img" aria-label="今週の紀行経験 ${earned} / 10000">
        <div class="fill earned" style="width:${pct(earned)}%"></div>
        <div class="fill planned" style="left:${pct(earned)}%;width:${pct(Math.min(applied, capLeft))}%"></div>
        <div class="marker" style="left:${pct(dailyOnly)}%" title="デイリー7日分 ${dailyOnly}"></div>
      </div>
      <div class="meter-legend">
        <span><i class="dot earned"></i>すでに獲得 ${earned.toLocaleString()}</span>
        <span><i class="dot planned"></i>このあと加算 ${applied.toLocaleString()}</span>
        <span>デイリー7日分 ${dailyOnly.toLocaleString()}</span>
        <span>今週の済 ${doneExp.toLocaleString()}</span>
      </div>
      <div class="week-grid">
        <div class="mini"><div class="k">今週の残りデイリー</div><div class="v">${week.rawDaily.toLocaleString()}<small>（${week.days}日分）</small></div></div>
        <div class="mini"><div class="k">今週のウィークリー予定</div><div class="v">${week.rawWeekly.toLocaleString()}</div></div>
        <div class="mini"><div class="k">今週の着地</div><div class="v">${Math.min(WEEK_CAP, after).toLocaleString()}<small> / 10,000</small></div></div>
      </div>
      ${msg}
      ${consistency}
      ${breakdown}
      <p class="note gold" style="margin-top:8px">
        毎日${dailyCount}任務（1日 ${d.dailyExp} EXP）を ${state.playDays} 日やる前提だと、通常週のウィークリー加算枠は
        <b>${Math.max(0, WEEK_CAP - d.dailyExp * Math.min(7, state.playDays)).toLocaleString()} EXP</b>。
        ウィークリー全部（${d.allWeekly.toLocaleString()}）をやると、超えた分は切り捨てになる。
      </p>`;
  }

  function renderWeekly(d) {
    const rows = WEEKLY.map(m => {
      const s = state.weekly[m.id] || { thisWeek: 'none', future: false };
      const arBadge = m.ar > 20 ? `<span class="badge ar">AR${m.ar}〜</span>` : '';
      return `<tr>
        <td data-label="任務">
          <div class="m-name">${esc(m.name)} ${arBadge}</div>
          <div class="m-note">${esc(m.note || '')}</div>
        </td>
        <td class="exp" data-label="経験値">${m.exp.toLocaleString()}</td>
        <td data-label="今週">
          <div class="seg" data-week="${m.id}">
            <button type="button" data-w="${m.id}" data-v="done" class="${s.thisWeek === 'done' ? 'on done' : ''}">済</button>
            <button type="button" data-w="${m.id}" data-v="plan" class="${s.thisWeek === 'plan' ? 'on plan' : ''}">予定</button>
            <button type="button" data-w="${m.id}" data-v="none" class="${s.thisWeek === 'none' ? 'on none' : ''}">なし</button>
          </div>
        </td>
        <td data-label="来週以降">
          <label class="sw"><input type="checkbox" data-future="${m.id}" ${s.future ? 'checked' : ''}><span>毎週</span></label>
        </td>
      </tr>`;
    }).join('');
    $('#weeklyRows').innerHTML = rows;

    const done = sumWeekly(state, 'thisWeek', 'done');
    const plan = sumWeekly(state, 'thisWeek', 'plan');
    const future = sumWeekly(state, 'future', true);
    const doneN = WEEKLY.filter(m => state.weekly[m.id]?.thisWeek === 'done').length;
    const planN = WEEKLY.filter(m => state.weekly[m.id]?.thisWeek === 'plan').length;
    const futureN = WEEKLY.filter(m => state.weekly[m.id]?.future).length;
    $('#weeklyTotals').innerHTML = `
      <span class="done">今週 済 <b>${done.toLocaleString()}</b> EXP（${doneN}件）</span>
      <span class="plan">今週 予定 <b>${plan.toLocaleString()}</b> EXP（${planN}件）</span>
      <span>来週以降 <b>${future.toLocaleString()}</b> EXP/週（${futureN}件）</span>
      <span>全体 <b>${WEEKLY.reduce((s, m) => s + m.exp, 0).toLocaleString()}</b> EXP</span>`;
  }

  function renderSeason(d) {
    const missions = [...d.missions].sort((a, b) => {
      const dd = a.deadlineMs - b.deadlineMs;
      if (dd !== 0) return dd;
      return a.exp - b.exp;
    });
    const rows = missions.map(m => {
      const s = m.status;
      const expired = m.deadlineMs < d.nowMs;
      const days = daysUntil(m.deadlineMs, d.nowMs);
      const soon = !expired && days <= 7;
      const deadlineBadge = expired
        ? `<span class="badge expired">期限切れ</span>`
        : soon
          ? `<span class="badge soon">あと${days}日</span>`
          : `<span class="badge">${fmtDeadline(m.deadlineMs)}</span>`;
      const fromBadge = m.fromMs > d.nowMs ? `<div class="m-note">${fmtDate(m.fromMs)}〜</div>` : '';
      return `<tr>
        <td data-label="任務">
          <div class="m-name">${esc(m.name)} <span class="badge ${m.cat}">${CAT_LABEL[m.cat] || m.cat}</span></div>
          <div class="m-note">${esc(m.note || '')}</div>
          ${fromBadge}
        </td>
        <td class="exp" data-label="経験値">${m.exp.toLocaleString()}</td>
        <td data-label="期限">${deadlineBadge}</td>
        <td data-label="状態">
          <div class="seg" data-season="${m.id}">
            <button type="button" data-s="${m.id}" data-v="done" class="${s === 'done' ? 'on done' : ''}">済</button>
            <button type="button" data-s="${m.id}" data-v="plan" class="${s === 'plan' ? 'on plan' : ''}">予定</button>
            <button type="button" data-s="${m.id}" data-v="none" class="${s === 'none' ? 'on none' : ''}">なし</button>
          </div>
          ${m.cat === 'custom' ? `<button type="button" class="btn red" data-del="${m.id}" style="margin-left:6px;padding:2px 6px">削除</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    $('#seasonRows').innerHTML = rows;

    const done = missions.filter(m => m.status === 'done');
    const plan = missions.filter(m => m.status === 'plan');
    const none = missions.filter(m => m.status === 'none');
    const sum = arr => arr.reduce((s, m) => s + m.exp, 0);
    const total = sum(missions);
    $('#seasonTotals').innerHTML = `
      <span class="done">済 <b>${sum(done).toLocaleString()}</b> EXP（${done.length}件）</span>
      <span class="plan">予定 <b>${sum(plan).toLocaleString()}</b> EXP（${plan.length}件）</span>
      <span>未着手 <b>${sum(none).toLocaleString()}</b> EXP（${none.length}件）</span>
      <span>合計 <b>${total.toLocaleString()}</b> EXP（${(total / LEVEL_EXP).toFixed(1)} Lv分）</span>`;
  }

  function renderResult(d) {
    const cur = (state.level - 1) * LEVEL_EXP + state.exp;
    const targetOk = d.total >= d.targetTotal;
    const reachedText = d.reached
      ? (d.reached <= d.nowMs ? 'すでに到達' : `${fmtDateW(d.reached)} 到達見込み`)
      : 'シーズン内の到達なし';
    const cls = targetOk ? 'ok' : (d.buyLevels <= 3 ? 'warn' : 'bad');
    const subParts = [];
    if (d.pearlBonus) subParts.push(`真珠の歌 +${d.pearlBonus.toLocaleString()}`);
    if (d.plannedSeasonExp) subParts.push(`シーズン予定 +${d.plannedSeasonExp.toLocaleString()}`);
    subParts.push(`デイリー ${d.dailyExp}/日`);

    let advice = '';
    let extraLabel = '—';
    const extraRounded = d.extraNeeded !== null ? Math.ceil(d.extraNeeded / 50) * 50 : null;
    if (targetOk) {
      extraLabel = '—';
    } else if (extraRounded !== null) {
      extraLabel = `約 ${extraRounded.toLocaleString()} EXP/週`;
    } else if (d.saturated) {
      extraLabel = '上限到達済み';
    } else if (d.maxExtraTotal !== null && d.maxExtraTotal < d.targetTotal) {
      extraLabel = '全部足しても不足';
    }
    if (!targetOk) {
      if (d.buyLevels > 0) {
        advice += `<p class="note red">目標まで <b>${d.deficit.toLocaleString()} EXP</b> 不足。Lv購入 <b>${d.buyLevels}Lv分</b>（原石 ${d.buyCost.toLocaleString()}）で届く。購入分の余剰は ${Math.max(0, d.buyOverage).toLocaleString()} EXP。</p>`;
      }
      if (extraRounded !== null && extraRounded > 0) {
        advice += `<p class="note gold">ウィークリーをあと <b>約${extraRounded.toLocaleString()} EXP/週</b> 増やすと、購入なしで届く。未選択の任務から足す。</p>`;
      } else if (d.saturated) {
        advice += `<p class="note gold">来週以降のウィークリーはすでに週上限に達している。任務を増やしても切り捨てになるため、シーズン任務・プレイ日数・Lv購入で調整する。</p>`;
      } else if (d.maxExtraTotal !== null && d.maxExtraTotal < d.targetTotal) {
        advice += `<p class="note gold">ウィークリーを全部足しても、あと <b>${(d.targetTotal - d.maxExtraTotal).toLocaleString()} EXP</b> 足りない。シーズン任務かLv購入が要る。</p>`;
      }
    } else {
      advice += `<p class="note green">目標Lv ${state.target} に到達する。余剰 ${Math.max(0, d.total - d.targetTotal).toLocaleString()} EXP。</p>`;
    }
    const expiredPlanned = d.expired.filter(m => m.status === 'plan');
    if (expiredPlanned.length) {
      advice += `<p class="note red">期限切れの「予定」が ${expiredPlanned.length} 件ある（${expiredPlanned.map(m => esc(m.name)).join('、')}）。この分は着地に含めていない。</p>`;
    }
    if (d.totalOverflow > 0) {
      advice += `<p class="note">この計画で週上限に切り捨てられるのは合計 <b>${d.totalOverflow.toLocaleString()} EXP</b>。切り捨て分は翌週に回らない。</p>`;
    }

    $('#resultPanel').innerHTML = `
      <div class="result-hero">
        <div class="big">Lv ${d.projectedLevel}<small> / ${state.target}</small></div>
        <div class="sub">${reachedText} ／ 累計 ${d.total.toLocaleString()} EXP（目標 ${d.targetTotal.toLocaleString()}）</div>
      </div>
      <div class="kv">
        <div class="k">現在</div><div class="v">Lv ${state.level}（${state.exp} / 1,000）</div>
        <div class="k">目標まで</div><div class="v ${targetOk ? 'good' : 'bad'}">${Math.max(0, d.targetTotal - d.total).toLocaleString()} EXP</div>
        <div class="k">シーズン予定込み</div><div class="v">${d.plannedSeasonExp.toLocaleString()} EXP</div>
        <div class="k">今週の残り枠</div><div class="v ${d.currentWeek && d.currentWeek.overflow > 0 ? 'warn' : ''}">${Math.max(0, WEEK_CAP - Math.min(WEEK_CAP, state.weekEarned)).toLocaleString()} EXP</div>
        <div class="k">来週以降のウィークリー</div><div class="v">${d.futureWeekly.toLocaleString()} EXP/週</div>
      </div>
      <div class="divider"></div>
      <div class="kv">
        <div class="k">Lv購入が必要なら</div><div class="v ${d.buyLevels > 0 ? 'warn' : 'good'}">${d.buyLevels > 0 ? `${d.buyLevels} Lv / 原石 ${d.buyCost.toLocaleString()}` : '不要'}</div>
        <div class="k">ウィークリー追加の目安</div><div class="v">${extraLabel}</div>
        <div class="k">前提</div><div class="v" style="font-weight:500;color:var(--muted)">${subParts.join(' / ')}</div>
      </div>
      <div style="padding:0 18px 18px">${advice}</div>`;
  }

  function renderTimeline(d) {
    const rows = d.weeks.map(w => {
      const period = `${fmtDate(w.ws)}〜${fmtDate(w.ws + 6 * DAY)}`;
      const cls = w.isCurrent ? 'now-row' : '';
      return `<tr class="${cls}">
        <td>${period}${w.isCurrent ? ' <span class="badge">今週</span>' : ''}<div class="muted">${w.days}日プレイ</div></td>
        <td class="num">${w.rawDaily.toLocaleString()}</td>
        <td class="num">${w.rawWeekly.toLocaleString()}</td>
        <td class="num">${w.applied.toLocaleString()}${w.overflow > 0 ? `<div class="waste">-${w.overflow.toLocaleString()}</div>` : ''}</td>
        <td class="num">${w.seasonExp.toLocaleString()}</td>
        <td class="num">${w.gain.toLocaleString()}</td>
        <td class="num">${w.total.toLocaleString()}</td>
        <td class="num lv">${w.level}</td>
      </tr>`;
    }).join('');
    $('#timelineRows').innerHTML = rows;
    $('#timelineHint').textContent = `${d.weeks.length}週 / 上限適用＝実際に加算されるEXP / 切り捨て合計 ${d.totalOverflow.toLocaleString()} EXP`;
  }

  // ---------- events ----------
  function updateDailySummary() {
    const box = $('#dailyBox');
    if (!box) return;
    const total = DAILY.filter(m => state.daily[m.id] !== false).reduce((s, m) => s + m.exp, 0);
    const sumEl = box.querySelector('.totals');
    if (sumEl) sumEl.innerHTML = `<span>1日 <b>${total}</b> EXP</span><span>週7日で <b>${total * 7}</b> EXP</span>`;
  }

  function bindInputs() {
    const setInput = (key, val) => {
      const els = document.querySelectorAll(`[data-bind="${key}"]`);
      els.forEach(el => {
        if (el.type === 'checkbox') el.checked = !!val;
        else el.value = val;
      });
      if (key === 'weekEarned') {
        const r = $('#weekEarnedRange');
        if (r) r.value = val;
      }
    };
    for (const key of Object.keys(DEFAULT_STATE)) {
      if (['daily', 'weekly', 'season', 'custom'].includes(key)) continue;
      setInput(key, state[key]);
    }
    // daily checkboxes are rendered separately
    const dailyBox = $('#dailyBox');
    dailyBox.innerHTML = DAILY.map(m => `
      <label class="check">
        <input type="checkbox" data-daily="${m.id}" ${state.daily[m.id] !== false ? 'checked' : ''}>
        <span>${esc(m.name)}<small>${m.exp} EXP / 日</small></span>
      </label>`).join('') +
      `<div class="totals" style="padding-left:0"><span>1日 <b>${Object.values(state.daily).filter(Boolean).length ? DAILY.filter(m => state.daily[m.id] !== false).reduce((s, m) => s + m.exp, 0) : 0}</b> EXP</span><span>週7日で <b>${DAILY.filter(m => state.daily[m.id] !== false).reduce((s, m) => s + m.exp, 0) * 7}</b> EXP</span></div>`;
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.bind) {
      const key = t.dataset.bind;
      let val;
      if (t.type === 'checkbox') val = t.checked;
      else if (t.type === 'number') val = t.value === '' ? 0 : Number(t.value);
      else val = t.value;
      if (key === 'level') val = Math.max(1, Math.min(50, Math.round(val || 1)));
      if (key === 'target') val = Math.max(1, Math.min(50, Math.round(val || 1)));
      if (key === 'exp') val = Math.max(0, Math.min(999, Math.round(val || 0)));
      if (key === 'weekEarned') val = Math.max(0, Math.min(10000, Math.round(val || 0)));
      if (key === 'playDays') val = Math.max(1, Math.min(7, Math.round(val || 1)));
      if (key === 'ar') val = Math.max(20, Math.min(60, Math.round(val || 20)));
      if (key === 'seasonEnd' || key === 'nowOverride') {
        if (key === 'seasonEnd' && !val) return;
        if (val && !Number.isFinite(parseJst(val))) return;
      }
      state[key] = val;
      if (key === 'weekEarned') {
        const r = $('#weekEarnedRange');
        if (r && r.value !== String(val)) r.value = val;
      }
      save();
      render();
    }
    if (t.dataset.daily) {
      state.daily[t.dataset.daily] = t.checked;
      save();
      render();
      updateDailySummary();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.bind && t.type === 'checkbox') {
      state[t.dataset.bind] = t.checked;
      save(); render(); return;
    }
    if (t.dataset.daily) {
      state.daily[t.dataset.daily] = t.checked;
      save(); render(); updateDailySummary(); return;
    }
    if (t.dataset.future) {
      const id = t.dataset.future;
      state.weekly[id] = { ...(state.weekly[id] || {}), future: t.checked };
      save(); render(); return;
    }
    if (t.id === 'weekEarnedRange') {
      state.weekEarned = Number(t.value);
      const n = $('#weekEarned');
      if (n) n.value = t.value;
      save();
      render();
    }
    if (t.dataset.bind === 'tier' || t.dataset.bind === 'seasonEnd' || t.dataset.bind === 'nowOverride') {
      // handled by input listener, but select/change needs this
      const key = t.dataset.bind;
      state[key] = t.value;
      save();
      render();
    }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.w !== undefined) {
      const id = b.dataset.w, v = b.dataset.v;
      state.weekly[id] = { ...(state.weekly[id] || {}), thisWeek: v };
      save(); render(); return;
    }
    if (b.dataset.s !== undefined) {
      const id = b.dataset.s, v = b.dataset.v;
      if (String(id).startsWith('custom-')) {
        const m = state.custom.find(x => x.id === id);
        if (m) m.status = v;
      } else {
        state.season[id] = { ...(state.season[id] || {}), status: v };
      }
      save(); render(); return;
    }
    if (b.dataset.del) {
      state.custom = state.custom.filter(m => m.id !== b.dataset.del);
      save(); render(); return;
    }
    const act = b.dataset.act;
    if (!act) return;
    if (act === 'week-all-done') {
      for (const m of WEEKLY) state.weekly[m.id] = { ...(state.weekly[m.id] || {}), thisWeek: 'done' };
    } else if (act === 'week-all-plan') {
      for (const m of WEEKLY) state.weekly[m.id] = { ...(state.weekly[m.id] || {}), thisWeek: 'plan' };
    } else if (act === 'week-clear') {
      for (const m of WEEKLY) state.weekly[m.id] = { ...(state.weekly[m.id] || {}), thisWeek: 'none' };
    } else if (act === 'future-all') {
      for (const m of WEEKLY) state.weekly[m.id] = { ...(state.weekly[m.id] || {}), future: true };
    } else if (act === 'future-none') {
      for (const m of WEEKLY) state.weekly[m.id] = { ...(state.weekly[m.id] || {}), future: false };
    } else if (act === 'reset') {
      if (confirm('入力とチェックをすべて初期状態に戻す。よろしいか？')) {
        state = structuredClone(DEFAULT_STATE);
        localStorage.removeItem(STORE_KEY);
        bindInputs();
      }
    } else if (act === 'now-clear') {
      state.nowOverride = '';
      save(); bindInputs(); render(); return;
    }
    save(); render();
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'weekEarnedRange') return;
    if (e.target.dataset.bind === 'seasonEnd' && !e.target.value) {
      state.seasonEnd = DEFAULT_STATE.seasonEnd;
      bindInputs();
      render();
    }
  });

  $('#customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#customName').value.trim();
    const exp = Math.max(1, Math.min(9999, Math.round(Number($('#customExp').value) || 0)));
    if (!name || !exp) return;
    state.custom.push({ id: 'custom-' + Date.now(), name, exp, status: 'plan' });
    $('#customName').value = '';
    $('#customExp').value = '';
    save(); render();
  });

  $('#weekEarnedRange')?.addEventListener('input', (e) => {
    state.weekEarned = Number(e.target.value);
    const n = $('#weekEarned');
    if (n) n.value = e.target.value;
    save(); render();
  });

  bindInputs();
  render();
})();