const ADMIN_STORAGE_KEY = 'pixel_admin_token';

const loginEl = document.getElementById('admin-login');
const contentEl = document.getElementById('admin-content');
const tokenInput = document.getElementById('admin-token');
const loginBtn = document.getElementById('admin-login-btn');
const dateInput = document.getElementById('session-log-date');
const logList = document.getElementById('session-log-list');

// Check for token in URL
const params = new URLSearchParams(location.search);
const urlToken = params.get('admin_token');
if (urlToken) {
  sessionStorage.setItem(ADMIN_STORAGE_KEY, urlToken);
  history.replaceState({}, '', location.pathname);
}

function getToken() {
  return sessionStorage.getItem(ADMIN_STORAGE_KEY);
}

function setToken(token) {
  sessionStorage.setItem(ADMIN_STORAGE_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(ADMIN_STORAGE_KEY);
}

function fetchWithAuth(url) {
  const token = getToken();
  return fetch(url, {
    headers: token ? { 'X-Admin-Token': token } : {}
  });
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    loginEl.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }
  fetchWithAuth('/api/session-logs')
    .then(r => {
      if (r.status === 403 || r.status === 503) {
        clearToken();
        loginEl.style.display = 'block';
        contentEl.style.display = 'none';
        tokenInput.value = '';
        if (r.status === 403) alert('Invalid admin token');
        return;
      }
      loginEl.style.display = 'none';
      contentEl.style.display = 'block';
      renderSessionLog();
    });
}

loginBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  setToken(token);
  checkAuth();
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

dateInput.valueAsDate = new Date();

function formatSessionTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderSessionLog() {
  const date = dateInput.value || new Date().toISOString().slice(0, 10);
  fetchWithAuth(`/api/session-logs?date=${date}`)
    .then(r => {
      if (r.status === 403 || r.status === 503) {
        clearToken();
        loginEl.style.display = 'block';
        contentEl.style.display = 'none';
        return;
      }
      return r.json();
    })
    .then(logs => {
      if (!logs) return;
      if (logs.length === 0) {
        logList.innerHTML = '<p class="admin-empty">No sessions completed this day</p>';
        return;
      }
      logList.innerHTML = logs.map(l => {
        const loc = [l.city, l.region, l.country].filter(Boolean).join(', ') || 'Unknown';
        const type = l.type === 'completed' ? '10 px' : l.type === 'ended' ? 'ended' : 'timeout';
        return `<div class="session-log-entry">${l.ip} • ${loc} • ${l.pixelsCount} px • ${formatSessionTime(l.time)} <span class="session-log-type">${type}</span></div>`;
      }).join('');
    })
    .catch(() => { logList.innerHTML = '<p class="admin-empty">Failed to load</p>'; });
}

dateInput.addEventListener('change', renderSessionLog);

checkAuth();
