// Helpers
    const $ = (id) => document.getElementById(id);
    const show = (el) => el && (el.style.display = 'block');
    const hide = (el) => el && (el.style.display = 'none');

    function showToast(msg, isError=false){
      const t = $('toast'); if(!t) return;
      t.textContent = msg; t.className = 'toast show'; if(isError) t.classList.add('error');
      setTimeout(()=>{ t.classList.remove('show','error'); }, 3000);
    }

    // State
    let currentKeyToken = null;
    let organizeMode = 'category';
    let pollTimer = null;
    let conversationsData = null;
    let completedConversations = new Set();

    function updateOrganizeMode(mode){
      organizeMode = mode;
      const requiresKey = (mode === 'category');
      $('apiKeySection')?.classList.toggle('hidden', !requiresKey);
      $('speedSection')?.classList.toggle('hidden', !requiresKey);
    }

    // Register key
    $('useKeyBtn')?.addEventListener('click', async () => {
      const key = ($('apiKeyInput')?.value || '').trim();
      if (!key || !key.startsWith('sk-')) return showToast('Please enter a valid OpenAI key', true);
      try {
        const res = await fetch('/api/register-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key })
        });
        if (!res.ok) {
          const e = await res.json().catch(()=>({}));
          throw new Error(e.error || 'Failed to register key');
        }
        const data = await res.json();
        currentKeyToken = data.key_token;
        $('apiKeyInput').value = '';
        showToast('Key ready for this run');
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // Upload interactions
    window.addEventListener('DOMContentLoaded', () => {
      const uploadBox = $('uploadBox');
      const fileInput = $('fileInput');
      const overlay = $('processingOverlay');
      const progressBar = $('overlayProgress');
      const progressLabel = $('overlayProgressLabel');
      const progressText = $('processingSubtext');

      function setProgress(pct, msg){
        if(progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, pct||0))}%`;
        if(progressLabel) progressLabel.textContent = `${Math.round(pct||0)}%`;
        if(msg && progressText) progressText.textContent = msg;
      }

      uploadBox?.addEventListener('click', () => fileInput?.click());
      uploadBox?.addEventListener('dragover', (e)=>{ e.preventDefault(); uploadBox.classList.add('dragover'); });
      uploadBox?.addEventListener('dragleave', ()=> uploadBox.classList.remove('dragover'));
      uploadBox?.addEventListener('drop', (e)=>{
        e.preventDefault(); uploadBox.classList.remove('dragover');
        const f = e.dataTransfer.files[0]; if (f) handleFile(f);
      });
      fileInput?.addEventListener('change', (e)=>{ const f = e.target.files[0]; if (f) handleFile(f); });

      async function handleFile(file){
        if (organizeMode === 'category' && !currentKeyToken) {
          return showToast('Enter your API key and click “Use for this run” first.', true);
        }
        overlay?.classList.add('show');
        setProgress(0, 'Starting…');
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('organize_mode', organizeMode);
          formData.append('batch_size', $('batchSizeInput')?.value || 25);
          formData.append('max_concurrency', $('concurrencyInput')?.value || 4);

          const headers = (organizeMode === 'category' && currentKeyToken) ? { 'X-Key-Token': currentKeyToken } : {};
          const startRes = await fetch('/api/categorize', { method: 'POST', headers, body: formData });
          if (!startRes.ok) {
            const e = await startRes.json().catch(()=>({}));
            throw new Error(e.error || 'Failed to start job');
          }
          const { job_id } = await startRes.json();

          await pollUntilDone(job_id, setProgress);

          // fetch final result JSON
          const resultRes = await fetch(`/api/result/${job_id}`);
          if (!resultRes.ok) {
            const e = await resultRes.json().catch(()=>({}));
            throw new Error(e.error || 'Failed to fetch result');
          }
          conversationsData = await resultRes.json();
          loadProgress();
          renderDashboard();
          showToast('Processing complete!');
          setProgress(100, 'Done.');
        } catch (err) {
          console.error(err);
          showToast(err.message, true);
        } finally {
          setTimeout(()=>{ overlay?.classList.remove('show'); setProgress(0); }, 400);
        }
      }

      async function pollUntilDone(jobId, onTick){
        return new Promise((resolve, reject)=>{
          pollTimer = setInterval(async ()=>{
            try {
              const r = await fetch(`/api/progress/${jobId}`);
              if (!r.ok) throw new Error('Progress check failed');
              const data = await r.json();
              onTick?.(data.progress || 0, data.message || '');
              if (data.status === 'done') {
                clearInterval(pollTimer); resolve();
              } else if (data.status === 'error') {
                clearInterval(pollTimer); reject(new Error(data.error || 'Job failed'));
              }
            } catch (e) {
              clearInterval(pollTimer); reject(e);
            }
          }, 500);
        });
      }
    });

    // Utility: sort "Month YYYY" labels by actual date (desc), robust to extra spaces
    function sortPeriodLabelsDesc(obj){
      return Object.keys(obj)
        .map(label => {
          const m = label.match(/([A-Za-z]+)\s+(\d{4})/);
          let monthName = m ? m[1] : '';
          let yearStr = m ? m[2] : '';
          const year = Number(yearStr);
          const d = new Date(`${monthName} 1, ${year} 00:00:00`);
          const sortKey = isNaN(d.getTime()) ? -Infinity : d.getTime();
          return { label, data: obj[label], sortKey };
        })
        .sort((a, b) => b.sortKey - a.sortKey);
    }


    // ===== Reports (rendering) =====

    
    function toArrayMaybe(value){
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object'){
        const vals = Object.values(value);
        if (vals.length === 0) return [];
        if (Array.isArray(vals[0])) return vals[0]; // common { All: [...] }
        return vals;
      }
      return [];
    }

    function renderDashboard() {
      hide($('setupSection'));
      show($('mainContent'));

      const grid = $('categoriesGrid');
      grid.innerHTML = '';

      const mode = conversationsData?.summary?.organize_mode || organizeMode || 'category';

      if (mode === 'category') {
        const categories = conversationsData.categories || {};
        for (const [category, conversations] of Object.entries(categories)) {
          const card = createCategoryCard(category, conversations);
          grid.appendChild(card);
        }
        $('groupsLabel').textContent = 'CATEGORIES';
      } else {
        const timePeriods = conversationsData.time_periods;

        if (Array.isArray(timePeriods)) {
          // Case A: backend returns an array like [{ label, items|data|categories }, ...]
          // (Optional) sort newest -> oldest by parsing the label
          const sorted = timePeriods.slice().sort((a, b) => {
            const pa = (a.label || a.period || '').match(/([A-Za-z]+)\s+(\d{4})/);
            const pb = (b.label || b.period || '').match(/([A-Za-z]+)\s+(\d{4})/);
            const da = pa ? new Date(`${pa[1]} 1, ${pa[2]} 00:00:00`).getTime() : -Infinity;
            const db = pb ? new Date(`${pb[1]} 1, ${pb[2]} 00:00:00`).getTime() : -Infinity;
            return db - da; // desc
          });

          for (const tp of sorted) {
            const period = tp.label || tp.period || '';
            const categories =
              tp.items || tp.data || tp.categories || {};
            const card = createTimePeriodCard(period, categories, mode);
            grid.appendChild(card);
          }
        } else {
          // Case B: backend returns an object like { "June 2025": { All: [...] }, ... }
          const obj = timePeriods || {};
          // If backend already sorts, you could iterate Object.entries(obj) directly.
          // Using robust frontend sort just in case:
          const sorted = sortPeriodLabelsDesc(obj); // returns [{ label, data, sortKey }, ...]
          for (const { label: period, data: categories } of sorted) {
            const card = createTimePeriodCard(period, categories, mode);
            grid.appendChild(card);
          }
        }

        $('groupsLabel').textContent = (mode === 'month') ? 'MONTHS' : 'YEARS';
      }

      updateStats();
      initializeSearch();
    }


    function createTimePeriodCard(period, categories, mode) {
      const card = document.createElement('div');
      card.className = 'category-card';
      card.style.gridColumn = 'span 1';

      // ✅ Safely compute total conversations, even if nested under { All: [...] }
      let totalConvs = 0;
      for (const convs of Object.values(categories)) {
        totalConvs += toArrayMaybe(convs).length;
      }

      const header = document.createElement('div');
      header.className = 'category-header';
      header.innerHTML = `
        <div>
          <h2>📅 ${period}</h2>
          <small style="opacity:.8;font-size:12px;">${Object.keys(categories).length} categories</small>
        </div>
        <div class="count">${totalConvs}</div>
      `;

      const body = document.createElement('div');
      body.className = 'category-body';

      for (const [category, conversations] of Object.entries(categories)) {
        const subHeader = document.createElement('div');
        subHeader.style.cssText =
          'background:#f7fafc;padding:10px 20px;font-weight:600;color:#4a5568;font-size:13px;border-bottom:1px solid #e2e8f0;';
        
        // ✅ Safe count
        subHeader.textContent = `${category} (${toArrayMaybe(conversations).length})`;
        body.appendChild(subHeader);

        // ✅ Safe iteration
        toArrayMaybe(conversations).forEach(conv =>
          body.appendChild(createConversationItem(conv))
        );
      }

      card.appendChild(header);
      card.appendChild(body);
      return card;
    }


    function createCategoryCard(category, conversations) {
      const card = document.createElement('div');
      card.className = 'category-card';

      const header = document.createElement('div');
      header.className = 'category-header';

      // ✅ Use toArrayMaybe here too for safe length
      header.innerHTML = `<div><h2>${category}</h2></div><div class="count">${toArrayMaybe(conversations).length}</div>`;

      const body = document.createElement('div');
      body.className = 'category-body';

      // ✅ Safely loop through even if conversations is { All: [...] }
      toArrayMaybe(conversations).forEach(conv => body.appendChild(createConversationItem(conv)));

      card.appendChild(header);
      card.appendChild(body);

      return card;
    }


    function createConversationItem(conv){
      const item = document.createElement('div'); item.className = 'conversation-item'; item.dataset.convId = conv.id;
      const isCompleted = completedConversations.has(conv.id);
      item.innerHTML = `
        <input type="checkbox" class="checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleComplete('${conv.id}')">
        <div class="conversation-details">
          <div class="conversation-title" onclick="openConversation('${conv.id}')">${conv.title}</div>
          <div class="conversation-meta">${conv.create_time} • ${conv.message_count} messages</div>
        </div>
        <a href="https://chat.openai.com/c/${conv.id}" target="_blank" class="link-button">Open</a>
      `;
      if (isCompleted) item.style.opacity = '0.6';
      return item;
    }

    function openConversation(id){ window.open(`https://chat.openai.com/c/${id}`, '_blank'); }

    function loadProgress(){
      const saved = localStorage.getItem('chatgpt_organizer_progress');
      if (saved) completedConversations = new Set(JSON.parse(saved));
    }
    function saveProgress(){
      localStorage.setItem('chatgpt_organizer_progress', JSON.stringify([...completedConversations]));
      updateStats();
    }
    function toggleComplete(id){
      if (completedConversations.has(id)) completedConversations.delete(id);
      else completedConversations.add(id);
      saveProgress();
      const item = document.querySelector(`[data-conv-id="${id}"]`);
      if (item) item.style.opacity = completedConversations.has(id) ? '0.6' : '1';
    }

    function updateStats(){
      const mode = conversationsData?.summary?.organize_mode || organizeMode || 'category';
      let totalConvs = 0; let totalGroups = 0;

      if (mode === 'category') {
        const categories = conversationsData?.categories || {};
        for (const conversations of Object.values(categories)) totalConvs += conversations.length;
        totalGroups = Object.keys(categories).length;
        $('groupsLabel').textContent = 'CATEGORIES';
      } else {
        const timePeriods = conversationsData?.time_periods || {};
        for (const categories of Object.values(timePeriods)) {
          for (const conversations of Object.values(categories)) totalConvs += conversations.length;
        }
        totalGroups = Object.keys(timePeriods).length;
        $('groupsLabel').textContent = (mode === 'month') ? 'MONTHS' : 'YEARS';
      }

      $('totalConvs').textContent = totalConvs;
      $('totalGroups').textContent = totalGroups;
    }

    function initializeSearch(){
      const search = $('searchInput');
      if (!search) return;
      search.oninput = (e)=>{
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('.conversation-item').forEach(item=>{
          const title = item.querySelector('.conversation-title')?.textContent?.toLowerCase() || '';
          item.style.display = title.includes(term) ? 'flex' : 'none';
        });
      };
    }

    function showAll(){ document.querySelectorAll('.conversation-item').forEach(i=> i.style.display='flex'); }
    function showCompleted(){ document.querySelectorAll('.conversation-item').forEach(i=>{ const c=i.querySelector('.checkbox'); i.style.display = c?.checked ? 'flex':'none'; }); }
    function showPending(){ document.querySelectorAll('.conversation-item').forEach(i=>{ const c=i.querySelector('.checkbox'); i.style.display = !c?.checked ? 'flex':'none'; }); }

    function downloadJSON(){
      if (!conversationsData) return showToast('No data yet', true);
      const str = JSON.stringify(conversationsData, null, 2);
      const blob = new Blob([str], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'categorized_chats.json'; a.click();
      showToast('JSON downloaded!');
    }

    function resetAndUploadNew(){
      show($('setupSection'));
      hide($('mainContent'));
      $('fileInput').value = '';
      conversationsData = null;
    }