const GRID_SIZE = 200;
const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('color-picker');
const colorHex = document.getElementById('color-hex');
const lockBtn = document.getElementById('lock-btn');
const remainingEl = document.getElementById('remaining');
const myCountEl = document.getElementById('my-count');
const emptyCountEl = document.getElementById('empty-count');
const toastEl = document.getElementById('toast');
const cursorPreview = document.getElementById('cursor-preview');
const magnifier = document.getElementById('magnifier');
const magnifierCanvas = document.getElementById('magnifier-canvas');
const magnifierCtx = magnifierCanvas.getContext('2d');

const MAGNIFIER_SIZE = 140;
const MAGNIFIER_VIEW = 17;  // pixels to show (odd = center under cursor)
const MAGNIFIER_SCALE = 8;  // each pixel drawn at 8x

magnifierCanvas.width = MAGNIFIER_VIEW * MAGNIFIER_SCALE;
magnifierCanvas.height = MAGNIFIER_VIEW * MAGNIFIER_SCALE;

let gridData = {};
let myPixels = [];
let remaining = 10;
let maxPerDay = 10;
let selectedColor = '#ff6b6b';
let lastMouseEvent = null;

// Sync color inputs
colorPicker.addEventListener('input', (e) => {
  selectedColor = e.target.value;
  colorHex.value = selectedColor;
});

colorHex.addEventListener('input', (e) => {
  const val = e.target.value;
  if (/^#[0-9A-Fa-f]{0,6}$/.test(val) || /^[0-9A-Fa-f]{0,6}$/.test(val)) {
    const hex = val.startsWith('#') ? val : '#' + val;
    if (hex.length === 7) {
      selectedColor = hex;
      colorPicker.value = hex;
    }
  }
});

colorHex.addEventListener('blur', () => {
  if (/^#[0-9A-Fa-f]{6}$/.test(colorHex.value)) {
    selectedColor = colorHex.value;
    colorPicker.value = selectedColor;
  } else {
    colorHex.value = selectedColor;
  }
});

function updateEmptyCount() {
  const total = GRID_SIZE * GRID_SIZE;
  const filled = Object.keys(gridData).length;
  emptyCountEl.textContent = (total - filled).toLocaleString();
}

// Toast helper
function toast(message, type = '') {
  toastEl.textContent = message;
  toastEl.className = 'toast show ' + type;
  setTimeout(() => toastEl.classList.remove('show'), 3000);
}

// Fetch grid and user state
async function fetchGrid() {
  const [gridRes, meRes] = await Promise.all([
    fetch('/api/grid'),
    fetch('/api/me', { credentials: 'include' })
  ]);
  const { grid } = await gridRes.json();
  const me = await meRes.json();

  gridData = grid;
  myPixels = me.myPixels || [];
  remaining = me.remaining ?? 10;
  maxPerDay = me.maxPerDay ?? 10;

  remainingEl.textContent = remaining;
  myCountEl.textContent = myPixels.length;
  updateEmptyCount();

  render();
}

// Render the grid
function render() {
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);

  for (const [key, cell] of Object.entries(gridData)) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = cell.color;
    ctx.fillRect(x, y, 1, 1);
  }

  // Highlight user's pixels with a subtle border
  myPixels.forEach(({ x, y, locked }) => {
    if (!locked) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.2;
      ctx.strokeRect(x, y, 1, 1);
    }
  });

  if (magnifier.classList.contains('visible') && lastMouseEvent) {
    const { x, y } = getGridCoords(lastMouseEvent);
    if (inBounds(x, y)) updateMagnifier(x, y, lastMouseEvent);
  }
}

// Get grid coords from mouse event
function getGridCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = GRID_SIZE / rect.width;
  const scaleY = GRID_SIZE / rect.height;
  const x = Math.floor((e.clientX - rect.left) * scaleX);
  const y = Math.floor((e.clientY - rect.top) * scaleY);
  return { x, y };
}

// Check if (x,y) is in bounds
function inBounds(x, y) {
  return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

// Delete own pixel (frees slot to place elsewhere)
async function deletePixel(x, y) {
  try {
    const res = await fetch('/api/pixel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ x: Number(x), y: Number(y), action: 'delete' })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(data.error || `Failed to delete pixel (${res.status})`, 'error');
      return;
    }

    delete gridData[`${x},${y}`];
    myPixels = myPixels.filter(p => p.x !== x || p.y !== y);
    remaining++;
    remainingEl.textContent = remaining;
    myCountEl.textContent = myPixels.length;
    updateEmptyCount();
    render();
    toast('Pixel removed. You can place another.', 'success');
  } catch (err) {
    toast('Network error', 'error');
  }
}

// Place or update pixel
async function placePixel(x, y) {
  try {
    const res = await fetch('/api/pixel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ x, y, color: selectedColor })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast(data.error || 'Failed to place pixel', 'error');
      return;
    }

    // Update local state
    gridData[`${x},${y}`] = { color: selectedColor, locked: false };

    if (data.action === 'placed') {
      const locked = !!data.sessionLocked;
      myPixels.push({ x, y, color: selectedColor, locked });
      if (locked) myPixels.forEach(p => { p.locked = true; });
      remaining--;
      remainingEl.textContent = remaining;
    } else {
      const idx = myPixels.findIndex(p => p.x === x && p.y === y);
      if (idx >= 0) myPixels[idx].color = selectedColor;
    }

    myCountEl.textContent = myPixels.length;
    if (data.action === 'placed') updateEmptyCount();
    render();
    toast(
      data.sessionLocked ? 'Session complete! Your pixels are now locked.' : (data.action === 'placed' ? 'Pixel placed!' : 'Color updated'),
      'success'
    );
  } catch (err) {
    toast('Network error', 'error');
  }
}

// Canvas click
canvas.addEventListener('click', (e) => {
  const { x, y } = getGridCoords(e);
  if (!inBounds(x, y)) return;

  const key = `${x},${y}`;
  const cell = gridData[key];

  // Can only interact with empty cells or our own unlocked pixels
  const myPixel = myPixels.find(p => p.x === x && p.y === y);
  if (cell && !myPixel) {
    toast('This pixel is taken', 'error');
    return;
  }

  if (myPixel && myPixel.locked) {
    toast('This pixel is locked', 'error');
    return;
  }

  if (myPixel) {
    deletePixel(x, y);
    return;
  }

  if (remaining <= 0) {
    toast(`Daily limit reached (${maxPerDay} pixels)`, 'error');
    return;
  }

  if (myPixels.length >= maxPerDay) {
    toast(`You already have ${maxPerDay} pixels`, 'error');
    return;
  }

  // Check adjacency (including diagonal) - must be next to any existing pixel (or anywhere if grid is empty)
  const existingCount = Object.keys(gridData).length;
  const adjacent = existingCount === 0 || Object.keys(gridData).some(key => {
    const [px, py] = key.split(',').map(Number);
    const dx = Math.abs(px - x);
    const dy = Math.abs(py - y);
    return dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
  });

  if (!adjacent) {
    toast('Pixel must be next to any existing pixel', 'error');
    return;
  }

  placePixel(x, y);
});

// Magnifier: draw zoomed region from main canvas
function updateMagnifier(gx, gy, e) {
  magnifierCtx.imageSmoothingEnabled = false;
  magnifierCtx.imageSmoothingQuality = 'low';

  const half = Math.floor(MAGNIFIER_VIEW / 2);
  const sx = Math.max(0, gx - half);
  const sy = Math.max(0, gy - half);
  const sw = Math.min(MAGNIFIER_VIEW, GRID_SIZE - sx);
  const sh = Math.min(MAGNIFIER_VIEW, GRID_SIZE - sy);

  magnifierCtx.fillStyle = '#1a1a22';
  magnifierCtx.fillRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);

  const scale = MAGNIFIER_SCALE;
  magnifierCtx.drawImage(
    canvas,
    sx, sy, sw, sh,
    0, 0, sw * scale, sh * scale
  );

  const offset = 24;
  let left = e.clientX + offset;
  let top = e.clientY + offset;
  if (left + MAGNIFIER_SIZE > window.innerWidth) left = e.clientX - MAGNIFIER_SIZE - offset;
  if (top + MAGNIFIER_SIZE > window.innerHeight) top = e.clientY - MAGNIFIER_SIZE - offset;
  if (left < 0) left = offset;
  if (top < 0) top = offset;
  magnifier.style.left = left + 'px';
  magnifier.style.top = top + 'px';
}

// Cursor preview + magnifier
canvas.addEventListener('mousemove', (e) => {
  const { x, y } = getGridCoords(e);
  if (!inBounds(x, y)) {
    cursorPreview.style.display = 'none';
    magnifier.classList.remove('visible');
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / GRID_SIZE;
  const scaleY = rect.height / GRID_SIZE;

  cursorPreview.style.display = 'block';
  cursorPreview.style.left = rect.left + x * scaleX - 6 + 'px';
  cursorPreview.style.top = rect.top + y * scaleY - 6 + 'px';
  cursorPreview.style.backgroundColor = selectedColor;

  magnifier.classList.add('visible');
  lastMouseEvent = e;
  updateMagnifier(x, y, e);
});

canvas.addEventListener('mouseleave', () => {
  cursorPreview.style.display = 'none';
  magnifier.classList.remove('visible');
});

// Lock session
lockBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/lock', {
      method: 'POST',
      credentials: 'include'
    });
    myPixels = myPixels.map(p => ({ ...p, locked: true }));
    gridData = Object.fromEntries(
      Object.entries(gridData).map(([k, v]) => [
        k,
        myPixels.some(p => `${p.x},${p.y}` === k)
          ? { ...v, locked: true }
          : v
      ])
    );
    render();
    toast('Session ended. Your pixels are now locked.', 'success');
    fetchGrid();
  } catch (err) {
    toast('Failed to lock', 'error');
  }
});

// Scale canvas for easier interaction
canvas.style.width = 'min(90vw, 800px)';
canvas.style.height = 'auto';
canvas.style.aspectRatio = '1';

// Recent visitors log
const visitorLogList = document.getElementById('visitor-log-list');

function formatTime(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderVisitorLog() {
  fetch('/api/recent-visitors')
    .then(r => r.json())
    .then(visitors => {
      if (visitors.length === 0) {
        visitorLogList.innerHTML = '<span class="visitor-log-empty">No visitors yet</span>';
        return;
      }
      visitorLogList.innerHTML = visitors.map(v => {
        const loc = [v.city, v.region, v.country].filter(Boolean).join(', ');
        return `<div class="visitor-log-entry">${loc} <span class="visitor-time">${formatTime(v.time)}</span></div>`;
      }).join('');
    })
    .catch(() => {});
}

renderVisitorLog();
setInterval(renderVisitorLog, 5000);

fetchGrid();
