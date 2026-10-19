(() => {
  'use strict';

  const API = 'https://api.deepseek.com';
  const FLASH_MODEL = 'deepseek-flash';
  const MAX_COUNT = 50;      // Search API 单次最多返回 50 条
  const PAGE_SIZE = 10;
  const STORE_KEY = 'ds-search-settings';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const form = $('#searchForm');
  const input = $('#q');
  const clearBtn = $('#clearBtn');
  const suggestEl = $('#suggest');
  const resultsEl = $('#results');
  const statEl = $('#stat');
  const pagerEl = $('#pager');
  const relatedEl = $('#related');
  const modal = $('#settings');

  /* ---------------- 设置 ---------------- */

  const settings = loadSettings();

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { /* 隐私模式等 */ }
    return { apiKey: saved.apiKey || '', suggest: saved.suggest !== false };
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function apiKey() {
    return settings.apiKey || window.DS_LOCAL_KEY || '';
  }

  function openSettings(tip) {
    $('#apiKey').value = settings.apiKey;
    $('#apiKey').type = 'password';
    $('#toggleKey').textContent = '显示';
    $('#suggestOn').checked = settings.suggest;
    const tipEl = $('#settingsTip');
    tipEl.textContent = tip || '';
    tipEl.hidden = !tip;
    modal.hidden = false;
    hideSuggest();
    setTimeout(() => $('#apiKey').focus(), 0);
  }

  function closeSettings() { modal.hidden = true; }

  $$('[data-open-settings]').forEach(b => b.addEventListener('click', () => openSettings()));
  $$('[data-close-settings]').forEach(b => b.addEventListener('click', closeSettings));
  $('#toggleKey').addEventListener('click', () => {
    const k = $('#apiKey');
    const show = k.type === 'password';
    k.type = show ? 'text' : 'password';
    $('#toggleKey').textContent = show ? '隐藏' : '显示';
  });
  $('#saveSettings').addEventListener('click', () => {
    const keyChanged = $('#apiKey').value.trim() !== settings.apiKey;
    settings.apiKey = $('#apiKey').value.trim();
    settings.suggest = $('#suggestOn').checked;
    saveSettings();
    closeSettings();
    if (!settings.suggest) { hideSuggest(); relatedEl.hidden = true; }
    if (keyChanged) { searchCache.clear(); suggestCache.clear(); }
    if (currentQuery()) route();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeSettings();
  });

  if (window.tippy) {
    tippy('#apiKeyInfo', {
      allowHTML: true,
      interactive: true,
      interactiveBorder: 14,
      placement: 'right',
      delay: [100, 0],
      content: '<a style="color:#9db4ff;text-decoration:underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">点击获取</a>，仅保存到本地浏览器。',
    });
  }

  /* ---------------- API ---------------- */

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function callApi(path, body, signal) {
    const key = apiKey();
    if (!key) throw new ApiError(0, 'NO_KEY');
    let res;
    try {
      res = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ApiError(-1, '网络请求失败，请检查网络连接');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || res.statusText || '请求失败';
      throw new ApiError(res.status, msg);
    }
    return data;
  }

  function describeError(err) {
    switch (err.status) {
      case 401: return 'API Key 无效或已过期，请在设置中检查。';
      case 402: return 'DeepSeek 账户余额不足。';
      case 429: return '请求过于频繁，请稍后再试。';
      default: return err.message || '未知错误';
    }
  }

  async function flashLines(system, user, signal, maxTokens) {
    const data = await callApi('/chat/completions', {
      model: FLASH_MODEL,
      thinking: { type: 'disabled' },
      max_tokens: maxTokens || 200,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }, signal);
    const text = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
    const seen = new Set();
    return text.split('\n')
      .map(s => s.replace(/^\s*(?:\d+[.、)）]|[-*•])\s*/, '').replace(/^["“'「]+|["”'」]+$/g, '').trim())
      .filter(s => {
        const k = s.toLowerCase();
        if (!s || s.length > 128 || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /* ---------------- 搜索框位置 & 路由 ---------------- */

  function currentQuery() {
    return (new URLSearchParams(location.search).get('wd') || '').trim();
  }

  function currentPage() {
    const n = parseInt(new URLSearchParams(location.search).get('pn'), 10);
    return n > 0 ? n : 1;
  }

  function go(query, page, replace) {
    const url = new URL(location.href);
    url.search = '';
    if (query) {
      url.searchParams.set('wd', query);
      if (page > 1) url.searchParams.set('pn', String(page));
    }
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    route();
  }

  function route() {
    const q = currentQuery();
    hideSuggest();
    if (!q) {
      document.body.className = 'is-home';
      document.title = 'DeepSeek Search';
      $('.home-form-slot').appendChild(form);
      input.value = '';
      syncClear();
      input.focus();
      return;
    }
    document.body.className = 'is-result';
    document.title = q + ' - DeepSeek Search';
    $('.result-form-slot').appendChild(form);
    input.value = q;
    syncClear();
    showSearch(q, currentPage());
  }

  window.addEventListener('popstate', route);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    input.blur();
    go(q, 1);
  });

  $('[data-go-home]').addEventListener('click', e => { e.preventDefault(); go('', 1); });

  window.addEventListener('scroll', () => {
    $('.result-top').classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  /* ---------------- 搜索 & 渲染 ---------------- */

  const searchCache = new Map();   // query -> Promise<{results, ms}>
  let searchSeq = 0;

  function fetchSearch(q) {
    if (searchCache.has(q)) return searchCache.get(q);
    const t0 = performance.now();
    const p = callApi('/v1/tools/search', { query: q, count: MAX_COUNT, ori_question: q })
      .then(data => ({ results: (data && data.results) || [], ms: performance.now() - t0 }));
    searchCache.set(q, p);
    p.catch(() => searchCache.delete(q));
    return p;
  }

  async function showSearch(q, page) {
    const seq = ++searchSeq;
    pagerEl.innerHTML = '';
    if (!searchCache.has(q)) {
      statEl.textContent = '';
      resultsEl.innerHTML = skeleton();
      relatedEl.hidden = true;
    }
    let data;
    try {
      data = await fetchSearch(q);
    } catch (err) {
      if (seq !== searchSeq) return;
      statEl.textContent = '';
      relatedEl.hidden = true;
      if (err.status === 0) {
        resultsEl.innerHTML = `<div class="state"><b>需要先配置 DeepSeek API Key</b><br>点击右上角齿轮图标，填入你的 API Key 后即可搜索。<br><button class="primary-btn" type="button" data-open-settings>去设置</button></div>`;
        $('[data-open-settings]', resultsEl).addEventListener('click', () => openSettings());
        openSettings('请先填写 DeepSeek API Key');
      } else {
        resultsEl.innerHTML = `<div class="state"><b>搜索失败</b><br>${esc(describeError(err))}<br><button class="primary-btn" type="button" id="retryBtn">重试</button></div>`;
        $('#retryBtn').addEventListener('click', () => showSearch(q, page));
      }
      return;
    }
    if (seq !== searchSeq) return;

    const { results, ms } = data;
    const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    page = Math.min(page, pages);

    if (!results.length) {
      statEl.textContent = '';
      resultsEl.innerHTML = `<div class="state">抱歉，没有找到与“<b>${esc(q)}</b>”相关的网页结果。<br>建议检查输入的文字是否有误，或尝试更换关键词。</div>`;
      relatedEl.hidden = true;
      loadRelated(q, seq);
      return;
    }

    statEl.textContent = `DeepSeek Search 为您找到相关结果 ${results.length} 个（用时 ${(ms / 1000).toFixed(2)} 秒）`;
    const hl = highlighter(q);
    const start = (page - 1) * PAGE_SIZE;
    resultsEl.innerHTML = results.slice(start, start + PAGE_SIZE).map(r => renderItem(r, hl)).join('');
    renderPager(q, page, pages);
    if (page === 1 || relatedEl.dataset.q !== q) loadRelated(q, seq);
  }

  function skeleton() {
    const one = '<div class="item skeleton"><div class="sk t"></div><div class="sk"></div><div class="sk"></div><div class="sk s"></div></div>';
    return one.repeat(5);
  }

  function renderItem(r, hl) {
    const url = safeUrl(r.url);
    const host = hostOf(url);
    const date = fmtDate(r.date);
    const site = r.site_name || host;
    const icon = r.site_icon && safeUrl(r.site_icon) !== '#'
      ? `<span class="ico" style="background-image:url('${esc(r.site_icon).replace(/'/g, '%27')}')"></span>`
      : `<span class="ico">${esc((site || '?').slice(0, 1).toUpperCase())}</span>`;
    const tag = r.authority >= 3 ? '<span class="tag" title="高权威来源">权威</span>' : '';
    return `<div class="item">
      <h3><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${hl(r.title || url)}</a></h3>
      <p class="snippet">${date ? `<span class="date">${date}</span>` : ''}${hl(r.snippet || '')}</p>
      <div class="meta">${icon}<span>${esc(site)}</span><span class="url">${esc(displayUrl(url))}</span>${tag}</div>
    </div>`;
  }

  function renderPager(q, page, pages) {
    if (pages <= 1) { pagerEl.innerHTML = ''; return; }
    const link = (p, text) => `<a href="?${new URLSearchParams(p > 1 ? { wd: q, pn: p } : { wd: q })}" data-page="${p}">${text}</a>`;
    let html = page > 1 ? link(page - 1, '&lt; 上一页') : '';
    for (let p = 1; p <= pages; p++) html += p === page ? `<strong>${p}</strong>` : link(p, p);
    if (page < pages) html += link(page + 1, '下一页 &gt;');
    pagerEl.innerHTML = html;
  }

  pagerEl.addEventListener('click', e => {
    const a = e.target.closest('[data-page]');
    if (!a) return;
    e.preventDefault();
    go(currentQuery(), +a.dataset.page);
    window.scrollTo({ top: 0 });
  });

  /* ---------------- 相关搜索 ---------------- */

  const relatedCache = new Map();

  async function loadRelated(q, seq) {
    if (!settings.suggest) { relatedEl.hidden = true; return; }
    relatedEl.dataset.q = q;
    try {
      let list = relatedCache.get(q);
      if (!list) {
        list = await flashLines(
          `你是搜索引擎的“相关搜索”推荐服务。今天是${today()}。根据用户的搜索词，给出 9 个用户接下来最可能搜索的相关查询词，覆盖不同角度，简短自然，与输入语言一致。每行一个，不要编号、引号或任何解释。`,
          q, undefined, 200);
        list = list.filter(s => s.toLowerCase() !== q.toLowerCase()).slice(0, 9);
        relatedCache.set(q, list);
      }
      if (seq !== searchSeq || !list.length) return;
      relatedEl.innerHTML = '<h4>相关搜索</h4><div class="grid">' +
        list.map(s => `<a href="?${new URLSearchParams({ wd: s })}" data-related="${esc(s)}" title="${esc(s)}">${esc(s)}</a>`).join('') +
        '</div>';
      relatedEl.hidden = false;
    } catch (e) {
      relatedEl.hidden = true;
    }
  }

  relatedEl.addEventListener('click', e => {
    const a = e.target.closest('[data-related]');
    if (!a) return;
    e.preventDefault();
    go(a.dataset.related, 1);
    window.scrollTo({ top: 0 });
  });

  /* ---------------- 下拉候选词 ---------------- */

  const suggestCache = new Map();
  let suggestTimer = 0;
  let suggestCtrl = null;
  let typed = '';          // 用户实际输入的内容（键盘选择候选词时不变）
  let items = [];
  let active = -1;
  let composing = false;

  function syncClear() { clearBtn.hidden = !input.value; }

  clearBtn.addEventListener('click', () => {
    input.value = '';
    typed = '';
    syncClear();
    hideSuggest();
    input.focus();
  });

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; onType(); });
  input.addEventListener('input', () => { syncClear(); if (!composing) onType(); });
  input.addEventListener('focus', () => {
    const v = input.value.trim();
    if (v && settings.suggest && suggestCache.has(v)) { typed = input.value; renderSuggest(v, suggestCache.get(v)); }
  });
  input.addEventListener('blur', () => setTimeout(hideSuggest, 120));

  function onType() {
    typed = input.value;
    const v = typed.trim();
    clearTimeout(suggestTimer);
    if (suggestCtrl) suggestCtrl.abort();
    if (!v || !settings.suggest || !apiKey()) { hideSuggest(); return; }
    if (suggestCache.has(v)) { renderSuggest(v, suggestCache.get(v)); return; }
    suggestTimer = setTimeout(() => fetchSuggest(v), 220);
  }

  async function fetchSuggest(v) {
    suggestCtrl = new AbortController();
    const ctrl = suggestCtrl;
    try {
      const list = (await flashLines(
        `你是搜索引擎的搜索联想（自动补全）服务。今天是${today()}。根据用户已经输入的内容，预测用户最可能想搜索的 10 个完整查询词。要求：优先以用户输入为前缀进行补全；贴近真实用户的搜索习惯，简短；与输入语言一致。每行一个，不要编号、引号或任何解释。`,
        v, ctrl.signal, 200)).filter(s => s !== v).slice(0, 10);
      suggestCache.set(v, list);
      if (ctrl === suggestCtrl && input.value.trim() === v && document.activeElement === input) renderSuggest(v, list);
    } catch (e) {
      /* 候选词失败时静默 */
    }
  }

  function renderSuggest(v, list) {
    items = list;
    active = -1;
    if (!list.length) { hideSuggest(); return; }
    const lower = v.toLowerCase();
    suggestEl.innerHTML = list.map((s, i) => {
      const body = s.toLowerCase().startsWith(lower)
        ? esc(s.slice(0, v.length)) + '<b>' + esc(s.slice(v.length)) + '</b>'
        : esc(s);
      return `<li role="option" data-i="${i}">${body}</li>`;
    }).join('');
    suggestEl.hidden = false;
    form.classList.add('open');
  }

  function hideSuggest() {
    suggestEl.hidden = true;
    form.classList.remove('open');
    active = -1;
  }

  function setActive(i) {
    const lis = $$('li', suggestEl);
    lis.forEach(li => li.classList.remove('active'));
    active = i;
    if (i >= 0) { lis[i].classList.add('active'); input.value = items[i]; } else input.value = typed;
    syncClear();
  }

  input.addEventListener('keydown', e => {
    if (suggestEl.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      let i = active + (e.key === 'ArrowDown' ? 1 : -1);
      if (i >= n) i = -1;
      if (i < -1) i = n - 1;
      setActive(i);
    } else if (e.key === 'Escape') {
      input.value = typed;
      hideSuggest();
    }
  });

  suggestEl.addEventListener('mousedown', e => e.preventDefault());
  suggestEl.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    input.value = items[+li.dataset.i];
    hideSuggest();
    form.requestSubmit();
  });

  /* ---------------- 工具函数 ---------------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function safeUrl(u) {
    try {
      const url = new URL(u);
      return /^https?:$/.test(url.protocol) ? url.href : '#';
    } catch (e) { return '#'; }
  }

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function displayUrl(u) {
    try {
      const url = new URL(u);
      let s = url.hostname + decodeURI(url.pathname);
      if (s.endsWith('/')) s = s.slice(0, -1);
      return s;
    } catch (e) { return u; }
  }

  function fmtDate(d) {
    if (!d) return '';
    const t = new Date(d);
    if (isNaN(t)) return '';
    return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
  }

  // 根据查询词生成高亮函数：先转义，再把关键词包进 <em>
  function highlighter(q) {
    const words = new Set();
    q.replace(/-?site:\S+/gi, ' ').replace(/["“”]/g, ' ').split(/[\s,，、。;；:：!！?？()（）]+/).forEach(w => {
      if (!w) return;
      if (w.length >= 2 || /[一-鿿]/.test(w)) words.add(w);
      // 较长的中文片段再按两字切分，近似分词
      const cjk = w.match(/[一-鿿]{3,}/g) || [];
      cjk.forEach(run => { for (let i = 0; i + 2 <= run.length; i += 2) words.add(run.slice(i, i + 2)); });
    });
    const list = [...words].filter(w => w.length >= 2 || /[一-鿿]/.test(w))
      .sort((a, b) => b.length - a.length)
      .map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!list.length) return esc;
    const re = new RegExp('(' + list.join('|') + ')', 'gi');
    // 跳过 &amp; 之类的实体，避免把实体拆坏
    return s => esc(s).split(/(&[a-z0-9#]+;)/).map((part, i) => i % 2 ? part : part.replace(re, '<em>$1</em>')).join('');
  }

  /* ---------------- 启动 ---------------- */

  function start() {
    route();
    if (!apiKey() && !currentQuery()) {
      // 首次访问提示配置
      setTimeout(() => openSettings('首次使用请先填写 DeepSeek API Key'), 300);
    }
  }

  // 本地开发时可放一个不入库的 config.local.js（window.DS_LOCAL_KEY = 'sk-...'）
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    const s = document.createElement('script');
    s.src = 'config.local.js';
    s.onload = s.onerror = start;
    document.head.appendChild(s);
  } else {
    start();
  }
})();
