// ===== Utility Functions =====
const $ = (id) => document.getElementById(id);
const show = (el) => el && (el.style.display = 'block');
const hide = (el) => el && (el.style.display = 'none');

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(msg, isError = false) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show';
  if (isError) t.classList.add('error');
  setTimeout(() => {
    t.classList.remove('show', 'error');
  }, 3000);
}

// ===== State Management =====
const state = {
  currentKeyToken: null,
  organizeMode: 'category',
  pollTimer: null,
  conversationsData: null,
  completedConversations: new Set(),
  currentJobId: null
};

// ===== Progress Persistence =====
function loadProgress() {
  try {
    const saved = localStorage.getItem('chatgpt_organizer_progress');
    if (saved) {
      state.completedConversations = new Set(JSON.parse(saved));
    }
  } catch (err) {
    console.error('Failed to load progress:', err);
  }
}

function saveProgress() {
  try {
    localStorage.setItem(
      'chatgpt_organizer_progress',
      JSON.stringify([...state.completedConversations])
    );
    updateStats();
  } catch (err) {
    console.error('Failed to save progress:', err);
  }
}

// ===== Mode Management =====
function updateOrganizeMode(mode) {
  state.organizeMode = mode;
  const requiresKey = (mode === 'category');
  $('apiKeySection')?.classList.toggle('hidden', !requiresKey);
  $('speedSection')?.classList.toggle('hidden', !requiresKey);
}

// ===== API Key Registration =====
$('useKeyBtn')?.addEventListener('click', async () => {
  const input = $('apiKeyInput');
  const key = (input?.value || '').trim();
  
  if (!key || !key.startsWith('sk-')) {
    return showToast('Please enter a valid OpenAI key', true);
  }

  try {
    const res = await fetch('/api/register-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key })
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'Failed to register key');
    }

    const data = await res.json();
    state.currentKeyToken = data.key_token;
    input.value = '';
    showToast('Key ready for this run');
  } catch (err) {
    showToast(err.message, true);
  }
});

// ===== File Upload & Processing =====
window.addEventListener('DOMContentLoaded', () => {
  const uploadBox = $('uploadBox');
  const fileInput = $('fileInput');
  const overlay = $('processingOverlay');
  const progressBar = $('overlayProgress');
  const progressLabel = $('overlayProgressLabel');
  const progressText = $('processingSubtext');

  function setProgress(pct, msg) {
    const clampedPct = Math.max(0, Math.min(100, pct || 0));
    if (progressBar) progressBar.style.width = `${clampedPct}%`;
    if (progressLabel) progressLabel.textContent = `${Math.round(clampedPct)}%`;
    if (msg && progressText) progressText.textContent = msg;
  }

  // Upload box interactions
  uploadBox?.addEventListener('click', () => fileInput?.click());
  
  uploadBox?.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
  });
  
  uploadBox?.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
  });
  
  uploadBox?.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  
  fileInput?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  async function handleFile(file) {
    // Validate prerequisites
    if (state.organizeMode === 'category' && !state.currentKeyToken) {
      return showToast('Enter your API key and click "Use for this run" first.', true);
    }

    // Cancel any existing job
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }

    overlay?.classList.add('show');
    setProgress(0, 'Starting…');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('organize_mode', state.organizeMode);
      
      // Validate and clamp input values
      const batchSize = Math.max(1, Math.min(100, parseInt($('batchSizeInput')?.value) || 25));
      const concurrency = Math.max(1, Math.min(10, parseInt($('concurrencyInput')?.value) || 4));
      
      formData.append('batch_size', batchSize);
      formData.append('max_concurrency', concurrency);

      const headers = (state.organizeMode === 'category' && state.currentKeyToken) 
        ? { 'X-Key-Token': state.currentKeyToken } 
        : {};

      const startRes = await fetch('/api/categorize', {
        method: 'POST',
        headers,
        body: formData
      });

      if (!startRes.ok) {
        const e = await startRes.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to start job');
      }

      const { job_id } = await startRes.json();
      state.currentJobId = job_id;

      await pollUntilDone(job_id, setProgress);

      // Fetch final result
      const resultRes = await fetch(`/api/result/${job_id}`);
      if (!resultRes.ok) {
        const e = await resultRes.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to fetch result');
      }

      state.conversationsData = await resultRes.json();
      loadProgress();
      renderDashboard();
      showToast('Processing complete!');
      setProgress(100, 'Done.');
    } catch (err) {
      console.error('File processing error:', err);
      showToast(err.message, true);
    } finally {
      setTimeout(() => {
        overlay?.classList.remove('show');
        setProgress(0);
      }, 400);
    }
  }

  async function pollUntilDone(jobId, onTick, maxRetries = 3) {
    let retries = 0;
    
    return new Promise((resolve, reject) => {
      state.pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`/api/progress/${jobId}`);
          if (!r.ok) throw new Error('Progress check failed');
          
          const data = await r.json();
          retries = 0; // Reset on successful response
          
          onTick?.(data.progress || 0, data.message || '');
          
          if (data.status === 'done') {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
            resolve();
          } else if (data.status === 'error') {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
            reject(new Error(data.error || 'Job failed'));
          }
        } catch (e) {
          retries++;
          console.warn(`Progress check failed (attempt ${retries}/${maxRetries}):`, e);
          
          if (retries >= maxRetries) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
            reject(new Error(`Failed after ${maxRetries} attempts: ${e.message}`));
          }
        }
      }, 500);
    });
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
});

// ===== Data Utilities =====
function toArrayMaybe(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  
  const vals = Object.values(value);
  if (vals.length === 0) return [];
  
  // Handle wrapped pattern like { All: [...] }
  return Array.isArray(vals[0]) ? vals[0] : vals;
}

function sortPeriodLabelsDesc(obj) {
  return Object.keys(obj)
    .map(label => {
      const m = label.match(/([A-Za-z]+)\s+(\d{4})/);
      if (!m) return { label, data: obj[label], sortKey: -Infinity };
      
      const [, monthName, yearStr] = m;
      const d = new Date(`${monthName} 1, ${yearStr} 00:00:00`);
      const sortKey = isNaN(d.getTime()) ? -Infinity : d.getTime();
      
      return { label, data: obj[label], sortKey };
    })
    .sort((a, b) => b.sortKey - a.sortKey);
}

// ===== Rendering Functions =====
function renderDashboard() {
  hide($('setupSection'));
  show($('mainContent'));

  const grid = $('categoriesGrid');
  grid.innerHTML = '';

  const mode = state.conversationsData?.summary?.organize_mode || state.organizeMode || 'category';

  if (mode === 'category') {
    renderCategoryMode(grid);
  } else {
    renderTimeMode(grid, mode);
  }

  updateStats();
  initializeSearch();
}

function renderCategoryMode(grid) {
  const categories = state.conversationsData.categories || {};
  
  for (const [category, conversations] of Object.entries(categories)) {
    const card = createCategoryCard(category, conversations);
    grid.appendChild(card);
  }
  
  $('groupsLabel').textContent = 'CATEGORIES';
}

function renderTimeMode(grid, mode) {
  const timePeriods = state.conversationsData.time_periods;

  if (Array.isArray(timePeriods)) {
    // Array format: [{ label, items|data|categories }, ...]
    const sorted = timePeriods.slice().sort((a, b) => {
      const pa = (a.label || a.period || '').match(/([A-Za-z]+)\s+(\d{4})/);
      const pb = (b.label || b.period || '').match(/([A-Za-z]+)\s+(\d{4})/);
      const da = pa ? new Date(`${pa[1]} 1, ${pa[2]} 00:00:00`).getTime() : -Infinity;
      const db = pb ? new Date(`${pb[1]} 1, ${pb[2]} 00:00:00`).getTime() : -Infinity;
      return db - da; // Descending
    });

    for (const tp of sorted) {
      const period = tp.label || tp.period || '';
      const categories = tp.items || tp.data || tp.categories || {};
      const card = createTimePeriodCard(period, categories, mode);
      grid.appendChild(card);
    }
  } else {
    // Object format: { "June 2025": { All: [...] }, ... }
    const obj = timePeriods || {};
    const sorted = sortPeriodLabelsDesc(obj);
    
    for (const { label: period, data: categories } of sorted) {
      const card = createTimePeriodCard(period, categories, mode);
      grid.appendChild(card);
    }
  }

  $('groupsLabel').textContent = (mode === 'month') ? 'MONTHS' : 'YEARS';
}

function createCategoryCard(category, conversations) {
  const card = document.createElement('div');
  card.className = 'category-card';

  const header = document.createElement('div');
  header.className = 'category-header';

  const convArray = toArrayMaybe(conversations);
  const categoryTitle = document.createElement('h2');
  categoryTitle.textContent = category;
  
  const categoryDiv = document.createElement('div');
  categoryDiv.appendChild(categoryTitle);
  
  const countDiv = document.createElement('div');
  countDiv.className = 'count';
  countDiv.textContent = convArray.length;
  countDiv.setAttribute('aria-label', `${convArray.length} conversations`);
  
  header.appendChild(categoryDiv);
  header.appendChild(countDiv);

  const body = document.createElement('div');
  body.className = 'category-body';

  convArray.forEach(conv => body.appendChild(createConversationItem(conv)));

  card.appendChild(header);
  card.appendChild(body);

  return card;
}

function createTimePeriodCard(period, categories, mode) {
  const card = document.createElement('div');
  card.className = 'category-card';
  card.style.gridColumn = 'span 1';

  let totalConvs = 0;
  for (const convs of Object.values(categories)) {
    totalConvs += toArrayMaybe(convs).length;
  }

  const header = document.createElement('div');
  header.className = 'category-header';
  
  const leftDiv = document.createElement('div');
  const title = document.createElement('h2');
  title.setAttribute('role', 'heading');
  title.setAttribute('aria-level', '2');
  title.textContent = `${period}`;
  
  const subtitle = document.createElement('small');
  subtitle.style.cssText = 'opacity:.8;font-size:12px;';
  subtitle.textContent = `${Object.keys(categories).length} categories`;
  
  leftDiv.appendChild(title);
  leftDiv.appendChild(subtitle);
  
  const countDiv = document.createElement('div');
  countDiv.className = 'count';
  countDiv.textContent = totalConvs;
  countDiv.setAttribute('aria-label', `${totalConvs} conversations`);
  
  header.appendChild(leftDiv);
  header.appendChild(countDiv);

  const body = document.createElement('div');
  body.className = 'category-body';

  for (const [category, conversations] of Object.entries(categories)) {
    const subHeader = document.createElement('div');
    subHeader.style.cssText =
      'background:#f7fafc;padding:10px 20px;font-weight:600;color:#4a5568;font-size:13px;border-bottom:1px solid #e2e8f0;';
    
    const convArray = toArrayMaybe(conversations);
    subHeader.textContent = `${category} (${convArray.length})`;
    body.appendChild(subHeader);

    convArray.forEach(conv => body.appendChild(createConversationItem(conv)));
  }

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function createConversationItem(conv) {
  const item = document.createElement('div');
  item.className = 'conversation-item';
  item.dataset.convId = conv.id;
  
  const isCompleted = state.completedConversations.has(conv.id);

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'checkbox';
  checkbox.checked = isCompleted;
  checkbox.onchange = () => toggleComplete(conv.id);

  // Details container
  const details = document.createElement('div');
  details.className = 'conversation-details';

  // Title (prevent XSS)
  const titleDiv = document.createElement('div');
  titleDiv.className = 'conversation-title';
  titleDiv.textContent = conv.title;
  titleDiv.onclick = () => openConversation(conv.id);

  // Meta
  const metaDiv = document.createElement('div');
  metaDiv.className = 'conversation-meta';
  metaDiv.textContent = `${conv.create_time} • ${conv.message_count} messages`;

  details.appendChild(titleDiv);
  details.appendChild(metaDiv);

  // Link button
  const link = document.createElement('a');
  link.href = `https://chat.openai.com/c/${conv.id}`;
  link.target = '_blank';
  link.className = 'link-button';
  link.textContent = 'Open';

  item.appendChild(checkbox);
  item.appendChild(details);
  item.appendChild(link);

  if (isCompleted) item.style.opacity = '0.6';

  return item;
}

// ===== Conversation Actions =====
function openConversation(id) {
  window.open(`https://chat.openai.com/c/${id}`, '_blank');
}

function toggleComplete(id) {
  if (state.completedConversations.has(id)) {
    state.completedConversations.delete(id);
  } else {
    state.completedConversations.add(id);
  }
  
  saveProgress();
  
  const item = document.querySelector(`[data-conv-id="${id}"]`);
  if (item) {
    item.style.opacity = state.completedConversations.has(id) ? '0.6' : '1';
    const checkbox = item.querySelector('.checkbox');
    if (checkbox) checkbox.checked = state.completedConversations.has(id);
  }
}

// ===== Stats & Search =====
function updateStats() {
  const mode = state.conversationsData?.summary?.organize_mode || state.organizeMode || 'category';
  let totalConvs = 0;
  let totalGroups = 0;

  if (mode === 'category') {
    const categories = state.conversationsData?.categories || {};
    for (const conversations of Object.values(categories)) {
      totalConvs += toArrayMaybe(conversations).length;
    }
    totalGroups = Object.keys(categories).length;
    $('groupsLabel').textContent = 'CATEGORIES';
  } else {
    const timePeriods = state.conversationsData?.time_periods || {};
    const periods = Array.isArray(timePeriods) ? timePeriods : Object.values(timePeriods);
    
    for (const periodData of periods) {
      const categories = periodData.items || periodData.data || periodData.categories || periodData;
      for (const conversations of Object.values(categories)) {
        totalConvs += toArrayMaybe(conversations).length;
      }
    }
    
    totalGroups = Array.isArray(timePeriods) ? timePeriods.length : Object.keys(timePeriods).length;
    $('groupsLabel').textContent = (mode === 'month') ? 'MONTHS' : 'YEARS';
  }

  $('totalConvs').textContent = totalConvs;
  $('totalGroups').textContent = totalGroups;
}

function initializeSearch() {
  const search = $('searchInput');
  if (!search) return;

  search.oninput = debounce((e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.conversation-item').forEach(item => {
      const title = item.querySelector('.conversation-title')?.textContent?.toLowerCase() || '';
      item.style.display = title.includes(term) ? 'flex' : 'none';
    });
  }, 300);
}

// ===== Filter Functions =====
function showAll() {
  document.querySelectorAll('.conversation-item').forEach(i => {
    i.style.display = 'flex';
  });
}

function showCompleted() {
  document.querySelectorAll('.conversation-item').forEach(i => {
    const c = i.querySelector('.checkbox');
    i.style.display = c?.checked ? 'flex' : 'none';
  });
}

function showPending() {
  document.querySelectorAll('.conversation-item').forEach(i => {
    const c = i.querySelector('.checkbox');
    i.style.display = !c?.checked ? 'flex' : 'none';
  });
}

// ===== Export & Reset =====
function downloadJSON() {
  if (!state.conversationsData) {
    return showToast('No data yet', true);
  }

  try {
    const str = JSON.stringify(state.conversationsData, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'categorized_chats.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON downloaded!');
  } catch (err) {
    console.error('Download failed:', err);
    showToast('Failed to download JSON', true);
  }
}

function resetAndUploadNew() {
  // Cancel any active polling
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  show($('setupSection'));
  hide($('mainContent'));
  $('fileInput').value = '';
  state.conversationsData = null;
  state.currentJobId = null;
}