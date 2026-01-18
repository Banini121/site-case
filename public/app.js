const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

async function apiFetch(path, options = {}) {
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  }, options.headers || {});

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  if (res.status === 401 || res.status === 403) {
    try {
      const err = await res.json();
      if (err && err.message) {
        // no-op
      }
    } catch {}
    window.location.href = '/';
    return Promise.reject(new Error('Unauthorized'));
  }
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = { message: 'Ошибка запроса' }; }
    throw new Error(err?.message || 'Ошибка запроса');
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ----------------------------- Modal utils ----------------------------- */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('modal-open');
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.open')) {
    document.documentElement.classList.remove('modal-open');
  }
  stopInfiniteSpinner();
}

document.addEventListener('click', (e) => {
  const target = e.target;

  // close by [data-close]
  if (target && target.matches('[data-close]')) {
    const modal = target.closest('.modal');
    if (modal && modal.id === 'case-spinner' && window.__spinnerLocked) return;
    closeModal(modal);
    return;
  }

  // close by click on backdrop
  if (target && target.classList && target.classList.contains('modal')) {
    if (target.id === 'case-spinner' && window.__spinnerLocked) return;
    closeModal(target);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const modal = document.querySelector('.modal.open');
  if (modal) {
    if (modal.id === 'case-spinner' && window.__spinnerLocked) return;
    closeModal(modal);
  }
});

/* ----------------------------- Logout ----------------------------- */

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  });
}

/* ----------------------------- Cases list (public) ----------------------------- */

function formatNum(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('ru-RU');
}

function caseCardHtml(item) {
  const disabled = item.disabled ? 'disabled' : '';
  const img = item.imageUrl
    ? `<img class="case-img" src="${item.imageUrl}" alt="${item.name}" referrerpolicy="no-referrer" loading="lazy">`
    : `<div class="case-img case-img--placeholder"></div>`;

  const remainingTotal = (item.remainingTotal ?? item.maxTotal ?? null);
  const remainingUser = (item.remainingPerUser ?? item.maxPerUser ?? null);

  return `
    <article class="case-card ${disabled}">
      <div class="case-media">${img}</div>
      <div class="case-content">
        <div class="case-top">
          <h4 class="case-title" title="${item.name}">${item.name}</h4>
          <div class="case-badges">
            ${item.price !== undefined ? `<span class="chip chip--primary">Цена: ${formatNum(item.price)}</span>` : ''}
          </div>
        </div>

        <div class="case-meta">
          ${remainingTotal !== null ? `<span class="meta">Осталось: <b>${formatNum(remainingTotal)}</b></span>` : ''}
          ${remainingUser !== null ? `<span class="meta">Лимит: <b>${formatNum(remainingUser)}</b></span>` : ''}
        </div>

        <div class="case-actions">
          <button class="btn btn-primary btn-pill" data-open-case="${item.name}" ${item.disabled ? 'disabled' : ''}>
            <i class="bi bi-play-fill"></i><span>Открыть</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

async function loadCases(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  try {
    const data = await apiFetch('/api/cases');
    const cases = data?.cases || [];
    if (!cases.length) {
      target.innerHTML = `<div class="empty-state"><div class="empty-emoji">📦</div><div class="empty-title">Пока нет кейсов</div><div class="empty-sub">Загляни позже или попроси админа добавить.</div></div>`;
      return;
    }
    const cardsHtml = cases.map(caseCardHtml).join('');
    // On the cases page we already have a grid container; inject cards directly.
    // On the home page we wrap into a dedicated grid for consistent sizing.
    if (targetId === 'cases-page') {
      target.innerHTML = cardsHtml;
    } else {
      target.innerHTML = `<div class="cases-grid">${cardsHtml}</div>`;
    }
  } catch (err) {
    target.innerHTML = `<div class="empty-state"><div class="empty-emoji">⚠️</div><div class="empty-title">Не удалось загрузить кейсы</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

/* ----------------------------- Case opening spinner ----------------------------- */

function showSpinnerReel(prizeName, display = null) {
  const reel = document.getElementById('spinner-reel');
  const result = document.getElementById('spinner-result');
  if (!reel || !result) return Promise.resolve();

  const namesBase = (() => {
    if (window.__currentCasePrizes && window.__currentCasePrizes.size > 0) {
      return Array.from(window.__currentCasePrizes.keys());
    }
    if (Array.isArray(display) && display.length) return display.filter(Boolean);
    return [prizeName];
  })();
  const sequence = [];
  while (sequence.length < 16) sequence.push(...namesBase);
  sequence.splice(16); // ensure length 16
  const prizeIndex = 12;
  sequence[prizeIndex] = prizeName;
  const html = sequence.map((name) => {
    const emoji = window.__currentCasePrizes ? (window.__currentCasePrizes.get(name) || '') : '';
    const isUrl = /^https?:\/\//i.test(emoji || '');
    const emojiHtml = emoji
      ? (isUrl ? `<span class="reel-item__emoji"><img class="reel-item__emoji-img" src="${emoji}" alt="" referrerpolicy="no-referrer"></span>` : `<span class="reel-item__emoji">${emoji}</span>`)
      : '';
    return `<div class="reel-item">${emojiHtml}<span class="reel-item__name">${name}</span></div>`;
  }).join('');
  reel.innerHTML = html;

  // animate translateX to stop at the prize in the center
  reel.classList.remove('spin');
  // force reflow
  void reel.offsetWidth;
  reel.classList.add('spin');

  const itemEl = reel.querySelector('.reel-item');
  const itemW = itemEl ? itemEl.offsetWidth : 140;
  const track = document.querySelector('.spinner-track');
  const trackW = track ? track.clientWidth : (itemW * 4);
  const offset = (prizeIndex * itemW) - Math.round(trackW / 2) + Math.round(itemW / 2);

  reel.style.setProperty('--spin-offset', `${offset}px`);
  result.innerHTML = '';

  lockSpinnerModal(true);
  return new Promise((resolve) => {
    setTimeout(() => {
      const emoji = (window.__lastPrize && window.__lastPrize.emoji) || '';
      const isUrl = /^https?:\/\//i.test(emoji || '');
      const emojiHtml = emoji
        ? (isUrl ? `<img class="win-emoji-img" src="${emoji}" alt="" referrerpolicy="no-referrer">` : `<div class="win-emoji">${emoji}</div>`)
        : `<div class="win-emoji">🎉</div>`;
      result.innerHTML = `<div class="win-card">${emojiHtml}<div><div class="win-title">Выпало:</div><div class="win-name">${prizeName}</div></div></div>`;
      lockSpinnerModal(false);
      setTimeout(() => {
        const modal = document.getElementById('case-spinner');
        if (modal && modal.classList.contains('open') && window.__currentCaseName) {
          prepareOpenCase(window.__currentCaseName);
        }
      }, 1500);
      resolve();
    }, 5400);
  });
}

function startInfiniteSpinner() {
  const reel = document.getElementById('spinner-reel');
  const result = document.getElementById('spinner-result');
  if (!reel || !result) return;
  let base = Array.from({ length: 16 }, (_, i) => String(i + 1));
  reel.innerHTML = base.map((x) => `<div class="reel-item">${x}</div>`).join('');
  reel.style.setProperty('--spin-offset', `1120px`);
  window.__spinInfiniteStop && window.__spinInfiniteStop();
  let stopped = false;
  function loop() {
    if (stopped) return;
    reel.classList.remove('spin');
    void reel.offsetWidth;
    reel.classList.add('spin');
    window.__spinInfiniteTimer = setTimeout(loop, 5400);
  }
  loop();
  window.__spinInfiniteStop = () => {
    stopped = true;
    clearTimeout(window.__spinInfiniteTimer);
    reel.classList.remove('spin');
  };
}

function stopInfiniteSpinner() {
  if (window.__spinInfiniteStop) {
    try { window.__spinInfiniteStop(); } catch {}
    window.__spinInfiniteStop = null;
  }
}

async function handleOpenCase(name) {
  const modalId = 'case-spinner';
  if (window.__openingCase) return;
  try {
    window.__openingCase = true;
    openModal(modalId);
    stopInfiniteSpinner();
    const data = await apiFetch('/api/cases/open', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    window.__lastPrize = data?.prize || null;
    const prizeName = (window.__lastPrize && window.__lastPrize.name) || 'Приз';
    const display = data?.display || null;
    await showSpinnerReel(prizeName, display);

    // Refresh cases (home and cases page)
    await loadCases('cases-list');
    await loadCases('cases-page');
    await refreshUserInfo();
  } catch (err) {
    const result = document.getElementById('spinner-result');
    if (result) {
      const msg = err?.message || 'Что-то пошло не так';
      let title = 'Ошибка';
      let hint = '';
      if (msg === 'User case limit reached') {
        title = 'Лимит по этому кейсу исчерпан';
        hint = 'Ты уже открыл этот кейс максимальное количество раз.';
      } else if (msg === 'Case total limit reached') {
        title = 'Кейс временно недоступен';
        hint = 'Общий лимит открытий по этому кейсу достигнут.';
      } else if (msg === 'Insufficient balance') {
        title = 'Не хватает баланса';
        hint = 'Попробуй пополнить баланс или выбери более дешёвый кейс.';
      } else if (msg === 'Insufficient level') {
        title = 'Недостаточный уровень';
        hint = 'Твой уровень ниже требуемого для этого кейса.';
      }
      result.innerHTML = `
        <div class="case-error">
          <div class="case-error__icon"><span class="material-icons-round">warning</span></div>
          <div class="case-error__body">
            <div class="case-error__title">${title}</div>
            <div class="case-error__text">${hint || msg}</div>
          </div>
        </div>
      `;
    }
  } finally {
    window.__openingCase = false;
  }
}

async function refreshUserInfo() {
  try {
    const data = await apiFetch('/api/me');
    const u = data?.user || {};
    const balEl = document.getElementById('nav-balance');
    if (balEl && typeof u.balance === 'number') {
      balEl.textContent = (u.balance || 0).toLocaleString('ru-RU');
    }
    const openedEl = document.getElementById('hero-opened-count');
    if (openedEl && typeof u.openedCasesCount === 'number') {
      openedEl.textContent = u.openedCasesCount || 0;
    }
    if (Array.isArray(data?.prizes)) {
      const st = window.__profilePrizes;
      if (st) {
        st.list = data.prizes;
        renderProfilePrizes();
      }
    }
  } catch {}
}
async function prepareOpenCase(name) {
  const modalId = 'case-spinner';
  window.__currentCaseName = name;
  openModal(modalId);
  try {
    const data = await apiFetch('/api/cases');
    const item = (data?.cases || []).find((c) => c.name === name);
    const map = new Map();
    (item?.prizesBrief || []).forEach((p) => {
      if (p?.name) map.set(p.name, p.emoji || '');
    });
    window.__currentCasePrizes = map;
  } catch {
    window.__currentCasePrizes = new Map();
  }
  const result = document.getElementById('spinner-result');
  if (result) {
    result.innerHTML = `
      <div class="case-error">
        <div class="case-error__icon"><span class="material-icons-round">info</span></div>
        <div class="case-error__body">
          <div class="case-error__title">Готов к открытию</div>
          <div class="case-error__text">Нажми кнопку ниже, чтобы открыть кейс.</div>
        </div>
      </div>
      <div class="mt-3">
        <button class="btn btn-primary btn-pill" data-open-now="${name}">
          <i class="bi bi-play-fill"></i><span>Открыть сейчас</span>
        </button>
      </div>
    `;
  }
  const reel = document.getElementById('spinner-reel');
  if (reel) {
    reel.classList.remove('spin');
    reel.innerHTML = '';
    reel.style.removeProperty('--spin-offset');
  }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-open-now]');
  if (!t) return;
  const name = t.getAttribute('data-open-now');
  if (!name) return;
  await handleOpenCase(name);
});
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action],[data-open-case]');
  if (!t) return;

  if (t.dataset.action === 'refresh-cases') {
    await loadCases('cases-list');
    await loadCases('cases-page');
    return;
  }

  if (t.dataset.action === 'open-profile') {
    await showProfileDetail();
    return;
  }

  if (t.dataset.openCase) {
    await prepareOpenCase(t.dataset.openCase);
    return;
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('#open-mobile-nav');
  if (!btn) return;
  openModal('mobile-nav');
});

(async function boot() {
  await loadCases('cases-list');
  await loadCases('cases-page');
  initBoxParticles();
  setInterval(() => { refreshUserInfo().catch(() => {}); }, 2000);
})();

async function showProfileDetail() {
  const detail = document.getElementById('profile-detail');
  if (!detail) return;
  const data = await apiFetch('/api/me');
  const u = data.user;
  window.__profilePrizes = { list: data.prizes || [], page: 1, pageSize: 5 };
  const created = u.createdAt ? new Date(u.createdAt).toLocaleString('ru-RU') : '—';
  const avatar = u.avatarUrl
    ? `<img class="user-detail__avatar" src="${u.avatarUrl}" alt="${u.username}" referrerpolicy="no-referrer">`
    : `<div class="user-detail__avatar user-avatar--placeholder"></div>`;
  detail.innerHTML = `
    <div class="modal-head">
      <div class="modal-title">
        <div class="modal-title__icon">
          <span class="material-icons-round">person</span>
        </div>
        <div>
          <h2 class="mb-0">Профиль</h2>
          <p class="text-muted small mb-0">${u.username}</p>
        </div>
      </div>
    </div>
    <div class="user-detail">
      <div class="user-detail__main">
        <div class="user-detail__top">
          <div class="user-detail__title">
            <h2 class="mb-1">${u.username}</h2>
            <div class="muted">ID: ${u.discordId}</div>
            <div class="muted">Дата регистрации: ${created}</div>
          </div>
          ${avatar}
        </div>
        <div class="user-detail__stats">
          <div class="stat-mini"><span class="muted">Уровень</span><b>${u.level || '-'}</b></div>
          <div class="stat-mini"><span class="muted">Баланс</span><b>${(u.balance ?? 0).toLocaleString('ru-RU')}</b></div>
        </div>
      </div>
      <div class="prizes-box">
        <div class="prizes-head">
          <h3 class="mb-0">🏆 Мои призы</h3>
          <div class="muted small">${(window.__profilePrizes.list.length || 0) ? `Всего: ${window.__profilePrizes.list.length}` : 'Пока пусто'}</div>
        </div>
        <div id="profile-prizes"></div>
      </div>
    </div>
  `;
  openModal('profile-modal');
  renderProfilePrizes();
}

function initBoxParticles() {
  const layer = document.getElementById('particle-layer');
  if (!layer) return;
  const count = 24;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'particle-box';
    el.style.left = `${Math.floor(Math.random() * 100)}vw`;
    el.style.animationDuration = `${6 + Math.random() * 6}s`;
    el.style.animationDelay = `${Math.random() * 5}s`;
    el.style.setProperty('--drift', `${-60 + Math.random() * 120}px`);
    el.innerHTML = `<span class="material-icons-round">inventory_2</span>`;
    layer.appendChild(el);
  }
  setInterval(() => {
    const el = document.createElement('div');
    el.className = 'particle-box';
    el.style.left = `${Math.floor(Math.random() * 100)}vw`;
    el.style.animationDuration = `${6 + Math.random() * 6}s`;
    el.style.animationDelay = `0s`;
    el.style.setProperty('--drift', `${-60 + Math.random() * 120}px`);
    el.innerHTML = `<span class="material-icons-round">inventory_2</span>`;
    layer.appendChild(el);
    setTimeout(() => { el.remove(); }, 12000);
  }, 800);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-prof-prev],[data-prof-next]');
  if (!t) return;
  const st = window.__profilePrizes;
  if (!st) return;
  if (t.dataset.profPrev) st.page -= 1;
  if (t.dataset.profNext) st.page += 1;
  renderProfilePrizes();
});

function renderProfilePrizes() {
  const st = window.__profilePrizes;
  const box = document.getElementById('profile-prizes');
  if (!st || !box) return;
  const totalPages = Math.max(1, Math.ceil(st.list.length / st.pageSize));
  const safePage = Math.min(Math.max(1, st.page), totalPages);
  st.page = safePage;
  const start = (safePage - 1) * st.pageSize;
  const slice = st.list.slice(start, start + st.pageSize);
  const body = slice.length
    ? slice.map(p => {
        const when = p.createdAt ? new Date(p.createdAt).toLocaleString('ru-RU') : '';
        const title = p.caseName ? `${p.caseName} — ${p.prize}` : p.prize;
        return `<div class="prize-row"><div class="prize-left"><div class="prize-title">${title}</div><div class="prize-sub muted">${when}</div></div><div class="prize-right">${p.confirmedAt ? '<span class="status-pill status-pill--ok">Выдан</span>' : '<span class="status-pill">Не выдан</span>'}</div></div>`;
      }).join('')
    : `<div class="empty-inline">Пока призов нет.</div>`;
  const pager = `
    <div class="flex items-center justify-end gap-2 mt-2">
      <button class="btn btn-secondary btn-pill" data-prof-prev="1" ${safePage <= 1 ? 'disabled' : ''}><span class="material-icons-round">chevron_left</span></button>
      <div class="muted">Стр. ${safePage} / ${totalPages}</div>
      <button class="btn btn-secondary btn-pill" data-prof-next="1" ${safePage >= totalPages ? 'disabled' : ''}><span class="material-icons-round">chevron_right</span></button>
    </div>
  `;
  box.innerHTML = body + pager;
}

/* ----------------------------- Spinner modal helpers ----------------------------- */

function lockSpinnerModal(lock) {
  window.__spinnerLocked = !!lock;
  const btns = document.querySelectorAll('#case-spinner [data-close]');
  btns.forEach((btn) => {
    try { btn.disabled = !!lock; } catch {}
  });
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#show-prizes,#spinner-prizes-btn');
  if (!btn) return;
  const name = window.__currentCaseName;
  if (!name) return;
  try {
    const data = await apiFetch('/api/cases');
    const item = data?.cases?.find((c) => c.name === name);
    const panel = document.getElementById('spinner-prizes-panel');
    if (item && panel) {
      const prizes = Array.isArray(item.prizesBrief) ? item.prizesBrief : [];
      const prizeHtml = prizes.length
        ? prizes.map((p) => {
            const r = (p.rarity || '').toLowerCase();
            const cls =
              r.includes('леген') ? 'rarity-legendary' :
              r.includes('миф') ? 'rarity-mythic' :
              r.includes('эп') ? 'rarity-epic' :
              r.includes('ред') ? 'rarity-rare' : 'rarity-rare';
            const emoji = p.emoji || '';
            const isUrl = /^https?:\/\//i.test(emoji || '');
            const emojiHtml = emoji
              ? (isUrl ? `<img class="prize-emoji-img" src="${emoji}" alt="" referrerpolicy="no-referrer">` : `<span class="prize-emoji">${emoji}</span>`)
              : '';
            return `<div class="case-prize ${cls}">${emojiHtml}<span class="prize-name">${p.name}</span></div>`;
          }).join('')
        : `<div class="empty-inline">Пока призов нет.</div>`;
      panel.innerHTML = `
        <div class="prizes-box">
          <div class="prizes-head">
            <h3 class="mb-0">🎁 Призы кейса</h3>
            <div class="muted small">${prizes.length ? `Всего: ${prizes.length}` : ''}</div>
          </div>
          <div class="prizes-list-inline">${prizeHtml}</div>
        </div>
      `;
      panel.classList.toggle('hidden');
    }
  } catch {}
});
