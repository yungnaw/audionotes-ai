/**
 * AudioSense AI - Main Application
 * Pure HTML + JS, no framework dependency.
 */

// ===== State =====
const state = {
  files: [],
  tasks: [],
  activeTaskId: 'default',
  workspaceTaskFilterId: 'all',
  currentPage: 1,
  pageSize: parseInt(localStorage.getItem('page_size') || '10'),
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

  // Filter by task group
  if (state.workspaceTaskFilterId !== 'all') {
    filtered = filtered.filter(f => f.task_id === state.workspaceTaskFilterId);
  }

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  // Update pagination elements
  const prevBtn = document.getElementById('page-prev-btn');
  const nextBtn = document.getElementById('page-next-btn');
  const pageInfo = document.getElementById('page-info');

  if (prevBtn) prevBtn.disabled = state.currentPage === 1;
  if (nextBtn) nextBtn.disabled = state.currentPage === totalPages;
  if (pageInfo) pageInfo.textContent = `第 ${state.currentPage} / ${totalPages} 页 (共 ${filtered.length} 条)`;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="status-message">
        ${ICONS.files}
        <h3>暂无文件</h3>
        <p>上传音频或导入B站视频开始使用</p>
      </div>`;
    return;
  }

  const paginatedFiles = filtered.slice((state.currentPage - 1) * state.pageSize, state.currentPage * state.pageSize);

  listEl.innerHTML = paginatedFiles.map(f => {
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
      await API.uploadAudio(file, state.activeTaskId);
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
    const data = await API.importBilibili(url, null, state.activeTaskId);

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
    await API.importBilibili(url, cid, state.activeTaskId);
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
      await API.importBilibili(url, p.cid, state.activeTaskId);
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

    const provider = localStorage.getItem('provider') || 'gemini';
    const promptTemplate = localStorage.getItem('prompt_template') || '';
    const apiKey = decryptKey(localStorage.getItem(`api_key_enc_${provider}`) || localStorage.getItem('api_key_enc') || localStorage.getItem('api_key'));
    const modelName = localStorage.getItem(`model_name_${provider}`) || localStorage.getItem('model_name') || '';

    await API.processFile(id, promptTemplate, apiKey, modelName, provider);
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

    const provider = localStorage.getItem('provider') || 'gemini';
    const promptTemplate = localStorage.getItem('prompt_template') || '';
    const apiKey = decryptKey(localStorage.getItem(`api_key_enc_${provider}`) || localStorage.getItem('api_key_enc') || localStorage.getItem('api_key'));
    const modelName = localStorage.getItem(`model_name_${provider}`) || localStorage.getItem('model_name') || '';

    await API.batchProcess(promptTemplate, apiKey, modelName, provider);
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
  showCustomConfirm('删除确认', '确定删除该文件吗？此操作无法撤销。', async () => {
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
  });
}

async function handleDeleteAll() {
  const selectedCheckboxes = document.querySelectorAll('.workspace-list .checkbox:checked');
  const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);

  if (selectedIds.length > 0) {
    showCustomConfirm('批量删除确认', `确定删除选中的 ${selectedIds.length} 个文件吗？此操作无法撤销。`, async () => {
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
    });
  } else {
    showCustomConfirm('清空所有记录', '确定清空所有文件和记录吗？此操作不可撤销。', async () => {
      try {
        showToast('正在清空...', 'processing');
        await API.deleteAll();
        await loadFiles();
        renderWorkspace();
        showToast('已全部清空', 'success');
      } catch (e) {
        showToast(`清空失败: ${e.message}`, 'error');
      }
    });
  }
}

function handleBatchExport() {
  window.open(API.exportBatchUrl(), '_blank');
}

// ===== Custom Modals =====
function showCustomModal(options) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;

  const { title, contentHtml, onConfirm, onCancel, confirmText = '确定', cancelText = '取消', hideCancel = false } = options;

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
      </div>
      <div class="modal-body" style="padding: 20px;">
        ${contentHtml}
      </div>
      <div class="modal-footer">
        ${hideCancel ? '' : `<button class="btn btn-secondary" id="custom-modal-cancel">${cancelText}</button>`}
        <button class="btn btn-primary" id="custom-modal-confirm" style="${hideCancel ? 'width:100%; justify-content:center;' : ''}">${confirmText}</button>
      </div>
    </div>
  `;
  overlay.classList.remove('hidden');

  const close = () => {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  };

  const confirmBtn = document.getElementById('custom-modal-confirm');
  const cancelBtn = document.getElementById('custom-modal-cancel');

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (onConfirm) onConfirm(close);
      else close();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (onCancel) onCancel(close);
      close();
    });
  }
}

function showCustomPrompt(title, placeholder, onResult) {
  showCustomModal({
    title,
    contentHtml: `<input type="text" id="custom-prompt-input" class="input" style="width: 100%; font-size:14px; padding:10px;" placeholder="${placeholder}">`,
    onConfirm: (close) => {
      const val = document.getElementById('custom-prompt-input').value;
      if (val && val.trim()) {
        onResult(val.trim());
        close();
      }
    }
  });
  setTimeout(() => {
    const input = document.getElementById('custom-prompt-input');
    if (input) input.focus();
  }, 100);
}

function showCustomAlert(title, messageHtml) {
  showCustomModal({
    title,
    contentHtml: messageHtml,
    hideCancel: true,
    confirmText: '我知道了'
  });
}

function showCustomConfirm(title, messageHtml, onConfirm) {
  showCustomModal({
    title,
    contentHtml: `<p style="font-size:14px; color:var(--text-secondary); line-height:1.6;">${messageHtml}</p>`,
    confirmText: '确定',
    cancelText: '取消',
    onConfirm: (close) => {
      onConfirm();
      close();
    }
  });
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Settings initialization (with multi-provider and preset prompt dropdown support)
  const providerSelect = document.getElementById('provider-select');
  const apiKeyLabel = document.getElementById('api-key-label');
  const apiKeyInput = document.getElementById('api-key-input');
  const modelSelect = document.getElementById('model-select');
  const templateSelect = document.getElementById('template-select');
  const promptInput = document.getElementById('custom-prompt');

  const PROVIDER_MODELS = {
    gemini: [
      { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash (谷歌最新推荐/极速版)' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (谷歌最新最强旗舰版)' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
    ],
    openai: [
      { id: 'gpt-5.5-instant', name: 'GPT-5.5 Instant (最新推荐默认版)' },
      { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro (最新多模态旗舰)' },
      { id: 'gpt-5.5-thinking', name: 'GPT-5.5 Thinking (深度推理大模型)' },
      { id: 'gpt-4o', name: 'GPT-4o (经典多模态模型)' }
    ],
    anthropic: [
      { id: 'claude-4-7-opus', name: 'Claude 4.7 Opus (Anthropic 最新顶尖旗舰)' },
      { id: 'claude-4-6-sonnet', name: 'Claude 4.6 Sonnet (最新高性价比主流)' },
      { id: 'claude-4-5-haiku', name: 'Claude 4.5 Haiku (轻量极速版)' },
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (经典推理版)' }
    ],
    deepseek: [
      { id: 'deepseek-v4pro', name: 'DeepSeek-V4Pro (最新旗舰版)' },
      { id: 'deepseek-flash', name: 'DeepSeek-Flash (极速超轻量)' },
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (主流/性价比)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (深度推理/思考)' }
    ],
    qwen: [
      { id: 'qwen-3.6-max', name: 'Qwen-3.6 Max (阿里最新最强旗舰)' },
      { id: 'qwen-3.6-plus', name: 'Qwen-3.6 Plus (最新推荐主流)' },
      { id: 'qwen-2.5-72b-instruct', name: 'Qwen-2.5-72B (经典大模型)' },
      { id: 'qwen-max', name: 'Qwen Max (高效商用版)' },
      { id: 'qwen-plus', name: 'Qwen Plus (高效版)' }
    ],
    glm: [
      { id: 'glm-4-plus', name: 'GLM-4-Plus (最新最强旗舰)' },
      { id: 'glm-4-air', name: 'GLM-4-Air (高速低时延)' },
      { id: 'glm-4-flash', name: 'GLM-4-Flash (免费极速)' }
    ]
  };

  const TEMPLATES = {
    default: '你是一位专业的学术助理。请根据以下转录文本，整理出一份极其详实、结构清晰的学习笔记。\n\n笔记必须使用中文编写，包含以下部分：\n- # [主题名称]（根据内容自动提取）\n- ## 核心摘要（用3-5句话概括全部内容）\n- ## 详细知识点（分章节深入细节，不要遗漏要点，使用 bullet points）\n- ## 关键概念解析（解释专业术语和核心概念）\n- ## 行动建议或结论\n\n转录文本：\n{text}',
    academic: '你是一位资深的学术研究员。请用严谨、客观的学术风格对以下转录内容进行精深整理。\n\n要求：\n1. 重点提炼核心论点、研究方法、实验数据或实证支撑。\n2. 使用学术规范术语，保持中立客观的第三方叙述视角。\n3. 梳理其理论脉络、对前人研究的继承或突破。\n4. 指出其在学术界或行业研究中的应用价值。\n\n转录文本：\n{text}',
    business: '你是一位世界顶尖的商业咨询顾问。请从商业可行性、市场竞争和商业模式创新的角度分析以下内容。\n\n请整理出：\n1. **核心商业价值**：该内容解决的痛点和独特卖点。\n2. **落地可行性路径**：具体的商业执行、技术落地或运营步骤。\n3. **潜在商业风险**：财务、竞争和市场层面的关键风险点及应对措施。\n4. **商业落地建议**：给决策者的关键行动建议。\n\n转录文本：\n{text}',
    meeting: '你是一位极其高效的会议秘书。请将以下对话/会议转录文本整理成专业的会议纪要。\n\n请包含以下清晰板块：\n1. **会议主题与背景概述**：简明扼要介绍讨论核心背景。\n2. **核心议题与决策结论**：逐条记录讨论过的关键议题，以及达成共识的决策（注明谁同意了什么）。\n3. **任务清单与负责人 (Action Items)**：清晰列出待办任务、对应执行人以及预计完成时限。\n4. **遗留未决议题**：记录本次会议未达成共识、需会后跟进或下次讨论的要点。\n\n转录文本：\n{text}',
    concept: '你是一位擅长将复杂技术简单化的金牌科普导师。请对以下转录内容进行细粒度的概念拆解 and 术语普及。\n\n要求：\n1. **核心思维导图概览**：用文本层级结构（Markdown 树状图）勾勒出整体知识框架。\n2. **关键术语深度拆解**：列出文本中出现的所有专业词汇、前沿概念，用极其白话（并配以生活中的类比）解释其含义。\n3. **底层原理透视**：说明这些概念是如何配合运行的，背后的工作原理是什么。\n4. **一句话金句总结**：用一句话精辟概括该主题最精髓的内涵。\n\n转录文本：\n{text}'
  };

  // Populate provider from localStorage
  let currentProvider = localStorage.getItem('provider') || 'gemini';
  if (providerSelect) {
    providerSelect.value = currentProvider;
    providerSelect.addEventListener('change', e => {
      currentProvider = e.target.value;
      localStorage.setItem('provider', currentProvider);
      updateProviderUI();
    });
  }

  // Backwards compatibility for old API key
  if (localStorage.getItem('api_key') || localStorage.getItem('api_key_enc')) {
    const oldKey = decryptKey(localStorage.getItem('api_key_enc') || localStorage.getItem('api_key'));
    if (oldKey && !localStorage.getItem('api_key_enc_gemini')) {
      localStorage.setItem('api_key_enc_gemini', encryptKey(oldKey));
    }
  }

  function updateProviderUI() {
    if (!apiKeyLabel || !apiKeyInput || !modelSelect) return;

    // 1. Update Labels and inputs
    const providerNames = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', qwen: 'Qwen', glm: 'GLM' };
    const pName = providerNames[currentProvider] || currentProvider;
    apiKeyLabel.textContent = `${pName} API Key (默认使用服务端配置)`;
    apiKeyInput.placeholder = `输入你自己的 ${pName} API Key (可选)`;

    // 2. Load decrypted key for current provider
    const savedKey = localStorage.getItem(`api_key_enc_${currentProvider}`) || '';
    apiKeyInput.value = decryptKey(savedKey);

    // 3. Populate model selection options
    populateModels();
  }

  function populateModels() {
    if (!modelSelect) return;
    modelSelect.innerHTML = '';
    const models = PROVIDER_MODELS[currentProvider] || [];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });

    const savedModel = localStorage.getItem(`model_name_${currentProvider}`);
    if (savedModel && models.find(m => m.id === savedModel)) {
      modelSelect.value = savedModel;
    } else if (models.length > 0) {
      modelSelect.value = models[0].id;
      localStorage.setItem(`model_name_${currentProvider}`, modelSelect.value);
    }
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', e => {
      const val = e.target.value.trim();
      localStorage.setItem(`api_key_enc_${currentProvider}`, encryptKey(val));
      if (currentProvider === 'gemini') {
        clearTimeout(apiKeyInput.timeoutId);
        apiKeyInput.timeoutId = setTimeout(() => loadGeminiModelsDynamically(val), 800);
      }
    });
  }

  async function loadGeminiModelsDynamically(apiKey) {
    if (currentProvider !== 'gemini' || !modelSelect) return;
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
        const saved = localStorage.getItem('model_name_gemini') || localStorage.getItem('model_name');
        if (saved && data.models.find(m => m.id === saved)) {
          modelSelect.value = saved;
        } else {
          const has25Flash = data.models.find(m => m.id === 'gemini-2.5-flash');
          modelSelect.value = has25Flash ? 'gemini-2.5-flash' : data.models[0].id;
          localStorage.setItem('model_name_gemini', modelSelect.value);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch dynamic Gemini models:', e);
    }
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', e => {
      localStorage.setItem(`model_name_${currentProvider}`, e.target.value);
    });
  }

  // Template select dropdown initialization
  if (templateSelect && promptInput) {
    const savedTemplateVal = localStorage.getItem('selected_template_type') || 'default';
    templateSelect.value = savedTemplateVal;

    promptInput.value = localStorage.getItem('prompt_template') || TEMPLATES.default;
    localStorage.setItem('prompt_template', promptInput.value);

    templateSelect.addEventListener('change', e => {
      const type = e.target.value;
      localStorage.setItem('selected_template_type', type);
      const text = TEMPLATES[type] || TEMPLATES.default;
      promptInput.value = text;
      localStorage.setItem('prompt_template', text);
      showToast('提示词模板已切换', 'success');
    });

    promptInput.addEventListener('input', e => {
      localStorage.setItem('prompt_template', e.target.value);
    });
  }

  // Initial update
  updateProviderUI();
  if (currentProvider === 'gemini' && apiKeyInput) {
    loadGeminiModelsDynamically(apiKeyInput.value);
  }

  // Load data
  await loadFiles();

  // Navigation
  document.getElementById('nav-home').addEventListener('click', () => navigate('home'));
  document.getElementById('nav-workspace').addEventListener('click', () => {
    if (state.currentView === 'workspace') {
      navigate('home');
    } else {
      navigate('workspace');
    }
  });

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
  document.getElementById('header-upload-btn')?.addEventListener('click', () => fileInput.click());

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

  // ===== Local Transcription Settings (SenseVoice) Initialization =====
  const devCpuBtn = document.getElementById('device-cpu');
  const devCudaBtn = document.getElementById('device-cuda');
  const cudaWarning = document.getElementById('cuda-warning');
  const threadsInput = document.getElementById('threads-input');
  const threadsVal = document.getElementById('threads-val');

  let currentDevice = 'cpu';
  let currentNcpu = 8;
  let isCudaAvailable = false;

  async function initSystemConfig() {
    if (!devCpuBtn || !devCudaBtn) return;
    try {
      const config = await API.getSystemConfig();
      currentDevice = config.device || 'cpu';
      currentNcpu = config.ncpu || 8;
      isCudaAvailable = config.cuda_available || false;

      // Update UI
      updateDeviceUI(currentDevice);
      if (threadsInput) {
        threadsInput.value = currentNcpu;
        threadsVal.textContent = currentNcpu;
      }
      if (!isCudaAvailable && cudaWarning) {
        cudaWarning.style.display = 'block';
      }
    } catch (e) {
      console.error('Failed to initialize system config:', e);
    }
  }

  function updateDeviceUI(device) {
    if (device === 'cpu') {
      devCpuBtn.classList.add('active');
      devCudaBtn.classList.remove('active');
    } else {
      devCudaBtn.classList.add('active');
      devCpuBtn.classList.remove('active');
    }
  }

  async function handleUpdateSystem(device, ncpu) {
    try {
      await API.updateSystemConfig(device, ncpu);
      currentDevice = device;
      currentNcpu = ncpu;
      updateDeviceUI(device);
      showToast('系统配置已更新并应用', 'success');
    } catch (e) {
      showToast('系统配置更新失败', 'error');
    }
  }

  if (devCpuBtn && devCudaBtn) {
    devCpuBtn.addEventListener('click', () => {
      handleUpdateSystem('cpu', currentNcpu);
    });

    devCudaBtn.addEventListener('click', () => {
      if (!isCudaAvailable) {
        showCustomAlert('检测到 CUDA 环境未正确安装', `
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px; line-height:1.6;">
            您的 Python 环境尚未正确安装 CUDA 支持库，或您的设备没有 NVIDIA 显卡。若要使用 GPU，请在当前环境运行清华加速源安装（可直接复制下面命令）：
          </p>
          <pre style="background:var(--bg-tertiary); padding:12px; border-radius:6px; border:1px solid var(--border); font-family:var(--font-mono); font-size:12px; color:var(--text-primary); user-select:all; cursor:text; white-space:pre-wrap; word-break:break-all;">uv pip install torch torchaudio -f https://mirrors.tuna.tsinghua.edu.cn/pytorch-wheels/cu121/ --force-reinstall</pre>
        `);
      }
      handleUpdateSystem('cuda', currentNcpu);
    });
  }

  if (threadsInput) {
    threadsInput.addEventListener('input', e => {
      if (threadsVal) threadsVal.textContent = e.target.value;
    });

    threadsInput.addEventListener('change', e => {
      handleUpdateSystem(currentDevice, parseInt(e.target.value));
    });
  }

  initSystemConfig();

  // ===== Global Pause/Resume Processing =====
  let isPaused = false;

  async function syncPauseStatus() {
    try {
      const res = await API.getPauseStatus();
      isPaused = res.paused;
      updatePauseButtonUI();
    } catch (e) {
      console.error('Failed to sync pause status:', e);
    }
  }

  function updatePauseButtonUI() {
    const pauseBtn = document.getElementById('global-pause-btn');
    const pauseText = document.getElementById('pause-btn-text');
    if (!pauseBtn || !pauseText) return;

    if (isPaused) {
      pauseBtn.style.background = '#059669'; // 绿色
      pauseBtn.style.borderColor = '#059669';
      pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg> <span id="pause-btn-text">恢复处理</span>`;
    } else {
      pauseBtn.style.background = '#e11d48'; // 红色
      pauseBtn.style.borderColor = '#e11d48';
      pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> <span id="pause-btn-text">暂停处理</span>`;
    }
  }

  document.getElementById('global-pause-btn')?.addEventListener('click', async () => {
    try {
      if (isPaused) {
        await API.resumeProcessing();
        isPaused = false;
        showToast('转录与处理流程已恢复执行', 'success');
      } else {
        await API.pauseProcessing();
        isPaused = true;
        showToast('流程已暂停（正在进行中的步骤结束后将自动挂起）', 'warning');
      }
      updatePauseButtonUI();
    } catch (e) {
      showToast('控制暂停状态失败', 'error');
    }
  });

  syncPauseStatus();

  // ===== Task Groups & Pagination Handlers =====
  const activeTaskSelect = document.getElementById('active-task-select');
  const createTaskBtn = document.getElementById('create-task-btn');
  const deleteTaskBtn = document.getElementById('delete-task-btn');
  const workspaceTaskFilter = document.getElementById('workspace-task-filter');

  const pagePrevBtn = document.getElementById('page-prev-btn');
  const pageNextBtn = document.getElementById('page-next-btn');
  const pageSizeSelect = document.getElementById('page-size-select');

  async function loadTasks() {
    try {
      const tasks = await API.listTasks();
      state.tasks = tasks;
      renderTaskSelects();
    } catch (e) {
      console.error('Failed to load tasks:', e);
    }
  }

  function triggerDeleteActiveTask() {
    if (state.activeTaskId === 'default') return;
    showCustomConfirm('删除当前场景', '确定删除当前任务场景？<br><br>该场景下的所有音频和笔记将会被重置为“默认任务”。此操作无法撤销。', async () => {
      try {
        await API.deleteTask(state.activeTaskId);
        showToast('任务场景已成功删除', 'success');
        state.activeTaskId = 'default';
        await loadTasks();
        await loadFiles();
        if (state.currentView === 'workspace') renderWorkspace();
        else renderHome();
      } catch (e) {
        showToast(e.message, 'error');
        if (activeTaskSelect) activeTaskSelect.value = state.activeTaskId;
      }
    });
  }

  function renderTaskSelects() {
    if (activeTaskSelect) {
      let optionsHtml = state.tasks.map(t => `
        <option value="${t.id}">${t.name}</option>
      `).join('');
      if (state.activeTaskId !== 'default') {
        optionsHtml += `<option value="__delete_active__" style="color:var(--danger); background-color: var(--bg-card);">❌ 删除当前场景</option>`;
      }
      activeTaskSelect.innerHTML = optionsHtml;
      activeTaskSelect.value = state.activeTaskId;
    }

    if (workspaceTaskFilter) {
      workspaceTaskFilter.innerHTML = `
        <option value="all">全部场景</option>
        ` + state.tasks.map(t => `
        <option value="${t.id}">${t.name}</option>
      `).join('');
      workspaceTaskFilter.value = state.workspaceTaskFilterId;
    }

    // Toggle delete button visibility
    if (deleteTaskBtn) {
      deleteTaskBtn.style.display = 'none';
    }
  }

  if (activeTaskSelect) {
    activeTaskSelect.addEventListener('change', e => {
      const val = e.target.value;
      if (val === '__delete_active__') {
        activeTaskSelect.value = state.activeTaskId;
        triggerDeleteActiveTask();
        return;
      }
      state.activeTaskId = val;
      renderTaskSelects();
    });
  }

  if (createTaskBtn) {
    createTaskBtn.addEventListener('click', () => {
      showCustomPrompt('新建任务场景', '请输入新任务分类/工作场景的名称', async (name) => {
        try {
          const newTask = await API.createTask(name);
          showToast(`任务场景 "${newTask.name}" 创建成功`, 'success');
          state.activeTaskId = newTask.id;
          await loadTasks();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
  }

  // deleteTaskBtn is integrated in the dropdown

  if (workspaceTaskFilter) {
    workspaceTaskFilter.addEventListener('change', e => {
      state.workspaceTaskFilterId = e.target.value;
      state.currentPage = 1;
      renderWorkspace();
    });
  }

  // Pagination Event Listeners
  if (pagePrevBtn) {
    pagePrevBtn.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        renderWorkspace();
      }
    });
  }

  if (pageNextBtn) {
    pageNextBtn.addEventListener('click', () => {
      state.currentPage++;
      renderWorkspace();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.value = state.pageSize.toString();
    pageSizeSelect.addEventListener('change', e => {
      state.pageSize = parseInt(e.target.value);
      localStorage.setItem('page_size', e.target.value);
      state.currentPage = 1;
      renderWorkspace();
    });
  }

  // Load tasks on init
  await loadTasks();

  // Initial render
  navigate('home');
});
