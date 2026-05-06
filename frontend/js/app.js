/**
 * AudioSense AI - Main Application
 * Pure HTML + JS, no framework dependency.
 */

// ===== State =====
const state = {
  files: [],
  currentView: 'home',      // 'home' | 'workspace' | 'detail'
  selectedFileId: null,
  searchQuery: '',
  filterStatus: 'all',      // 'all' | 'idle' | 'processing' | 'completed' | 'failed'
  customPrompt: '',
  isProcessing: false,
};

// ===== SVG Icons (inline) =====
const ICONS = {
  upload: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  audio: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  x: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  play: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
  eye: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  files: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
  list: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
};

// ===== Utilities =====
function formatSize(bytes) {
  if (!bytes) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function statusLabel(s) {
  const map = { idle: '等待处理', transcribing: '转录中...', summarizing: '生成笔记...', completed: '已完成', failed: '失败' };
  return map[s] || s;
}

function statusDotClass(s) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'idle') return 'idle';
  return 'processing';
}

function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Simple XOR obfuscation to prevent casual inspection of localStorage
function encryptKey(key) {
  if (!key) return '';
  return 'ENC:' + btoa(key.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ 42)).join(''));
}
function decryptKey(enc) {
  if (!enc) return '';
  if (enc.startsWith('ENC:')) {
    try {
      return atob(enc.slice(4)).split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ 42)).join('');
    } catch (e) { return ''; }
  }
  return enc; // fallback for old plaintext keys
}

// ===== Simple Markdown to HTML =====
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*(?:<br>)?)+)/g, '<ul>$1</ul>');
  html = html.replace(/<br><\/ul>/g, '</ul>');
  html = html.replace(/<ul><br>/g, '<ul>');

  return `<p>${html}</p>`;
}

// ===== Navigation =====
function navigate(view, fileId = null) {
  state.currentView = view;
  if (fileId) state.selectedFileId = fileId;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');

  if (view === 'home') renderHome();
  if (view === 'workspace') renderWorkspace();
  if (view === 'detail') renderDetail();
}

// ===== Data Loading =====
async function loadFiles() {
  try {
    state.files = await API.listFiles();
  } catch (e) {
    console.error('Failed to load files:', e);
  }
}

// ===== Render: Home =====
function renderHome() {
  const recentEl = document.getElementById('recent-list');
  if (!recentEl) return;

  const recent = state.files.slice(0, 5);
  if (recent.length === 0) {
    recentEl.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:8px 4px;">暂无历史记录</p>';
    return;
  }

  recentEl.innerHTML = recent.map(f => `
    <div class="recent-item" onclick="navigate('detail', '${f.id}')">
      <div class="dot ${statusDotClass(f.status)}"></div>
      <span class="name">${f.name}</span>
      <span class="meta">${statusLabel(f.status)}</span>
    </div>
  `).join('');
}

// ===== Render: Workspace =====
function renderWorkspace() {
  const listEl = document.getElementById('workspace-list');
  if (!listEl) return;

  let filtered = state.files;

  // Filter by status
  if (state.filterStatus !== 'all') {
    if (state.filterStatus === 'processing') {
      filtered = filtered.filter(f => f.status === 'transcribing' || f.status === 'summarizing');
    } else {
      filtered = filtered.filter(f => f.status === state.filterStatus);
    }
  }

  // Filter by search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="status-message">
        ${ICONS.files}
        <h3>暂无文件</h3>
        <p>上传音频或导入B站视频开始使用</p>
      </div>`;
    return;
  }

  listEl.innerHTML = filtered.map(f => {
    const progressClass = f.status === 'completed' ? 'completed' : f.status === 'failed' ? 'failed' : '';
    return `
    <div class="file-card" onclick="navigate('detail', '${f.id}')">
      <input type="checkbox" class="checkbox" data-id="${f.id}" onclick="event.stopPropagation()">
      <div class="file-info">
        <div class="name">${f.name}</div>
        <div class="meta">
          <span>${f.source_type === 'bili_text' ? '字幕模式' : formatSize(f.file_size)}</span>
          <span>${statusLabel(f.status)}</span>
        </div>
      </div>
      <div class="file-progress">
        <div class="progress-bar"><div class="fill ${progressClass}" style="width:${f.progress}%"></div></div>
        <div class="label">${f.progress}%</div>
      </div>
      <div class="file-actions">
        ${f.status === 'completed' ? `<button class="btn-icon" title="查看笔记" onclick="event.stopPropagation();navigate('detail','${f.id}')">${ICONS.eye}</button>` : ''}
        <button class="btn-icon" title="删除" onclick="event.stopPropagation();handleDelete('${f.id}')">${ICONS.trash}</button>
      </div>
    </div>`;
  }).join('');
}

// ===== Render: Detail =====
function renderDetail() {
  const f = state.files.find(f => f.id === state.selectedFileId);
  if (!f) {
    navigate('workspace');
    return;
  }

  document.getElementById('detail-file-title').textContent = f.name;

  const notesPane = document.getElementById('notes-content');
  const transPane = document.getElementById('trans-content');

  if (f.status === 'completed') {
    notesPane.innerHTML = `<div class="markdown-body">${renderMarkdown(f.study_notes)}</div>`;
  } else if (f.status === 'failed') {
    notesPane.innerHTML = `
      <div class="status-message">
        <h3 style="color:var(--danger)">处理失败</h3>
        <p>${f.error_message || '未知错误'}</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="handleProcessSingle('${f.id}')">重试</button>
      </div>`;
  } else if (f.status === 'transcribing' || f.status === 'summarizing') {
    notesPane.innerHTML = `
      <div class="status-message">
        <div class="spinner"></div>
        <h3>${statusLabel(f.status)}</h3>
        <p>请稍候，AI 正在工作...</p>
      </div>`;
  } else {
    notesPane.innerHTML = `
      <div class="status-message">
        <h3>等待处理</h3>
        <p>点击下方按钮开始转录和生成笔记</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="handleProcessSingle('${f.id}')">开始处理</button>
      </div>`;
  }

  transPane.textContent = f.transcription || '暂无转录文本';

  // Update export button
  const exportBtn = document.getElementById('detail-export-btn');
  if (f.status === 'completed') {
    exportBtn.classList.remove('hidden');
    exportBtn.onclick = () => window.open(API.exportSingleUrl(f.id), '_blank');
  } else {
    exportBtn.classList.add('hidden');
  }
}

// ===== Handlers =====
async function handleFileUpload(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  showToast(`开始上传 ${files.length} 个文件...`);
  
  // Upload all files in parallel for maximum speed
  const uploadPromises = files.map(async file => {
    try {
      await API.uploadAudio(file);
      showToast(`上传成功: ${file.name}`, 'success');
    } catch (e) {
      showToast(`上传失败: ${file.name} - ${e.message}`, 'error');
    }
  });

  await Promise.all(uploadPromises);
  await loadFiles();
  renderHome();
  showToast('文件上传完成', 'success');
  navigate('workspace');
}

async function handleBiliImport() {
  const input = document.getElementById('bili-url-input');
  const url = input.value.trim();
  if (!url) return;

  const btn = document.getElementById('bili-import-btn');
  btn.disabled = true;
  btn.textContent = '导入中...';

  try {
    const data = await API.importBilibili(url);

    if (data.type === 'list') {
      showBiliMultiPModal(data, url);
    } else {
      await loadFiles();
      renderHome();
      showToast('B站内容导入成功', 'success');
      input.value = '';
      navigate('workspace');
    }
  } catch (e) {
    showToast(`导入失败: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '导入';
  }
}

function showBiliMultiPModal(data, originalUrl) {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div>
          <h3>多分P视频</h3>
          <div class="subtitle">${data.title}</div>
        </div>
        <button class="btn-icon" onclick="document.getElementById('modal-overlay').classList.add('hidden')">${ICONS.x}</button>
      </div>
      <div class="modal-body">
        ${data.pages.map(p => `
          <div class="page-item" onclick="handleBiliPageSelect(${p.cid}, '${originalUrl}')">
            <div class="page-badge">P${p.page}</div>
            <span class="name">${p.part}</span>
          </div>
        `).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">取消</button>
        <button class="btn btn-primary" onclick="handleBiliImportAll(${JSON.stringify(data.pages).replace(/"/g, '&quot;')}, '${originalUrl}')">
          全部导入 (${data.pages.length}P)
        </button>
      </div>
    </div>`;
}

async function handleBiliPageSelect(cid, url) {
  document.getElementById('modal-overlay').classList.add('hidden');
  try {
    showToast('正在导入分P...');
    await API.importBilibili(url, cid);
    await loadFiles();
    renderHome();
    showToast('导入成功', 'success');
    document.getElementById('bili-url-input').value = '';
  } catch (e) {
    showToast(`导入失败: ${e.message}`, 'error');
  }
}

async function handleBiliImportAll(pages, url) {
  document.getElementById('modal-overlay').classList.add('hidden');
  showToast(`正在导入 ${pages.length} 个分P...`);
  for (const p of pages) {
    try {
      await API.importBilibili(url, p.cid);
    } catch (e) {
      showToast(`P${p.page} 导入失败`, 'error');
    }
  }
  await loadFiles();
  renderHome();
  document.getElementById('bili-url-input').value = '';
  showToast('批量导入完成', 'success');
  navigate('workspace');
}

async function handleProcessSingle(id) {
  let pollInterval;
  try {
    showToast('开始处理，首次加载模型可能需要30-60秒...');
    const f = state.files.find(f => f.id === id);
    if (f) { f.status = 'transcribing'; f.progress = 10; }
    renderDetail();

    // Start polling for real-time progress
    pollInterval = setInterval(async () => {
      try {
        const fileData = await API.getFile(id);
        const sf = state.files.find(x => x.id === id);
        if (sf && fileData) {
          sf.status = fileData.status;
          sf.progress = fileData.progress;
          if (state.currentView === 'detail') renderDetail();
          else if (state.currentView === 'workspace') renderWorkspace();
        }
      } catch (e) {}
    }, 2000);

    const promptTemplate = localStorage.getItem('prompt_template') || '';
    const apiKey = decryptKey(localStorage.getItem('api_key_enc') || localStorage.getItem('api_key'));
    const modelName = localStorage.getItem('model_name') || '';

    await API.processFile(id, promptTemplate, apiKey, modelName);
    await loadFiles();
    renderDetail();
    showToast('处理完成！', 'success');
  } catch (e) {
    await loadFiles();
    renderDetail();
    showToast(`处理失败: ${e.message}`, 'error');
  } finally {
    if (pollInterval) clearInterval(pollInterval);
  }
}

async function handleBatchProcess() {
  if (state.isProcessing) return;
  state.isProcessing = true;

  const btn = document.getElementById('batch-process-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin:0;border-width:2px;"></div> 处理中...';
  }

  let pollInterval;
  try {
    showToast('批量处理开始，首次加载模型可能需要稍等片刻...');
    
    pollInterval = setInterval(async () => {
      try {
        await loadFiles();
        if (state.currentView === 'workspace') renderWorkspace();
      } catch (e) {}
    }, 2000);

    const promptTemplate = localStorage.getItem('prompt_template') || '';
    const apiKey = decryptKey(localStorage.getItem('api_key_enc') || localStorage.getItem('api_key'));
    const modelName = localStorage.getItem('model_name') || '';

    await API.batchProcess(promptTemplate, apiKey, modelName);
    await loadFiles();
    showToast('批量处理完成！', 'success');
  } catch (e) {
    showToast(`批量处理失败: ${e.message}`, 'error');
  } finally {
    if (pollInterval) clearInterval(pollInterval);
    state.isProcessing = false;
    await loadFiles();
    if (state.currentView === 'workspace') renderWorkspace();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${ICONS.play} 开始处理`;
    }
  }
}

async function handleDelete(id) {
  if (!confirm('确定删除该文件？')) return;
  try {
    await API.deleteFile(id);
    await loadFiles();
    if (state.currentView === 'workspace') renderWorkspace();
    else if (state.currentView === 'detail' && state.selectedFileId === id) navigate('workspace');
    else renderHome();
    showToast('已删除', 'success');
  } catch (e) {
    showToast(`删除失败: ${e.message}`, 'error');
  }
}

async function handleDeleteAll() {
  const selectedCheckboxes = document.querySelectorAll('.workspace-list .checkbox:checked');
  const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);

  if (selectedIds.length > 0) {
    if (!confirm(`确定删除选中的 ${selectedIds.length} 个文件？`)) return;
    try {
      showToast('正在删除...', 'processing');
      for (const id of selectedIds) {
        await API.deleteFile(id);
      }
      await loadFiles();
      renderWorkspace();
      showToast('删除成功', 'success');
    } catch (e) {
      showToast(`删除失败: ${e.message}`, 'error');
    }
  } else {
    if (!confirm('确定清空所有文件？此操作不可撤销。')) return;
    try {
      showToast('正在清空...', 'processing');
      await API.deleteAll();
      await loadFiles();
      renderWorkspace();
      showToast('已全部清空', 'success');
    } catch (e) {
      showToast(`清空失败: ${e.message}`, 'error');
    }
  }
}

function handleBatchExport() {
  window.open(API.exportBatchUrl(), '_blank');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Settings initialization
  const apiKeyInput = document.getElementById('api-key-input');
  const modelSelect = document.getElementById('model-select');
  const promptInput = document.getElementById('custom-prompt');

  if (apiKeyInput) {
    const savedKey = localStorage.getItem('api_key_enc') || localStorage.getItem('api_key');
    const decryptedKey = decryptKey(savedKey);
    apiKeyInput.value = decryptedKey;
    
    // Clean up old plaintext key if it exists
    if (localStorage.getItem('api_key')) {
      localStorage.setItem('api_key_enc', encryptKey(decryptedKey));
      localStorage.removeItem('api_key');
    }
    
    let timeoutId;
    apiKeyInput.addEventListener('input', e => {
      localStorage.setItem('api_key_enc', encryptKey(e.target.value));
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => loadModels(e.target.value), 800);
    });
  }

  async function loadModels(apiKey) {
    if (!modelSelect) return;
    try {
      const data = await API.listModels(apiKey);
      if (data.models && data.models.length > 0) {
        modelSelect.innerHTML = '';
        data.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name;
          modelSelect.appendChild(opt);
        });
        
        const saved = localStorage.getItem('model_name');
        if (saved && data.models.find(m => m.id === saved)) {
          modelSelect.value = saved;
        } else {
           const has31Flash = data.models.find(m => m.id === 'gemini-3.1-flash');
           const has25Flash = data.models.find(m => m.id === 'gemini-2.5-flash');
           modelSelect.value = has31Flash ? 'gemini-3.1-flash' : (has25Flash ? 'gemini-2.5-flash' : data.models[0].id);
           localStorage.setItem('model_name', modelSelect.value);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch dynamic models:', e);
    }
  }

  if (modelSelect) {
    modelSelect.value = localStorage.getItem('model_name') || 'gemini-2.5-flash';
    modelSelect.addEventListener('change', e => localStorage.setItem('model_name', e.target.value));
    loadModels(apiKeyInput ? apiKeyInput.value : '');
  }

  const defaultPrompt = '你是一位专业的学术助理。请根据以下转录文本，整理出一份极其详实、结构清晰的学习笔记。\n\n笔记必须使用中文编写，包含以下部分：\n- # [主题名称]\n- ## 核心摘要\n- ## 详细知识点\n- ## 关键概念解析\n- ## 行动建议或结论\n\n转录文本：\n{text}';

  if (promptInput) {
    promptInput.value = localStorage.getItem('prompt_template') || defaultPrompt;
    localStorage.setItem('prompt_template', promptInput.value);
    promptInput.addEventListener('input', e => localStorage.setItem('prompt_template', e.target.value));
  }

  const setTemplate = (text, btnId) => {
    if (promptInput) promptInput.value = text;
    localStorage.setItem('prompt_template', text);
    document.querySelectorAll('.prompt-templates .template-btn').forEach(b => b.classList.remove('active'));
    if (btnId) document.getElementById(btnId)?.classList.add('active');
  };

  document.getElementById('tmpl-default')?.addEventListener('click', () => setTemplate(defaultPrompt, 'tmpl-default'));
  document.getElementById('tmpl-academic')?.addEventListener('click', () => setTemplate('请使用严谨的学术风格，重点提取论文引用、研究方法和实证数据，并确保语言客观中立。\n\n转录文本：\n{text}', 'tmpl-academic'));
  document.getElementById('tmpl-business')?.addEventListener('click', () => setTemplate('请作为一位资深的商业顾问，为我提取这段内容的商业价值。\n请在每个章节后增加商业环境下的落地建议、潜在风险及应用方案。\n\n转录文本：\n{text}', 'tmpl-business'));

  // Load data
  await loadFiles();

  // Navigation
  document.getElementById('nav-home').addEventListener('click', () => navigate('home'));
  document.getElementById('nav-workspace').addEventListener('click', () => navigate('workspace'));

  // File upload
  const fileInput = document.getElementById('file-input');
  const uploadZone = document.getElementById('upload-zone');

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', e => { if (e.target.files.length) handleFileUpload(e.target.files); e.target.value = ''; });

  // Header upload button
  document.getElementById('header-upload-btn').addEventListener('click', () => fileInput.click());

  // Bilibili
  document.getElementById('bili-import-btn').addEventListener('click', handleBiliImport);
  document.getElementById('bili-url-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleBiliImport(); });

  // Workspace search & filter
  document.getElementById('workspace-search')?.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderWorkspace();
  });

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.filterStatus = tab.dataset.filter;
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderWorkspace();
    });
  });

  // Workspace actions
  document.getElementById('batch-process-btn')?.addEventListener('click', handleBatchProcess);
  document.getElementById('batch-export-btn')?.addEventListener('click', handleBatchExport);
  document.getElementById('clear-all-btn')?.addEventListener('click', handleDeleteAll);
  document.getElementById('select-all-btn')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.workspace-list .checkbox');
    if (checkboxes.length === 0) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
  });

  // Detail back
  document.getElementById('detail-back-btn')?.addEventListener('click', () => navigate('workspace'));

  // Initial render
  navigate('home');
});
