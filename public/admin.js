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
  window.__usersState = window.__usersState || { approved: [], pending: [], approvedPage: 1, pendingPage: 1, pageSize: 5, query: '' };
  window.__usersState.approved = data?.approved || [];
  window.__usersState.pending = data?.pending || [];
  renderUsersList('approved');
  renderUsersList('pending');
}

function renderUsersList(mode) {
  const st = window.__usersState || { approved: [], pending: [], approvedPage: 1, pendingPage: 1, pageSize: 5, query: '' };
  const list = mode === 'approved' ? st.approved : st.pending;
  const page = mode === 'approved' ? st.approvedPage : st.pendingPage;
  const container = document.getElementById(mode === 'approved' ? 'approved-users' : 'pending-users');
  if (!container) return;
  const q = (st.query || '').toLowerCase();
  const filtered = q ? list.filter(u => (u.username || '').toLowerCase().includes(q) || (u.discordId || '').toLowerCase().includes(q)) : list;
  const totalPages = Math.max(1, Math.ceil(filtered.length / st.pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  if (mode === 'approved') st.approvedPage = safePage; else st.pendingPage = safePage;
  const start = (safePage - 1) * st.pageSize;
  const slice = filtered.slice(start, start + st.pageSize);
  const body = slice.length
    ? slice.map(u => userCardHtml(u, mode)).join('')
    : (mode === 'approved'
      ? `<div class="empty-state empty-state--small"><div class="empty-emoji">👥</div><div class="empty-title">Нет подтверждённых пользователей</div></div>`
      : renderEmptyPending());
  const pager = `
    <div class="flex items-center justify-end gap-2 mt-2">
      <button class="btn btn-secondary btn-pill" data-users-prev="${mode}" ${safePage <= 1 ? 'disabled' : ''}>
        <span class="material-icons-round">chevron_left</span>
      </button>
      <div class="muted">Стр. ${safePage} / ${totalPages}</div>
      <button class="btn btn-secondary btn-pill" data-users-next="${mode}" ${safePage >= totalPages ? 'disabled' : ''}>
        <span class="material-icons-round">chevron_right</span>
      </button>
    </div>
  `;
  container.innerHTML = body + pager;
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
  window.__userPrizesState = { list: data.prizes || [], page: 1, pageSize: 5, userId };

  const avatar = u.avatarUrl
    ? `<img class="user-detail__avatar" src="${u.avatarUrl}" alt="${u.username}" referrerpolicy="no-referrer">`
    : `<div class="user-detail__avatar user-avatar--placeholder"></div>`;

  function renderPrizesBox() {
    const st = window.__userPrizesState;
    const totalPages = Math.max(1, Math.ceil(st.list.length / st.pageSize));
    const safePage = Math.min(Math.max(1, st.page), totalPages);
    st.page = safePage;
    const start = (safePage - 1) * st.pageSize;
    const slice = st.list.slice(start, start + st.pageSize);
    const body = slice.length ? slice.map(p => prizeRowHtml(p, st.userId)).join('') : `<div class="empty-inline">Пока призов нет.</div>`;
    const pager = `
      <div class="flex items-center justify-end gap-2 mt-2">
        <button class="btn btn-secondary btn-pill" data-prizes-prev="1" ${safePage <= 1 ? 'disabled' : ''}><span class="material-icons-round">chevron_left</span></button>
        <div class="muted">Стр. ${safePage} / ${totalPages}</div>
        <button class="btn btn-secondary btn-pill" data-prizes-next="1" ${safePage >= totalPages ? 'disabled' : ''}><span class="material-icons-round">chevron_right</span></button>
      </div>
    `;
    return `
      <div class="prizes-box" id="prizes-box">
        <div class="prizes-head">
          <h3 class="mb-0">🏆 Выигранные призы</h3>
          <div class="muted small">${st.list.length ? `Всего: ${st.list.length}` : 'Пока пусто'}</div>
        </div>
        <div class="prizes-list">
          ${body}
        </div>
        ${pager}
      </div>
    `;
  }

  detail.innerHTML = `
    <div class="modal-head">
      <div class="modal-title">
        <div class="modal-title__icon">
          <span class="material-icons-round">person</span>
        </div>
        <div>
          <h2 class="mb-0">Пользователь</h2>
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

      ${renderPrizesBox()}
    </div>
  `;

  openModal('user-detail-modal');
}

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
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('[data-tab-panel]').forEach(p => {
    p.classList.toggle('active', p.dataset.tabPanel === tab);
  });
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-modal],[data-tab],[data-approve-user],[data-deny-user],[data-user-info],[data-block-user],[data-confirm-prize],[data-edit-case],[data-delete-case],[data-set-level],[data-apply-balance],[data-users-prev],[data-users-next],[data-prizes-prev],[data-prizes-next]');
  if (!t) return;

  if (t.dataset.modal) {
    openModal(t.dataset.modal);
    if (t.dataset.modal === 'users-modal') await loadUsers();
    if (t.dataset.modal === 'cases-modal') await loadAdminCases();
    return;
  }

  if (t.dataset.tab) {
    setActiveTab(t.dataset.tab);
    return;
  }

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

  if (t.dataset.userInfo) {
    await showUserDetail(t.dataset.userInfo);
    return;
  }

  if (t.dataset.blockUser) {
    const blocked = t.getAttribute('data-blocked') === 'true';
    await apiFetch(`/api/admin/users/${t.dataset.blockUser}/block`, {
      method: 'POST',
      body: JSON.stringify({ blocked: !blocked }),
    });
    await loadUsers();
    return;
  }

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
    return;
  }

  if (t.dataset.usersPrev) {
    const st = window.__usersState || { approvedPage: 1, pendingPage: 1 };
    if (t.dataset.usersPrev === 'approved') st.approvedPage -= 1; else st.pendingPage -= 1;
    renderUsersList(t.dataset.usersPrev);
    return;
  }

  if (t.dataset.usersNext) {
    const st = window.__usersState || { approvedPage: 1, pendingPage: 1 };
    if (t.dataset.usersNext === 'approved') st.approvedPage += 1; else st.pendingPage += 1;
    renderUsersList(t.dataset.usersNext);
    return;
  }

  if (t.dataset.prizesPrev) {
    const st = window.__userPrizesState;
    if (st) {
      st.page -= 1;
      const box = document.getElementById('prizes-box');
      if (box) {
        // Re-render only prizes box
        const detail = document.getElementById('user-detail');
        if (detail) {
          const html = (function () {
            const totalPages = Math.max(1, Math.ceil(st.list.length / st.pageSize));
            const safePage = Math.min(Math.max(1, st.page), totalPages);
            st.page = safePage;
            const start = (safePage - 1) * st.pageSize;
            const slice = st.list.slice(start, start + st.pageSize);
            const body = slice.length ? slice.map(p => prizeRowHtml(p, st.userId)).join('') : `<div class="empty-inline">Пока призов нет.</div>`;
            const pager = `
              <div class="flex items-center justify-end gap-2 mt-2">
                <button class="btn btn-secondary btn-pill" data-prizes-prev="1" ${safePage <= 1 ? 'disabled' : ''}><span class="material-icons-round">chevron_left</span></button>
                <div class="muted">Стр. ${safePage} / ${totalPages}</div>
                <button class="btn btn-secondary btn-pill" data-prizes-next="1" ${safePage >= totalPages ? 'disabled' : ''}><span class="material-icons-round">chevron_right</span></button>
              </div>
            `;
            return `
              <div class="prizes-head">
                <h3 class="mb-0">🏆 Выигранные призы</h3>
                <div class="muted small">${st.list.length ? `Всего: ${st.list.length}` : 'Пока пусто'}</div>
              </div>
              <div class="prizes-list">
                ${body}
              </div>
              ${pager}
            `;
          })();
          box.innerHTML = html;
        }
      }
    }
    return;
  }

  if (t.dataset.prizesNext) {
    const st = window.__userPrizesState;
    if (st) {
      st.page += 1;
      const box = document.getElementById('prizes-box');
      if (box) {
        const detail = document.getElementById('user-detail');
        if (detail) {
          const html = (function () {
            const totalPages = Math.max(1, Math.ceil(st.list.length / st.pageSize));
            const safePage = Math.min(Math.max(1, st.page), totalPages);
            st.page = safePage;
            const start = (safePage - 1) * st.pageSize;
            const slice = st.list.slice(start, start + st.pageSize);
            const body = slice.length ? slice.map(p => prizeRowHtml(p, st.userId)).join('') : `<div class="empty-inline">Пока призов нет.</div>`;
            const pager = `
              <div class="flex items-center justify-end gap-2 mt-2">
                <button class="btn btn-secondary btn-pill" data-prizes-prev="1" ${safePage <= 1 ? 'disabled' : ''}><span class="material-icons-round">chevron_left</span></button>
                <div class="muted">Стр. ${safePage} / ${totalPages}</div>
                <button class="btn btn-secondary btn-pill" data-prizes-next="1" ${safePage >= totalPages ? 'disabled' : ''}><span class="material-icons-round">chevron_right</span></button>
              </div>
            `;
            return `
              <div class="prizes-head">
                <h3 class="mb-0">🏆 Выигранные призы</h3>
                <div class="muted small">${st.list.length ? `Всего: ${st.list.length}` : 'Пока пусто'}</div>
              </div>
              <div class="prizes-list">
                ${body}
              </div>
              ${pager}
            `;
          })();
          box.innerHTML = html;
        }
      }
    }
    return;
  }
});

function createPrizeFieldRow(prize = {}) {
  const row = document.createElement('div');
  row.className = 'prize-row-edit';

  row.innerHTML = `
    <input class="form-control" name="prizeName" placeholder="Название" value="${prize.name || ''}">
    <select class="form-control" name="prizeRarity">
      <option value="Редкий" ${prize.rarity === 'Редкий' ? 'selected' : ''}>Редкий</option>
      <option value="Эпический" ${prize.rarity === 'Эпический' ? 'selected' : ''}>Эпический</option>
      <option value="Мифический" ${prize.rarity === 'Мифический' ? 'selected' : ''}>Мифический</option>
      <option value="Легендарный" ${prize.rarity === 'Легендарный' ? 'selected' : ''}>Легендарный</option>
    </select>
    <input class="form-control" name="prizeEmoji" placeholder="URL/эмодзи" value="${(prize.emoji ?? prize.image) || ''}">
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

  form.reset();
  fields.innerHTML = '';

  const isNew = !item;
  title.textContent = isNew ? 'Новый кейс' : `Кейс: ${item.name}`;

  form.elements.name.value = item?.name || '';
  form.elements.price.value = item?.price ?? '';
  if (form.elements.minLevel) {
    form.elements.minLevel.value = item?.minLevel || '';
  }
  form.elements.maxPerUser.value = item?.maxPerUser ?? '';
  form.elements.maxTotal.value = item?.maxTotal ?? '';
  form.elements.imageUrl.value = item?.imageUrl || '';
  form.elements.disabled.checked = !!item?.disabled;

  const prizes = item?.prizes || [];
  prizes.forEach(p => fields.appendChild(createPrizeFieldRow(p)));
  if (!prizes.length) fields.appendChild(createPrizeFieldRow({}));

  form.dataset.mode = isNew ? 'create' : 'update';
  form.dataset.originalName = item?.name || '';

  openModal('case-editor-modal');
}

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
        const rarity = row.querySelector('[name="prizeRarity"]')?.value?.trim();
        const emoji = row.querySelector('[name="prizeEmoji"]')?.value?.trim();
        const okUrl = /^https?:\/\/\S+$/i.test(emoji || '');
        const okEmoji = /\p{Extended_Pictographic}/u.test(emoji || '');
        if (name) {
          if (!okUrl && !okEmoji) {
            alert('Поле «URL/эмодзи» должно содержать ссылку или эмодзи.');
            throw new Error('Invalid emoji/url');
          }
          prizes.push({ name, rarity, emoji, image: emoji });
        }
      });
    }

    const payload = {
      mode,
      originalName,
      name: form.elements.name.value.trim(),
      price: Number(form.elements.price.value),
      maxPerUser: Number(form.elements.maxPerUser.value),
      maxTotal: Number(form.elements.maxTotal.value),
      imageUrl: form.elements.imageUrl.value.trim(),
      disabled: !!form.elements.disabled.checked,
      prizes,
    };
    if (form.elements.minLevel) {
      const lvl = form.elements.minLevel.value.trim();
      if (lvl) payload.minLevel = lvl;
    }

    if (payload.imageUrl) {
      const okImg = /^https?:\/\/\S+/i.test(payload.imageUrl);
      if (!okImg) {
        alert('Поле «URL изображения» должно содержать ссылку (http/https).');
        return;
      }
    }

    await apiFetch('/api/admin/case', { method: 'POST', body: JSON.stringify(payload) });
    closeModal(document.getElementById('case-editor-modal'));
    await loadAdminCases();
  });
}

const closeCaseEditor = document.getElementById('close-case-editor');
if (closeCaseEditor) {
  closeCaseEditor.addEventListener('click', () => closeModal(document.getElementById('case-editor-modal')));
}

const userSearch = document.getElementById('user-search');
if (userSearch) {
  userSearch.addEventListener('input', (e) => {
    const st = window.__usersState || { approvedPage: 1, pendingPage: 1, query: '' };
    st.query = e.target.value || '';
    st.approvedPage = 1;
    st.pendingPage = 1;
    renderUsersList('approved');
    renderUsersList('pending');
  });
}
