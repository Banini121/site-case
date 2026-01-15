import { apiFetch, formatNum, openModal } from './shared.js';

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
            ${item.minLevel ? `<span class="chip">Мин. уровень: ${item.minLevel}</span>` : ''}
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
    target.innerHTML = cases.length
      ? `<div class="cases-grid">${cases.map(caseCardHtml).join('')}</div>`
      : `<div class="empty-state"><div class="empty-emoji">📦</div><div class="empty-title">Пока нет кейсов</div><div class="empty-sub">Загляни позже или попроси админа добавить.</div></div>`;
  } catch (err) {
    target.innerHTML = `<div class="empty-state"><div class="empty-emoji">⚠️</div><div class="empty-title">Не удалось загрузить кейсы</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

/* ----------------------------- Case opening spinner ----------------------------- */

function showSpinnerReel(prizeName) {
  const reel = document.getElementById('spinner-reel');
  const result = document.getElementById('spinner-result');
  if (!reel || !result) return Promise.resolve();

  // Build a "slot" sequence
  const fillers = Array.from({ length: 10 }, (_, i) => ({ name: `Предмет ${i + 1}` }));
  const sequence = [...fillers.slice(0, 5), { name: prizeName }, ...fillers.slice(5)];
  reel.innerHTML = sequence.map((x) => `<div class="reel-item">${x.name}</div>`).join('');

  // animate translate
  reel.classList.remove('spin');
  // force reflow
  void reel.offsetWidth;
  reel.classList.add('spin');

  // stop around the prize (middle)
  const prizeIndex = 5;
  const itemH = 56; // must match CSS
  const offset = prizeIndex * itemH;

  reel.style.setProperty('--spin-offset', `${offset}px`);
  result.innerHTML = '';

  return new Promise((resolve) => {
    setTimeout(() => {
      result.innerHTML = `<div class="win-card"><div class="win-emoji">🎉</div><div><div class="win-title">Выпало:</div><div class="win-name">${prizeName}</div></div></div>`;
      resolve();
    }, 2100);
  });
}

async function handleOpenCase(name) {
  const modalId = 'case-spinner';
  try {
    openModal(modalId);
    const data = await apiFetch('/api/cases/open', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    const prizeName = data?.prize?.name || 'Приз';
    await showSpinnerReel(prizeName);

    await loadCases('cases-list');
    await loadCases('cases-page');
  } catch (err) {
    const result = document.getElementById('spinner-result');
    if (result) result.innerHTML = `<div class="alert alert-danger mb-0">${err.message}</div>`;
  }
}

function bindCaseActions() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action],[data-open-case]');
    if (!t) return;

    if (t.dataset.action === 'refresh-cases') {
      await loadCases('cases-list');
      await loadCases('cases-page');
      return;
    }

    if (t.dataset.openCase) {
      await handleOpenCase(t.dataset.openCase);
    }
  });
}

export function initCasesExperience() {
  bindCaseActions();
  loadCases('cases-list');
  loadCases('cases-page');
}
