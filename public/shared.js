// Shared frontend utilities.

const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

export async function apiFetch(path, options = {}) {
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  }, options.headers || {});

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  if (!res.ok) {
    let err;
    try {
      err = await res.json();
    } catch {
      err = { message: 'Ошибка запроса' };
    }
    throw new Error(err?.message || 'Ошибка запроса');
  }
  if (res.status === 204) return null;
  return res.json();
}

export function formatNum(v) {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('ru-RU');
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('modal-open');
}

export function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.open')) {
    document.documentElement.classList.remove('modal-open');
  }
}

let modalHandlersBound = false;

export function initModalDismissHandlers() {
  if (modalHandlersBound) return;
  modalHandlersBound = true;

  document.addEventListener('click', (e) => {
    const target = e.target;

    // close by [data-close]
    if (target && target.matches('[data-close]')) {
      const modal = target.closest('.modal');
      closeModal(modal);
      return;
    }

    // close by click on backdrop
    if (target && target.classList && target.classList.contains('modal')) {
      closeModal(target);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.querySelector('.modal.open');
    if (modal) closeModal(modal);
  });
}

export function initLogoutButton() {
  const logoutBtn = document.getElementById('logout-btn');
  if (!logoutBtn) return;
  logoutBtn.addEventListener('click', async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  });
}
