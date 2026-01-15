import {
  apiFetch,
  closeModal,
  formatNum,
  initLogoutButton,
  initModalDismissHandlers,
  openModal,
} from './shared.js';

/* ----------------------------- Admin: users ----------------------------- */

function userCardHtml(user, mode) {
  const avatar = user.avatarUrl
    ? `<img class="user-avatar" src="${user.avatarUrl}" alt="${user.username}" referrerpolicy="no-referrer" loading="lazy">`
    : `<div class="user-avatar user-avatar--placeholder"></div>`;

  if (mode === 'pending') {
    return `
      <div class="user-card">
        <div class="user-meta">
          ${avatar}
          <div class="user-text">
            <div class="user-name">${user.username}</div>
            <div class="muted">${user.discordId}</div>
          </div>
        </div>
        <div class="user-actions">
          <button class="btn btn-success btn-pill" data-approve-user="${user.discordId}">✅ Подтвердить</button>
          <button class="btn btn-danger btn-pill" data-deny-user="${user.discordId}">⛔ Отклонить</button>
        </div>
      </div>
    `;
  }

  // approved
  const blocked = !!user.blocked;
  return `
    <div class="user-card">
      <div class="user-meta">
        ${avatar}
        <div class="user-text">
          <div class="user-name">${user.username}</div>
          <div class="muted">${user.discordId}</div>
          <div class="muted">${user.level || ''}</div>
        </div>
      </div>
      <div class="user-actions">
        <button class="btn btn-secondary btn-pill" data-user-info="${user.discordId}">ℹ️ Информация</button>
        <button class="btn ${blocked ? 'btn-warning' : 'btn-danger'} btn-pill"
                data-block-user="${user.discordId}"
                data-blocked="${blocked}">
          ${blocked ? '🔓 Разблокировать' : '🚫 Заблокировать'}
        </button>
      </div>
    </div>
  `;
}

function renderEmptyPending() {
  return `
    <div class="empty-state empty-state--small">
      <div class="empty-emoji">✨</div>
      <div class="empty-title">Пока никто не ждёт подтверждения</div>
      <div class="empty-sub">Если кто-то зайдёт — он появится здесь автоматически.</div>
    </div>
  `;
}

async function loadUsers() {
  const approvedEl = document.getElementById('approved-users');
  const pendingEl = document.getElementById('pending-users');
  if (!approvedEl || !pendingEl) return;

  const data = await apiFetch('/api/admin/users');
  const approved = data?.approved || [];
  const pending = data?.pending || [];

  approvedEl.innerHTML = approved.length ? approved.map(u => userCardHtml(u, 'approved')).join('') :
    `<div class="empty-state empty-state--small"><div class="empty-emoji">👥</div><div class="empty-title">Нет подтверждённых пользователей</div></div>`;

  pendingEl.innerHTML = pending.length ? pending.map(u => userCardHtml(u, 'pending')).join('') : renderEmptyPending();
}

function badgeStatus(ok) {
  return ok
    ? `<span class="status-pill status-pill--ok">Выдан</span>`
    : `<span class="status-pill">Не выдан</span>`;
}

function prizeRowHtml(prize, userId) {
  const ok = !!prize.confirmedAt;
  const when = prize.createdAt ? new Date(prize.createdAt).toLocaleString('ru-RU') : '';
  const title = prize.caseName ? `${prize.caseName} — ${prize.prize}` : prize.prize;

  return `
    <div class="prize-row">
      <div class="prize-left">
        <div class="prize-title">${title}</div>
        <div class="prize-sub muted">${when}</div>
      </div>
      <div class="prize-right">
        ${badgeStatus(ok)}
        <button class="btn btn-sm ${ok ? 'btn-success' : 'btn-secondary'} btn-pill"
                data-confirm-prize="${userId}"
                data-case-name="${prize.caseName || ''}"
                data-prize="${prize.prize || ''}"
                ${ok ? 'disabled' : ''}>
          ${ok ? '✅ Выдано' : '✔ Приз выдан'}
        </button>
      </div>
    </div>
  `;
}

async function showUserDetail(userId) {
  const detail = document.getElementById('user-detail');
  if (!detail) return;

  const data = await apiFetch(`/api/admin/users/${userId}`);
  const u = data.user;
  const prizes = data.prizes || [];

  const avatar = u.avatarUrl
    ? `<img class="user-detail__avatar" src="${u.avatarUrl}" alt="${u.username}" referrerpolicy="no-referrer">`
    : `<div class="user-detail__avatar user-avatar--placeholder"></div>`;

  detail.innerHTML = `
    <div class="user-detail">
      <div class="user-detail__main">
        <div class="user-detail__top">
          <div class="user-detail__title">
            <h2 class="mb-1">${u.username}</h2>
            <div class="muted">ID: ${u.discordId}</div>
          </div>
          ${avatar}
        </div>

        <div class="user-detail__stats">
          <div class="stat-mini"><span class="muted">Уровень</span><b>${u.level || '-'}</b></div>
          <div class="stat-mini"><span class="muted">Баланс</span><b>${formatNum(u.balance)}</b></div>
        </div>

        <div class="user-detail__controls">
          <div class="level-line">
            <button class="btn btn-secondary btn-pill" data-set-level="${u.discordId}">✨ Изменить уровень</button>
            <div class="level-hint muted">leadership / dev / user</div>
          </div>

          <div class="balance-line">
            <input class="form-control" type="number" id="balance-delta" placeholder="+100 / -100" />
            <button class="btn btn-primary btn-pill" data-apply-balance="${u.discordId}">Применить</button>
          </div>
        </div>
      </div>

      <div class="prizes-box">
        <div class="prizes-head">
          <h3 class="mb-0">🏆 Выигранные призы</h3>
          <div class="muted small">${prizes.length ? `Всего: ${prizes.length}` : 'Пока пусто'}</div>
        </div>
        <div class="prizes-list">
          ${prizes.length ? prizes.map(p => prizeRowHtml(p, u.discordId)).join('') : `<div class="empty-inline">Пока призов нет.</div>`}
        </div>
      </div>
    </div>
  `;

  openModal('user-detail-modal');
}

/* ----------------------------- Admin: cases ----------------------------- */

function adminCaseCardHtml(item) {
  const img = item.imageUrl
    ? `<img class="admin-case__img" src="${item.imageUrl}" alt="${item.name}" referrerpolicy="no-referrer" loading="lazy">`
    : `<div class="admin-case__img admin-case__img--placeholder"></div>`;

  return `
    <div class="admin-case ${item.disabled ? 'is-disabled' : ''}">
      <div class="admin-case__media">
        ${img}
        <div class="admin-case__name">${item.name}</div>
      </div>

      <div class="admin-case__body">
        <div class="admin-case__meta">
          <span class="meta">Цена: <b>${formatNum(item.price)}</b></span>
          <span class="meta">Мин. уровень: <b>${item.minLevel}</b></span>
          <span class="meta">Лимит/юзер: <b>${formatNum(item.maxPerUser)}</b></span>
          <span class="meta">Общий лимит: <b>${formatNum(item.maxTotal)}</b></span>
        </div>

        <div class="admin-case__actions">
          <button class="btn btn-secondary btn-pill" data-edit-case="${item.name}">Редактировать</button>
          <button class="btn btn-danger btn-pill" data-delete-case="${item.name}">Удалить</button>
        </div>
      </div>
    </div>
  `;
}

async function loadAdminCases() {
  const container = document.getElementById('cases-admin-list');
  if (!container) return;

  const data = await apiFetch('/api/admin/cases');
  const cases = data?.cases || [];

  container.innerHTML = cases.length
    ? cases.map(adminCaseCardHtml).join('')
    : `<div class="empty-state empty-state--small"><div class="empty-emoji">📦</div><div class="empty-title">Нет кейсов</div></div>`;
}

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('[data-tab-panel]').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab));
}

/* ----------------------------- Case editor (admin) ----------------------------- */

function createPrizeFieldRow(prize = {}) {
  const row = document.createElement('div');
  row.className = 'prize-row-edit';

  row.innerHTML = `
    <input class="form-control" name="prizeName" placeholder="Название" value="${prize.name || ''}">
    <input class="form-control" name="prizeCount" type="number" placeholder="Кол-во" value="${prize.count ?? ''}">
    <input class="form-control" name="prizeRarity" placeholder="Редкость" value="${prize.rarity || ''}">
    <input class="form-control" name="prizeEmoji" placeholder="URL/эмодзи" value="${prize.emoji || ''}">
    <button type="button" class="btn btn-danger btn-icon" data-remove-prize>×</button>
  `;
  return row;
}

function openCaseEditor(item = null) {
  const modal = document.getElementById('case-editor-modal');
  const form = document.getElementById('case-form');
  const fields = document.getElementById('prize-fields');
  const title = document.getElementById('case-editor-title');
  if (!modal || !form || !fields || !title) return;

  // reset
  form.reset();
  fields.innerHTML = '';

  const isNew = !item;
  title.textContent = isNew ? 'Новый кейс' : `Кейс: ${item.name}`;

  // fill base fields
  form.elements.name.value = item?.name || '';
  form.elements.price.value = item?.price ?? '';
  form.elements.minLevel.value = item?.minLevel || '';
  form.elements.maxPerUser.value = item?.maxPerUser ?? '';
  form.elements.maxTotal.value = item?.maxTotal ?? '';
  form.elements.imageUrl.value = item?.imageUrl || '';
  form.elements.disabled.checked = !!item?.disabled;

  // prizes
  const prizes = item?.prizes || [];
  prizes.forEach(p => fields.appendChild(createPrizeFieldRow(p)));
  if (!prizes.length) fields.appendChild(createPrizeFieldRow({}));

  form.dataset.mode = isNew ? 'create' : 'update';
  form.dataset.originalName = item?.name || '';

  openModal('case-editor-modal');
}

function bindAdminActions() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-modal],[data-tab],[data-approve-user],[data-deny-user],[data-user-info],[data-block-user],[data-confirm-prize],[data-edit-case],[data-delete-case],[data-set-level],[data-apply-balance]');
    if (!t) return;

    // open modal tiles
    if (t.dataset.modal) {
      openModal(t.dataset.modal);
      if (t.dataset.modal === 'users-modal') await loadUsers();
      if (t.dataset.modal === 'cases-modal') await loadAdminCases();
      return;
    }

    // tabs (users modal)
    if (t.dataset.tab) {
      setActiveTab(t.dataset.tab);
      return;
    }

    // approve / deny
    if (t.dataset.approveUser) {
      await apiFetch(`/api/admin/users/${t.dataset.approveUser}/decision`, {
        method: 'POST',
        body: JSON.stringify({ approved: true }),
      });
      await loadUsers();
      return;
    }
    if (t.dataset.denyUser) {
      await apiFetch(`/api/admin/users/${t.dataset.denyUser}/decision`, {
        method: 'POST',
        body: JSON.stringify({ approved: false }),
      });
      await loadUsers();
      return;
    }

    // user info
    if (t.dataset.userInfo) {
      await showUserDetail(t.dataset.userInfo);
      return;
    }

    // block / unblock
    if (t.dataset.blockUser) {
      const blocked = t.getAttribute('data-blocked') === 'true';
      await apiFetch(`/api/admin/users/${t.dataset.blockUser}/block`, {
        method: 'POST',
        body: JSON.stringify({ blocked: !blocked }),
      });
      await loadUsers();
      return;
    }

    // confirm prize
    if (t.dataset.confirmPrize) {
      await apiFetch(`/api/admin/users/${t.dataset.confirmPrize}/prize/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          caseName: t.dataset.caseName,
          prize: t.dataset.prize,
        }),
      });
      await showUserDetail(t.dataset.confirmPrize);
      return;
    }

    // edit / delete case
    if (t.dataset.deleteCase) {
      const name = t.dataset.deleteCase;
      if (!confirm(`Удалить кейс "${name}"?`)) return;
      await apiFetch('/api/admin/case', {
        method: 'DELETE',
        body: JSON.stringify({ name }),
      });
      await loadAdminCases();
      return;
    }

    if (t.dataset.editCase) {
      const all = await apiFetch('/api/admin/cases');
      const item = (all?.cases || []).find(c => c.name === t.dataset.editCase);
      if (!item) return;
      openCaseEditor(item);
      return;
    }

    // set level (prompt)
    if (t.dataset.setLevel) {
      const lvl = prompt('Новый уровень (например: user / dev / leadership):');
      if (!lvl) return;
      await apiFetch(`/api/admin/users/${t.dataset.setLevel}/level`, {
        method: 'POST',
        body: JSON.stringify({ level: lvl }),
      });
      await showUserDetail(t.dataset.setLevel);
      return;
    }

    // apply balance
    if (t.dataset.applyBalance) {
      const input = document.getElementById('balance-delta');
      const delta = Number(input?.value || 0);
      if (!delta || Number.isNaN(delta)) return;
      await apiFetch(`/api/admin/users/${t.dataset.applyBalance}/balance`, {
        method: 'POST',
        body: JSON.stringify({ delta }),
      });
      if (input) input.value = '';
      await showUserDetail(t.dataset.applyBalance);
    }
  });
}

function bindCaseEditorActions() {
  const createCaseBtn = document.getElementById('create-case');
  if (createCaseBtn) {
    createCaseBtn.addEventListener('click', () => openCaseEditor(null));
  }

  const addPrizeBtn = document.getElementById('add-prize');
  if (addPrizeBtn) {
    addPrizeBtn.addEventListener('click', () => {
      const fields = document.getElementById('prize-fields');
      if (fields) fields.appendChild(createPrizeFieldRow({}));
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-prize]');
    if (!btn) return;
    const row = btn.closest('.prize-row-edit');
    if (row) row.remove();
  });

  const caseForm = document.getElementById('case-form');
  if (caseForm) {
    caseForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const form = e.currentTarget;
      const fields = document.getElementById('prize-fields');
      const mode = form.dataset.mode || 'create';
      const originalName = form.dataset.originalName || '';

      const prizes = [];
      if (fields) {
        fields.querySelectorAll('.prize-row-edit').forEach((row) => {
          const name = row.querySelector('[name="prizeName"]')?.value?.trim();
          const count = Number(row.querySelector('[name="prizeCount"]')?.value || 0);
          const rarity = row.querySelector('[name="prizeRarity"]')?.value?.trim();
          const emoji = row.querySelector('[name="prizeEmoji"]')?.value?.trim();
          if (name) prizes.push({ name, count, rarity, emoji });
        });
      }

      const payload = {
        mode,
        originalName,
        name: form.elements.name.value.trim(),
        price: Number(form.elements.price.value),
        minLevel: form.elements.minLevel.value.trim(),
        maxPerUser: Number(form.elements.maxPerUser.value),
        maxTotal: Number(form.elements.maxTotal.value),
        imageUrl: form.elements.imageUrl.value.trim(),
        disabled: !!form.elements.disabled.checked,
        prizes,
      };

      await apiFetch('/api/admin/case', { method: 'POST', body: JSON.stringify(payload) });
      closeModal(document.getElementById('case-editor-modal'));
      await loadAdminCases();
    });
  }

  const closeCaseEditor = document.getElementById('close-case-editor');
  if (closeCaseEditor) {
    closeCaseEditor.addEventListener('click', () => closeModal(document.getElementById('case-editor-modal')));
  }
}

initModalDismissHandlers();
initLogoutButton();
bindAdminActions();
bindCaseEditorActions();
