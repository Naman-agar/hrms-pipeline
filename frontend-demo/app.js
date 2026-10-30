const API_BASE = 'http://localhost:3000/api/v1';

let accessToken = sessionStorage.getItem('accessToken') || null;
let refreshToken = sessionStorage.getItem('refreshToken') || null;

const banner = document.getElementById('banner');
const sessionBar = document.getElementById('session-bar');
const whoami = document.getElementById('whoami');
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');

function showBanner(message, isError) {
  banner.textContent = message;
  banner.className = isError ? 'error' : '';
  banner.classList.remove('hidden');
}

function clearBanner() {
  banner.classList.add('hidden');
}

function setSession(tokens) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  sessionStorage.setItem('accessToken', accessToken);
  sessionStorage.setItem('refreshToken', refreshToken);
}

function clearSession() {
  accessToken = null;
  refreshToken = null;
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('refreshToken');
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 204) return null;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const code = body?.error?.code || res.status;
    const message = body?.error?.message || 'Request failed';
    const fields = body?.error?.fields
      ? ' (' + Object.entries(body.error.fields).map(([f, m]) => `${f}: ${m}`).join(', ') + ')'
      : '';
    throw new Error(`${code}: ${message}${fields}`);
  }

  return body;
}

let currentUserId = null;

function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

async function loadMe() {
  const user = await apiFetch('/me');
  currentUserId = user.id;
  whoami.innerHTML = `${user.full_name}<small>${user.role.name}</small>`;
  document.getElementById('whoami-avatar').textContent = initials(user.full_name);
  return user;
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  sessionBar.classList.remove('hidden');
}

function showLogin() {
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  sessionBar.classList.add('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanner();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const tokens = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSession(tokens);
    await loadMe();
    showApp();
    await Promise.all([refreshRoles(), refreshDepartments()]);
    refreshUsers();
  } catch (err) {
    showBanner(err.message, true);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    if (refreshToken) {
      await apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
    }
  } catch (err) {
    // ignore logout errors, clear local session regardless
  }
  clearSession();
  showLogin();
});

// Tabs

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}-tab`).classList.remove('hidden');
  });
});

// Roles

let rolesCache = [];
let departmentsCache = [];

function populateUserFormOptions() {
  const roleSelects = [document.getElementById('users-role-filter'), document.getElementById('user-role')];
  const deptSelects = [document.getElementById('users-department-filter'), document.getElementById('user-department')];

  roleSelects.forEach((sel) => {
    const keepFirst = sel.id === 'users-role-filter';
    const current = sel.value;
    sel.innerHTML = keepFirst ? '<option value="">Any role</option>' : '';
    rolesCache.forEach((role) => {
      const opt = document.createElement('option');
      opt.value = role.id;
      opt.textContent = role.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });

  deptSelects.forEach((sel) => {
    const keepFirst = sel.id === 'users-department-filter';
    const current = sel.value;
    sel.innerHTML = keepFirst ? '<option value="">Any department</option>' : '';
    departmentsCache.forEach((dept) => {
      const opt = document.createElement('option');
      opt.value = dept.id;
      opt.textContent = dept.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });
}

async function refreshRoles() {
  try {
    const roles = await apiFetch('/roles');
    rolesCache = roles;
    populateUserFormOptions();
    const body = document.getElementById('roles-body');
    body.innerHTML = '';
    roles.forEach((role) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${role.name}</td>
        <td>${role.isSystem ? 'yes' : 'no'}</td>
        <td>${(role.permissions || []).join(', ')}</td>
        <td>${role.isSystem ? '' : '<button class="btn btn-danger" data-id="' + role.id + '">Delete</button>'}</td>
      `;
      body.appendChild(tr);
    });
    body.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/roles/${btn.dataset.id}`, { method: 'DELETE' });
          refreshRoles();
        } catch (err) {
          showBanner(err.message, true);
        }
      });
    });
  } catch (err) {
    showBanner(err.message, true);
  }
}

document.getElementById('role-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanner();
  const name = document.getElementById('role-name').value;
  const permissions = document
    .getElementById('role-permissions')
    .value.split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  try {
    await apiFetch('/roles', { method: 'POST', body: JSON.stringify({ name, permissions }) });
    e.target.reset();
    refreshRoles();
  } catch (err) {
    showBanner(err.message, true);
  }
});

// Departments

async function refreshDepartments() {
  try {
    const departments = await apiFetch('/departments');
    departmentsCache = departments;
    populateUserFormOptions();
    const body = document.getElementById('departments-body');
    body.innerHTML = '';
    departments.forEach((dept) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${dept.name}</td>
        <td><span class="badge ${dept.isActive ? 'badge-active' : 'badge-inactive'}">${dept.isActive ? 'active' : 'inactive'}</span></td>
        <td class="row-actions">
          <button class="btn btn-secondary toggle" data-id="${dept.id}" data-active="${dept.isActive}">
            ${dept.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button class="btn btn-danger" data-id="${dept.id}" data-action="delete">Delete</button>
        </td>
      `;
      body.appendChild(tr);
    });
    body.querySelectorAll('button.toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const isActive = btn.dataset.active === 'true';
          await apiFetch(`/departments/${btn.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: !isActive }),
          });
          refreshDepartments();
        } catch (err) {
          showBanner(err.message, true);
        }
      });
    });
    body.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/departments/${btn.dataset.id}`, { method: 'DELETE' });
          refreshDepartments();
        } catch (err) {
          showBanner(err.message, true);
        }
      });
    });
  } catch (err) {
    showBanner(err.message, true);
  }
}

document.getElementById('department-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanner();
  const name = document.getElementById('department-name').value;
  try {
    await apiFetch('/departments', { method: 'POST', body: JSON.stringify({ name }) });
    e.target.reset();
    refreshDepartments();
  } catch (err) {
    showBanner(err.message, true);
  }
});

// Users

const usersState = {
  search: '',
  status: '',
  role_id: '',
  department_id: '',
  sort: 'name',
  order: 'asc',
  page: 1,
  page_size: 25,
};

let editingUserId = null;

function formatLastLogin(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

function buildUsersQuery() {
  const params = new URLSearchParams();
  if (usersState.search) params.set('search', usersState.search);
  if (usersState.status) params.set('status', usersState.status);
  if (usersState.role_id) params.set('role_id', usersState.role_id);
  if (usersState.department_id) params.set('department_id', usersState.department_id);
  params.set('sort', usersState.sort);
  params.set('order', usersState.order);
  params.set('page', String(usersState.page));
  params.set('page_size', String(usersState.page_size));
  return params.toString();
}

async function refreshUsers() {
  try {
    const result = await apiFetch(`/users?${buildUsersQuery()}`);
    const body = document.getElementById('users-body');
    body.innerHTML = '';

    result.data.forEach((user) => {
      const tr = document.createElement('tr');
      const isSelf = user.id === currentUserId;
      tr.innerHTML = `
        <td class="cell-user">
          <span class="avatar avatar-sm">${initials(user.full_name)}</span>
          <span>${user.full_name}${isSelf ? ' <span class="badge badge-you">you</span>' : ''}</span>
        </td>
        <td>${user.email}</td>
        <td>${user.department.name}</td>
        <td>${user.role.name}</td>
        <td><span class="badge badge-${user.status}">${user.status}</span></td>
        <td>${formatLastLogin(user.last_login_at)}</td>
        <td class="row-actions">
          <button class="btn btn-secondary" data-action="edit" data-id="${user.id}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${user.id}">Delete</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = result.data.find((u) => u.id === btn.dataset.id);
        openUserForm(user);
      });
    });
    body.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this user? This can be undone via restore later.')) return;
        try {
          await apiFetch(`/users/${btn.dataset.id}`, { method: 'DELETE' });
          refreshUsers();
        } catch (err) {
          showBanner(err.message, true);
        }
      });
    });

    const { page, page_size, total } = result.meta;
    const from = total === 0 ? 0 : (page - 1) * page_size + 1;
    const to = Math.min(page * page_size, total);
    document.getElementById('users-page-info').textContent =
      `Page ${page} of ${result.meta.total_pages} · ${from}–${to} of ${total} users`;
    document.getElementById('users-prev').disabled = page <= 1;
    document.getElementById('users-next').disabled = page >= result.meta.total_pages;
  } catch (err) {
    showBanner(err.message, true);
  }
}

document.getElementById('users-filter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  clearBanner();
  usersState.search = document.getElementById('users-search').value.trim();
  usersState.status = document.getElementById('users-status-filter').value;
  usersState.role_id = document.getElementById('users-role-filter').value;
  usersState.department_id = document.getElementById('users-department-filter').value;
  usersState.sort = document.getElementById('users-sort').value;
  usersState.page_size = Number(document.getElementById('users-page-size').value);
  usersState.page = 1;
  refreshUsers();
});

document.getElementById('users-clear-filters').addEventListener('click', () => {
  document.getElementById('users-filter-form').reset();
  usersState.search = '';
  usersState.status = '';
  usersState.role_id = '';
  usersState.department_id = '';
  usersState.sort = 'name';
  usersState.order = 'asc';
  usersState.page = 1;
  usersState.page_size = 25;
  document.getElementById('users-order-toggle').textContent = '↑ Asc';
  clearBanner();
  refreshUsers();
});

document.getElementById('users-order-toggle').addEventListener('click', (e) => {
  usersState.order = usersState.order === 'asc' ? 'desc' : 'asc';
  e.target.textContent = usersState.order === 'asc' ? '↑ Asc' : '↓ Desc';
  usersState.page = 1;
  refreshUsers();
});

document.getElementById('users-prev').addEventListener('click', () => {
  if (usersState.page > 1) {
    usersState.page -= 1;
    refreshUsers();
  }
});

document.getElementById('users-next').addEventListener('click', () => {
  usersState.page += 1;
  refreshUsers();
});

function openUserForm(user) {
  clearBanner();
  const form = document.getElementById('user-form');
  const passwordInput = document.getElementById('user-password');
  const emailInput = document.getElementById('user-email');
  form.classList.remove('hidden');

  if (user) {
    editingUserId = user.id;
    document.getElementById('user-form-title').textContent = `Edit ${user.full_name}`;
    document.getElementById('user-first-name').value = user.first_name;
    document.getElementById('user-last-name').value = user.last_name;
    emailInput.value = user.email;
    emailInput.disabled = true;
    passwordInput.classList.add('hidden');
    passwordInput.required = false;
    document.getElementById('user-role').value = user.role.id;
    document.getElementById('user-department').value = user.department.id;
    document.getElementById('user-status').value = user.status === 'invited' ? 'active' : user.status;
  } else {
    editingUserId = null;
    document.getElementById('user-form-title').textContent = 'New user';
    form.querySelectorAll('input').forEach((i) => (i.value = ''));
    emailInput.disabled = false;
    passwordInput.classList.remove('hidden');
    passwordInput.required = true;
    document.getElementById('user-status').value = 'active';
  }
}

document.getElementById('users-new-btn').addEventListener('click', () => openUserForm(null));

document.getElementById('user-form-cancel').addEventListener('click', () => {
  document.getElementById('user-form').classList.add('hidden');
  editingUserId = null;
});

document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanner();

  const firstName = document.getElementById('user-first-name').value;
  const lastName = document.getElementById('user-last-name').value;
  const roleId = document.getElementById('user-role').value;
  const departmentId = document.getElementById('user-department').value;
  const status = document.getElementById('user-status').value;

  try {
    if (editingUserId) {
      await apiFetch(`/users/${editingUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          role_id: roleId,
          department_id: departmentId,
          status,
        }),
      });
    } else {
      const email = document.getElementById('user-email').value;
      const password = document.getElementById('user-password').value;
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          password,
          role_id: roleId,
          department_id: departmentId,
          status,
        }),
      });
    }
    document.getElementById('user-form').classList.add('hidden');
    editingUserId = null;
    refreshUsers();
  } catch (err) {
    showBanner(err.message, true);
  }
});

// Resume session on reload

(async function init() {
  if (accessToken) {
    try {
      await loadMe();
      showApp();
      await Promise.all([refreshRoles(), refreshDepartments()]);
      refreshUsers();
      return;
    } catch {
      clearSession();
    }
  }
  showLogin();
})();
