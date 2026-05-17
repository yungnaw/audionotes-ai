/**
 * API client for AudioNotes AI backend.
 * All endpoints return JSON. Base URL is relative (same origin).
 * Automatically attaches Bearer token to every request.
 */
const API = {
  // ===== Internal helper =====
  _authHeaders(extra = {}) {
    const token = localStorage.getItem('auth_token');
    return {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...extra,
    };
  },

  async _fetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
      // Token expired — trigger re-login
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      showAuthModal?.('login');
      throw new Error('登录已过期，请重新登录');
    }
    return res;
  },

  // ===== Auth =====
  async login(username, password) {
    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!res.ok) throw new Error((await res.json()).detail || '登录失败');
    return res.json();
  },

  async register({ username, password, email, invite_code }) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email, invite_code }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '注册失败');
    return res.json();
  },

  async getMe() {
    const res = await this._fetch('/api/auth/me', {
      headers: this._authHeaders(),
    });
    if (!res.ok) throw new Error('获取用户信息失败');
    return res.json();
  },

  async changePassword(oldPassword, newPassword) {
    const res = await this._fetch('/api/auth/me/password', {
      method: 'PUT',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '密码修改失败');
    return res.json();
  },

  async updateProfile(profileData) {
    const res = await this._fetch('/api/auth/me/profile', {
      method: 'PUT',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(profileData),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '更新资料失败');
    return res.json();
  },

  // ===== Audio =====
  async uploadAudio(file, taskId = 'default') {
    const form = new FormData();
    form.append('file', file);
    const res = await this._fetch(`/api/audio/upload?task_id=${encodeURIComponent(taskId)}`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error((await res.json()).detail || '上传失败');
    return res.json();
  },

  async listFiles(taskId = '') {
    const url = taskId ? `/api/audio/?task_id=${encodeURIComponent(taskId)}` : '/api/audio/';
    const res = await this._fetch(url, { headers: this._authHeaders() });
    return res.json();
  },

  async getFile(id) {
    const res = await this._fetch(`/api/audio/${id}`, { headers: this._authHeaders() });
    if (!res.ok) throw new Error('文件不存在');
    return res.json();
  },

  async moveFile(id, taskId) {
    const res = await this._fetch(`/api/audio/${id}/move`, {
      method: 'PUT',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ task_id: taskId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '移动场景失败');
    }
    return res.json();
  },

  async updateFilePrompt(id, customPrompt) {
    const res = await this._fetch(`/api/audio/${id}/prompt`, {
      method: 'PUT',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ custom_prompt: customPrompt }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '更新提示词失败');
    return res.json();
  },

  async batchMoveFiles(ids, taskId) {
    const res = await this._fetch('/api/audio/batch/move', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ file_ids: ids, task_id: taskId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '批量移动场景失败');
    }
    return res.json();
  },

  async deleteFile(id) {
    const res = await this._fetch(`/api/audio/${id}`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async deleteAll() {
    const res = await this._fetch('/api/audio/', {
      method: 'DELETE',
      headers: this._authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '清空失败');
    }
    return res.json();
  },

  // ===== Process =====
  async processFile(id, promptTemplate = '', apiKey = '', modelName = '', provider = 'gemini', baseUrl = '') {
    const res = await this._fetch(`/api/process/${id}`, {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prompt_template: promptTemplate,
        provider: provider,
        api_key: apiKey || null,
        model_name: modelName || null,
        base_url: baseUrl || null,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '处理失败');
    return res.json();
  },

  async batchProcess(promptTemplate = '', apiKey = '', modelName = '', provider = 'gemini', baseUrl = '') {
    const res = await this._fetch('/api/process/batch', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prompt_template: promptTemplate,
        provider: provider,
        api_key: apiKey || null,
        model_name: modelName || null,
        base_url: baseUrl || null,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '批量处理失败');
    return res.json();
  },

  // ===== Models =====
  async listModels(apiKey = '') {
    const res = await this._fetch('/api/models/gemini', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ api_key: apiKey || null }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '获取模型列表失败');
    return res.json();
  },

  // ===== System Config =====
  async getSystemConfig() {
    const res = await this._fetch('/api/models/system', { headers: this._authHeaders() });
    if (!res.ok) throw new Error('获取系统配置失败');
    return res.json();
  },

  async updateSystemConfig(device, ncpu, summaryConcurrency = null) {
    const res = await this._fetch('/api/models/system', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ device, ncpu, summary_concurrency: summaryConcurrency }),
    });
    if (!res.ok) throw new Error('更新系统配置失败');
    return res.json();
  },

  // ===== Process Pause/Resume =====
  async pauseProcessing() {
    const res = await this._fetch('/api/process/pause', {
      method: 'POST',
      headers: this._authHeaders(),
    });
    if (!res.ok) throw new Error('暂停处理失败');
    return res.json();
  },

  async resumeProcessing() {
    const res = await this._fetch('/api/process/resume', {
      method: 'POST',
      headers: this._authHeaders(),
    });
    if (!res.ok) throw new Error('恢复处理失败');
    return res.json();
  },

  async getPauseStatus() {
    const res = await this._fetch('/api/process/status', { headers: this._authHeaders() });
    if (!res.ok) throw new Error('获取暂停状态失败');
    return res.json();
  },

  // ===== Bilibili =====
  async importBilibili(url, cid = null, taskId = 'default') {
    const res = await this._fetch('/api/bilibili/import', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url, cid, task_id: taskId }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'B站导入失败');
    return res.json();
  },

  // ===== Export =====
  exportSingleUrl(id, includeTranscription = false) {
    const token = localStorage.getItem('auth_token');
    // Append token as query param for direct download links
    return `/api/export/${id}?token=${encodeURIComponent(token || '')}&include_transcription=${includeTranscription}`;
  },

  exportBatchUrl(includeTranscription = false) {
    const token = localStorage.getItem('auth_token');
    return `/api/export/batch/zip?token=${encodeURIComponent(token || '')}&include_transcription=${includeTranscription}`;
  },

  // ===== Task Groups =====
  async listTasks() {
    const res = await this._fetch('/api/audio/tasks', { headers: this._authHeaders() });
    if (!res.ok) throw new Error('获取任务分类失败');
    return res.json();
  },

  async createTask(name) {
    const res = await this._fetch('/api/audio/tasks', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '新建任务分类失败');
    return res.json();
  },

  async deleteTask(id) {
    const res = await this._fetch(`/api/audio/tasks/${id}`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '删除任务分类失败');
    return res.json();
  },

  // ===== Prompt Templates =====
  async listPromptTemplates() {
    const res = await this._fetch('/api/prompts', { headers: this._authHeaders() });
    if (!res.ok) throw new Error('获取提示词模板失败');
    return res.json();
  },

  async createPromptTemplate(name, content) {
    const res = await this._fetch('/api/prompts', {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, content }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '保存模板失败');
    return res.json();
  },

  async updatePromptTemplate(id, data) {
    const res = await this._fetch(`/api/prompts/${id}`, {
      method: 'PUT',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '更新模板失败');
    return res.json();
  },

  async deletePromptTemplate(id) {
    const res = await this._fetch(`/api/prompts/${id}`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '删除模板失败');
    return res.json();
  },

  // ===== Admin =====
  async adminListUsers() {
    const res = await this._fetch('/api/admin/users', { headers: this._authHeaders() });
    if (!res.ok) throw new Error((await res.json()).detail || '获取用户列表失败');
    return res.json();
  },

  async adminUpdateUser(userId, updates) {
    const res = await this._fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '更新用户失败');
    return res.json();
  },

  async adminGetStats() {
    const res = await this._fetch('/api/admin/stats', { headers: this._authHeaders() });
    if (!res.ok) throw new Error('获取统计数据失败');
    return res.json();
  },
};
