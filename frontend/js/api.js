/**
 * API client for AudioSense backend.
 * All endpoints return JSON. Base URL is relative (same origin).
 */
const API = {
  // ===== Audio =====
  async uploadAudio(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/audio/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error((await res.json()).detail || '上传失败');
    return res.json();
  },

  async listFiles() {
    const res = await fetch('/api/audio/');
    return res.json();
  },

  async getFile(id) {
    const res = await fetch(`/api/audio/${id}`);
    if (!res.ok) throw new Error('文件不存在');
    return res.json();
  },

  async deleteFile(id) {
    const res = await fetch(`/api/audio/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async deleteAll() {
    const res = await fetch('/api/audio/', { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '清空失败');
    }
    return res.json();
  },

  // ===== Process =====
  async processFile(id, promptTemplate = '', apiKey = '', modelName = '') {
    const res = await fetch(`/api/process/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt_template: promptTemplate, 
        api_key: apiKey || null, 
        model_name: modelName || null 
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '处理失败');
    return res.json();
  },

  async batchProcess(promptTemplate = '', apiKey = '', modelName = '') {
    const res = await fetch('/api/process/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt_template: promptTemplate, 
        api_key: apiKey || null, 
        model_name: modelName || null 
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '批量处理失败');
    return res.json();
  },

  // ===== Models =====
  async listModels(apiKey = '') {
    const res = await fetch('/api/models/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey || null }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '获取模型列表失败');
    return res.json();
  },

  // ===== System Config =====
  async getSystemConfig() {
    const res = await fetch('/api/models/system');
    if (!res.ok) throw new Error('获取系统配置失败');
    return res.json();
  },

  async updateSystemConfig(device, ncpu) {
    const res = await fetch('/api/models/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, ncpu }),
    });
    if (!res.ok) throw new Error('更新系统配置失败');
    return res.json();
  },

  // ===== Process Pause/Resume =====
  async pauseProcessing() {
    const res = await fetch('/api/process/pause', { method: 'POST' });
    if (!res.ok) throw new Error('暂停处理失败');
    return res.json();
  },

  async resumeProcessing() {
    const res = await fetch('/api/process/resume', { method: 'POST' });
    if (!res.ok) throw new Error('恢复处理失败');
    return res.json();
  },

  async getPauseStatus() {
    const res = await fetch('/api/process/status');
    if (!res.ok) throw new Error('获取暂停状态失败');
    return res.json();
  },

  // ===== Bilibili =====
  async importBilibili(url, cid = null) {
    const res = await fetch('/api/bilibili/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cid }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'B站导入失败');
    return res.json();
  },

  // ===== Export =====
  exportSingleUrl(id) {
    return `/api/export/${id}`;
  },

  exportBatchUrl() {
    return '/api/export/batch/zip';
  },
};
