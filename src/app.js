(() => {
  'use strict';

  const DAY = 86400000;
  const TZ = 9 * 3600000;
  const RESET_HOUR = 5; // アジアサーバーの04:00リセット = JST 05:00
  const WEEK_CAP = 10000;
  const LEVEL_EXP = 1000;
  const MAX_LEVEL = 50;
  const STORE_KEY = 'genshin-bp-planner-v4';

  const DATA = window.__BP_DATA__;
  const SEASON_META = DATA.season;
  const DAILY = DATA.daily;
  const WEEKLY = DATA.weekly;
  const SEASON = DATA.seasonMissions;

  const CAT_LABEL = { event: 'イベント', hard: '高難度', fixed: '常設' };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const DAILY_EXP = DAILY.reduce((s, m) => s + m.exp, 0);

  // 問診票の既定。買わない・やらない側に倒しておく。
  // 問診票。上から順に1問ずつ聞く。
  const ANSWERS = [
    { key: 'events', q: 'イベント任務、やっちゃう?', art: 'flag', def: true },
    { key: 'abyss', q: '深境螺旋は?', art: 'spiral', def: false },
    { key: 'theater', q: '幻想シアターは?', art: 'curtain', def: false },
    { key: 'stygian', q: '幽境の激戦は?', art: 'swords', def: false },
    { key: 'artifacts', q: '聖遺物、強化する?', art: 'flower', def: true },
    {
      key: 'mora', q: 'モラを使う予定は?', art: 'coin', def: 'none',
      choices: [
        { v: 'once', label: '今週だけ（強化など）' },
        { v: 'weekly', label: '毎週コツコツ50万ずつ' },
        { v: 'none', label: 'モラがないのよ…貧乏なのよ…' },
      ],
    },
    { key: 'tcg', q: '七聖召喚は?', art: 'cards', def: false },
    { key: 'farm', q: '秘境・ボス・地脈を回る?', art: 'loop', def: false },
    { key: 'cook', q: '料理は作る?', art: 'pot', def: true },
    { key: 'forge', q: '鍛造は頼む?', art: 'anvil', def: false },
    { key: 'friendpot', q: '他人の壺で買い物する?', art: 'teapot', def: false },
    { key: 'furniture', q: '調度品は作る?', art: 'chair', def: false },
  ];
  const ART = {
    flag: '<path d="M20 54V12"/><path d="M20 15h24l-5 7 5 7H20z"/>',
    spiral: '<path d="M32.0 30.0L32.5 29.7L33.0 29.6L33.7 29.6L34.4 29.7L35.0 30.1L35.7 30.6L36.2 31.3L36.6 32.1L36.8 33.1L36.7 34.2L36.5 35.2L35.9 36.3L35.2 37.3L34.2 38.1L33.0 38.7L31.6 39.1L30.1 39.2L28.6 39.0L27.1 38.4L25.6 37.5L24.4 36.3L23.4 34.8L22.7 33.0L22.4 31.2L22.4 29.2L22.9 27.2L23.8 25.2L25.1 23.5L26.8 22.0L28.8 20.9L31.0 20.1L33.4 19.8L35.9 20.1L38.4 20.8L40.7 22.0L42.7 23.8L44.4 25.9L45.7 28.4L46.5 31.2L46.6 34.2L46.2 37.1L45.2 40.0L43.6 42.7L41.4 45.0L38.8 46.9L35.7 48.3L32.4 49.0L29.0 49.1L25.5 48.4L22.2 47.1"/>',
    curtain: '<path d="M12 14h40"/><path d="M20 14c0 9 3 13 3 20v16"/><path d="M44 14c0 9-3 13-3 20v16"/><path d="M12 50h40"/>',
    swords: '<path d="M17 47l23-23"/><path d="M13 43l7 7"/><path d="M47 47L24 24"/><path d="M51 43l-7 7"/>',
    flower: '<circle cx="32" cy="32" r="4.5"/><circle cx="32" cy="18" r="6.5"/><circle cx="45" cy="26" r="6.5"/><circle cx="40" cy="41" r="6.5"/><circle cx="24" cy="41" r="6.5"/><circle cx="19" cy="26" r="6.5"/>',
    coin: '<circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="9"/>',
    cards: '<rect x="12" y="20" width="24" height="32" rx="4"/><rect x="28" y="14" width="24" height="32" rx="4"/>',
    loop: '<path d="M48 32a16 16 0 1 1-5-12"/><path d="M48 13v8h-8"/>',
    pot: '<path d="M14 30h36v8a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12z"/><path d="M10 30h44"/><path d="M26 22c0-4 4-4 4-8"/><path d="M36 22c0-4 4-4 4-8"/>',
    anvil: '<path d="M14 34h28c4 0 8-3 8-9"/><path d="M22 34v9h16v-9"/><path d="M18 50h24"/>',
    teapot: '<path d="M18 30h20a8 8 0 0 1 0 16H18z"/><path d="M38 33h7a4 4 0 0 1 0 8h-7"/><path d="M22 30v-5h12v5"/>',
    chair: '<path d="M22 12v22h20"/><path d="M22 34h20v16"/><path d="M27 34v10"/><path d="M20 50h4"/>',
    check: '<path d="M14 34l12 12 24-26"/>',
  };
  // 図形の重心が 32,32 に来るようにずらす（見切れと偏りを防ぐ）
  const ART_POS = {
    flag: '0 -1', spiral: '-2.4 -2.4', curtain: '0 0', swords: '0 -5', flower: '0 2.5',
    coin: '0 0', cards: '0 -1', loop: '0 1.7', pot: '0 0', anvil: '0 -5.5',
    teapot: '-1.5 -3.5', chair: '1 1', check: '0 -1',
  };
  const artSvg = (name, cls = 'quiz-art') =>
    `<svg class="${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><g transform="translate(${ART_POS[name] || '0 0'})">${ART[name] || ''}</g></svg>`;

  const ANSWERS_DEFAULT = Object.fromEntries(ANSWERS.map(a => [a.key, a.def]));

  // 問診票の答えを任務の選択に反映する。表側はあとから手で直してよい。
  function applyAnswers(state) {
    const a = state.answers || ANSWERS_DEFAULT;
    const w = (id, thisWeek, future) => { if (state.weekly[id]) state.weekly[id] = { thisWeek, future }; };
    const s = (id, on) => { if (state.season[id]) state.season[id] = { status: on ? 'plan' : 'none' }; };

    // シーズン任務
    for (const m of SEASON) if (m.cat === 'event') s(m.id, a.events);
    for (const id of ['art30', 'art60', 'art100']) s(id, a.artifacts);
    s('abyss', a.abyss);
    s('theater', a.theater);
    s('stygian', a.stygian);

    // ウィークリー
    // モラ: 今週だけ使う / 毎週コツコツ / 使わない
    w('mora', a.mora === 'none' ? 'none' : 'plan', a.mora === 'weekly');
    w('tcg', a.tcg ? 'plan' : 'none', a.tcg);
    for (const id of ['domain', 'leyline', 'boss', 'trounce']) w(id, a.farm ? 'plan' : 'none', a.farm);
    w('cook', a.cook ? 'plan' : 'none', a.cook);
    w('forge', a.forge ? 'plan' : 'none', a.forge);
    w('friendpot', a.friendpot ? 'plan' : 'none', a.friendpot);
    w('furniture', a.furniture ? 'plan' : 'none', a.furniture);
    // デイリーを回していれば樹脂も洞天宝銭も自然に貯まる
    w('resin1200', 'plan', true);
    w('teapot', 'plan', true);
  }

  // 入力は紀行画面から拾える数字だけ。デイリーは毎日、ウィークリーは選んだものを毎週やる前提。
  function defaultState() {
    const s = {
      target: 50,
      level: 1,
      exp: 0,
      weekEarned: 0,
      todayDone: false,
      ar: 60,
      seasonEnd: SEASON_META.end,
      nowOverride: '',
      answers: { ...ANSWERS_DEFAULT },
      weekly: Object.fromEntries(WEEKLY.map(m => [m.id, { thisWeek: 'none', future: false }])),
      season: Object.fromEntries(SEASON.map(m => [m.id, { status: 'none' }])),
    };
    applyAnswers(s);
    return s;
  }
  const DEFAULT_STATE = defaultState();

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
    // 現在のLvを申告してもらうので、購入プランは計算に入れない。
    let total = (state.level - 1) * LEVEL_EXP + state.exp;

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
    const startTotal = (state.level - 1) * LEVEL_EXP + state.exp;
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
      nowMs, endMs, targetTotal, arMax, weeklyNeeded, dailyExp: DAILY_EXP,
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
      } else if (k === 'answers') {
        if (saved.answers && typeof saved.answers === 'object') {
          for (const q of ANSWERS) {
            const v = saved.answers[q.key];
            if (q.choices) {
              if (q.choices.some(c => c.v === v)) out.answers[q.key] = v;
            } else if (typeof v === 'boolean') {
              out.answers[q.key] = v;
            }
          }
        }
      } else {
        out[k] = saved[k];
      }
    }
    return out;
  }

  let state = loadState();

  // ---------- 計画のURL共有 ----------
  const b64url = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64url = (code) => {
    const pad = code.length % 4 ? '='.repeat(4 - (code.length % 4)) : '';
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  };

  function encodePlan() {
    const p = {
      v: 1,
      l: state.level, e: state.exp, w: state.weekEarned, t: state.todayDone ? 1 : 0,
      a: state.ar, g: state.target,
      q: ANSWERS.map(q => (q.choices ? String(q.choices.findIndex(c => c.v === state.answers[q.key])) : (state.answers[q.key] ? '1' : '0'))).join(''),
      W: WEEKLY.map(m => {
        const w = state.weekly[m.id] || {};
        return (w.thisWeek === 'done' ? '2' : w.thisWeek === 'plan' ? '1' : '0') + (w.future ? '1' : '0');
      }).join(''),
      S: SEASON.map(m => {
        const st = state.season[m.id]?.status;
        return st === 'done' ? '2' : st === 'plan' ? '1' : '0';
      }).join(''),
    };
    if (state.seasonEnd !== SEASON_META.end) p.se = state.seasonEnd;
    return b64url(JSON.stringify(p));
  }

  function decodePlan(code) {
    try {
      const p = JSON.parse(unb64url(code));
      if (p.v !== 1) return null;
      if (String(p.q).length !== ANSWERS.length) return null;
      if (String(p.W).length !== WEEKLY.length * 2) return null;
      if (String(p.S).length !== SEASON.length) return null;
      return p;
    } catch (_) {
      return null;
    }
  }

  function applyPlan(p) {
    const cl = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : d);
    state.level = cl(p.l, 1, 50, 1);
    state.exp = cl(p.e, 0, 999, 0);
    state.weekEarned = cl(p.w, 0, 10000, 0);
    state.todayDone = !!p.t;
    state.ar = cl(p.a, 20, 60, 60);
    state.target = cl(p.g, 1, 50, 50);
    if (typeof p.se === 'string') state.seasonEnd = p.se;
    ANSWERS.forEach((q, i) => {
      const c = String(p.q)[i];
      state.answers[q.key] = q.choices
        ? (q.choices[Number(c)] || q.choices[q.choices.length - 1]).v
        : c === '1';
    });
    WEEKLY.forEach((m, i) => {
      const t = String(p.W)[i * 2];
      const f = String(p.W)[i * 2 + 1];
      state.weekly[m.id] = { thisWeek: t === '2' ? 'done' : t === '1' ? 'plan' : 'none', future: f === '1' };
    });
    SEASON.forEach((m, i) => {
      const s = String(p.S)[i];
      state.season[m.id] = { status: s === '2' ? 'done' : s === '1' ? 'plan' : 'none' };
    });
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
        return true;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'sr-only';
      document.body.appendChild(ta);
      ta.select();
      const ok = !!(document.execCommand && document.execCommand('copy'));
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

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
    renderQuiz();
    renderWeekly(d);
    renderSeason(d);
    renderChart(d);
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
        <button type="button" class="share-btn" id="shareBtn" data-share>共有</button>
      </div>
      ${notes.length ? `<div class="notes">${notes.join('')}</div>` : ''}`;
  }

  let quizStep = 0;

  function renderQuiz() {
    const total = ANSWERS.length;
    if (quizStep >= total) {
      const d = compute(state);
      $('#quizBody').innerHTML = `
        <div class="quiz-done">
          ${artSvg('check')}
          <p class="quiz-q">おつかれ。下の表に入れておいたよ</p>
          <div class="quiz-summary">
            <div><span>シーズン任務</span><b>${d.planned.length}件 ${num(d.plannedSeasonExp)} EXP</b></div>
            <div><span>今週のウィークリー</span><b>${num(d.thisWeekPool)} EXP</b></div>
            <div><span>着地点</span><b>Lv ${d.projectedLevel}</b></div>
          </div>
          <button type="button" class="quiz-btn yes on wide" data-quiz-close>とじる</button>
        </div>`;
      $('#quizStep').textContent = 'おわり';
      $('[data-quiz-prev]').disabled = false;
      const yes = ANSWERS.filter(q => (q.choices ? state.answers[q.key] !== 'none' : state.answers[q.key])).length;
      $('#quizCount').textContent = `やる ${yes} / ${total}`;
      return;
    }

    const item = ANSWERS[quizStep];
    const val = state.answers[item.key];
    $('#quizBody').innerHTML = `
      <div class="quiz-dots">
        ${ANSWERS.map((q, i) => `<button type="button" class="quiz-dot${i === quizStep ? ' now' : ''}" data-quiz-jump="${i}" aria-label="${i + 1}問目"></button>`).join('')}
      </div>
      <div class="quiz-card">
        ${artSvg(item.art)}
        <p class="quiz-q">${item.q}</p>
        ${item.choices
          ? `<div class="quiz-choices">${item.choices.map(c => `<button type="button" class="quiz-btn wide${val === c.v ? ' yes on' : ''}" data-a="${item.key}" data-v="${c.v}">${c.label}</button>`).join('')}</div>`
          : `<div class="quiz-answers">
              <button type="button" class="quiz-btn yes${val ? ' on' : ''}" data-a="${item.key}" data-v="yes">やる</button>
              <button type="button" class="quiz-btn no${val ? '' : ' on'}" data-a="${item.key}" data-v="no">やらない</button>
            </div>`}
      </div>`;
    $('#quizStep').textContent = `${quizStep + 1} / ${total}`;
    $('[data-quiz-prev]').disabled = quizStep === 0;
    const yes = ANSWERS.filter(q => (q.choices ? state.answers[q.key] !== 'none' : state.answers[q.key])).length;
    $('#quizCount').textContent = `やる ${yes} / ${total}`;
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
    // 並び順は data/season.json の順。イベント → 聖遺物 → 祈願 → 高難度。
    const missions = d.missions;
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
    const startTotal = (state.level - 1) * LEVEL_EXP + state.exp;
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
    for (const key of ['target', 'level', 'exp', 'weekEarned', 'ar', 'seasonEnd', 'nowOverride']) {
      const el = document.querySelectorAll(`[data-bind="${key}"]`);
      el.forEach(n => { n.value = state[key]; });
    }
    for (const key of ['todayDone']) {
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

  document.addEventListener('input', (e) => {
    const id = e.target.dataset?.future;
    if (!id) return;
    state.weekly[id] = { ...(state.weekly[id] || {}), future: e.target.checked };
    save();
    render();
  });

  function openQuiz() {
    quizStep = 0;
    renderQuiz();
    $('#quizModal').hidden = false;
    document.body.classList.add('modal-open');
    const first = $('#quizBody button');
    if (first) first.focus();
  }
  function closeQuiz() {
    $('#quizModal').hidden = true;
    document.body.classList.remove('modal-open');
    const open = $('#quizOpen');
    if (open) open.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#quizModal').hidden) closeQuiz();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-quiz-open]')) { openQuiz(); return; }
    if (e.target.closest('[data-share]')) {
      const code = encodePlan();
      const url = location.origin + location.pathname + '#p=' + code;
      try { history.replaceState(null, '', '#p=' + code); } catch (_) {}
      const ok = copyText(url);
      const btn = e.target.closest('[data-share]');
      if (btn) {
        btn.textContent = ok ? 'コピーした' : 'URLを出した';
        btn.classList.add('done');
        clearTimeout(btn._t);
        btn._t = setTimeout(() => {
          btn.textContent = '共有';
          btn.classList.remove('done');
        }, 2600);
      }
      return;
    }
    if (e.target.closest('[data-quiz-close]')) { closeQuiz(); return; }
    if (e.target.closest('[data-quiz-prev]')) { quizStep = Math.max(0, quizStep - 1); render(); return; }
    const jump = e.target.closest('[data-quiz-jump]');
    if (jump) { quizStep = Number(jump.dataset.quizJump); render(); return; }
    const ans = e.target.closest('button[data-a]');
    if (ans) {
      const q = ANSWERS.find(x => x.key === ans.dataset.a);
      state.answers[ans.dataset.a] = q && q.choices ? ans.dataset.v : ans.dataset.v === 'yes';
      applyAnswers(state);
      save();
      if (quizStep < ANSWERS.length) quizStep += 1; // 答えたら次へ
      render();
      return;
    }
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

  // 共有URL（#p=...）があれば一度だけ読み込む。読んだらハッシュは消す。
  (() => {
    const m = /(?:^|[#&])p=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (!m) return;
    const shared = decodePlan(m[1]);
    if (shared) applyPlan(shared);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  })();

  bindInputs();
  render();
})();
