# AudioSense AI - 智能音频学习助手 (v3.0)

> 本地 SenseVoice 转录 + 多 LLM 云端笔记生成 + 用户体系 + 任务管理

## 架构概览

### 技术栈

| 层 | 技术 |
|---|------|
| 后端框架 | Python 3.12+, FastAPI, Uvicorn |
| 数据库 | SQLite + SQLAlchemy 2.0 ORM |
| 本地转录 | SenseVoice-Small (FunASR), CPU 推理, 有 CUDA 时自动启用 GPU |
| 云端 LLM | Gemini / DeepSeek / Qwen / GLM（多 provider 统一路由） |
| 认证 | JWT (HS256) + passlib sha256_crypt |
| 前端 (生产) | 纯 HTML + JS + CSS（frontend/） |
| 前端 (开发) | React 19 + TypeScript + Vite + Tailwind CSS 4（src/） |
| 包管理 | Python: uv/pip; Node: npm |

### 核心模块

```
├── run.py                         # FastAPI 启动入口 (0.0.0.0:3000)
├── server.ts                      # Node/Vite 开发服务器 (React 前端调试)
├── pyproject.toml / uv.lock       # Python 依赖
├── package.json                   # Node 依赖
│
├── backend/
│   ├── main.py                    # 应用工厂: CORS、路由注册、启动迁移、静态文件挂载
│   ├── config.py                  # Pydantic Settings: 所有 LLM/SenseVoice/DB 配置
│   ├── models/
│   │   ├── database.py            # SQLAlchemy 引擎、SessionLocal、init_db()
│   │   ├── orm.py                 # User / AudioFile / TaskGroup 表定义
│   │   └── schemas.py             # Pydantic 请求/响应模型
│   ├── routers/
│   │   ├── auth.py                # 注册、登录、资料管理、密码修改
│   │   ├── audio.py               # 文件 CRUD、任务组 CRUD、批量移动
│   │   ├── process.py             # 转录+LLM 处理流水线（双信号量并发控制、暂停/恢复）
│   │   ├── bilibili.py            # B站导入（字幕快速路径 / 音频慢速路径）
│   │   ├── export.py              # 单文件 Markdown 导出 / 批量 ZIP 导出
│   │   ├── models.py              # LLM 模型列表、SenseVoice 系统配置
│   │   └── admin.py               # 用户管理、系统统计
│   └── services/
│       ├── auth_service.py        # JWT 签发/校验、密码哈希、权限依赖
│       ├── sensevoice_service.py  # SenseVoice 延迟加载单例、transcribe()
│       ├── gemini_service.py      # Gemini SDK 笔记生成
│       ├── llm_service.py         # 多 provider 统一路由 (OpenAI 兼容 + Gemini SDK)
│       └── bilibili_service.py    # B站 API: 视频信息、字幕抓取、DASH 音频下载
│
├── frontend/                      # 生产环境前端 (纯 HTML/JS/CSS)
│   ├── index.html
│   └── js/
│       ├── api.js                 # API 客户端封装
│       └── app.js                 # 应用状态管理、路由、UI 逻辑
│
└── src/                           # 开发环境前端 (React + Vite + Tailwind)
    ├── main.tsx                   # React 入口
    ├── App.tsx                    # 主组件 (文件列表、B站导入、笔记查看器、设置)
    └── index.css                  # Tailwind + 自定义主题 + Markdown 样式
```

### 数据库模型

- **users** — 用户表: username, email, password_hash, role (admin/user), storage_quota
- **audio_files** — 文件表: name, file_path, source_type (file/bili_text/bili_audio), status (idle→transcribing→summarizing→completed/failed), transcription, study_notes, task_id, user_id
- **task_groups** — 任务组表: name, user_id

### 处理流水线

```
idle → transcribing (SenseVoice, 信号量=NCPU) → summarizing (LLM, 信号量=3) → completed
                                                    ↓ (任何阶段)
                                                 failed
```

- **双信号量控制**: 转录和 LLM 调用各自独立限流，防止 CPU 过载和 API 限流
- **暂停/恢复**: 管理员可全局暂停流水线，处理中的任务在检查点等待
- **B站双路径**: 有字幕直接用（零成本），无字幕下载 DASH 音频流转录

### API 端点

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 无 |
| POST | `/api/auth/register` | 注册 | 无 |
| POST | `/api/auth/login` | 登录 (OAuth2) | 无 |
| GET | `/api/auth/me` | 当前用户信息 | Token |
| PUT | `/api/auth/me/profile` | 更新资料 | Token |
| PUT | `/api/auth/me/password` | 修改密码 | Token |
| GET/POST | `/api/audio/tasks` | 任务组列表/创建 | Token |
| DELETE | `/api/audio/tasks/{id}` | 删除任务组 | Token |
| POST | `/api/audio/upload` | 上传音频 | Token |
| GET | `/api/audio/` | 文件列表 (支持 task_id 筛选) | Token |
| GET | `/api/audio/{id}` | 文件详情 | Token |
| DELETE | `/api/audio/{id}` | 删除文件 | Token |
| PUT | `/api/audio/{id}/move` | 移动文件到任务组 | Token |
| POST | `/api/audio/batch/move` | 批量移动 | Token |
| POST | `/api/process/{id}` | 处理单个文件 | Token |
| POST | `/api/process/batch` | 批量处理 | Token |
| POST | `/api/process/pause` | 暂停流水线 | Admin |
| POST | `/api/process/resume` | 恢复流水线 | Admin |
| GET | `/api/process/status` | 暂停状态 | Token |
| POST | `/api/bilibili/import` | B站导入 | Token |
| GET | `/api/export/{id}` | 导出 Markdown | Token |
| GET | `/api/export/batch/zip` | 批量导出 ZIP | Token |
| POST | `/api/models/gemini` | 可用 Gemini 模型列表 | Token |
| GET/POST | `/api/models/system` | SenseVoice 配置 | Token/Admin |
| GET | `/api/admin/users` | 用户列表 | Admin |
| PUT | `/api/admin/users/{id}` | 更新用户 | Admin |
| DELETE | `/api/admin/users/{id}` | 删除用户 | Admin |
| GET | `/api/admin/stats` | 系统统计 | Admin |

## 快速开始

### 1. 环境要求

- Python 3.12+
- Node.js 18+ (仅开发前端时需要)
- 至少 2GB 空闲磁盘 (SenseVoice 模型 ~470MB)

### 2. 安装 Python 依赖

```bash
# 使用 uv (推荐)
uv sync

# 或使用 pip
pip install -r backend/requirements.txt
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少填入一个 LLM API Key
```

主要配置项:

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GEMINI_API_KEY` | — | Gemini API Key (必填其一) |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key |
| `QWEN_API_KEY` | — | 阿里云通义千问 API Key |
| `GLM_API_KEY` | — | 智谱 GLM API Key |
| `JWT_SECRET_KEY` | CHANGE-ME | 生产环境务必修改 |
| `ALLOW_REGISTRATION` | true | 是否允许公开注册 |
| `INVITE_CODE` | — | 注册邀请码 |
| `SENSEVOICE_DEVICE` | cpu | 推理设备 (cpu/cuda) |
| `SENSEVOICE_NCPU` | 8 | 转录并发数 |

### 4. 启动

**生产模式（后端 + 旧版前端）:**
```bash
python run.py
# 访问 http://localhost:3000
```

**开发模式（React 前端）:**
```bash
npm install
npm run dev
# Vite 开发服务器 + API 代理
```

首次启动时 SenseVoice 模型会在第一次转录请求时自动下载 (~470MB)。

## 特性

- **多 LLM Provider**: 支持 Gemini、DeepSeek、Qwen、GLM，前端可切换模型
- **B站导入**: 字幕优先（零成本），音频兜底（自动下载+转录）
- **用户体系**: JWT 认证、角色管理 (admin/user)、存储配额
- **任务组**: 按任务/场景组织文件，支持批量操作
- **导出**: 单文件 Markdown / 批量 ZIP 打包
- **管理面板**: 用户管理、系统统计、流水线控制
- **双前端**: 生产环境纯 HTML 零依赖，开发环境 React 现代化 UI
