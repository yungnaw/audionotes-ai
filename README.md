# AudioSense AI - 智能音频学习助手 (v2.0)

> 本地 SenseVoice 转录 + 云端 Gemini 笔记生成

## 架构

- **本地转录**: SenseVoice-Small (FunASR) — CPU 推理，无需 GPU
- **云端笔记**: Gemini API — 仅发送文本，不传音频
- **B站导入**: 字幕优先，音频兜底
- **数据存储**: SQLite 本地持久化
- **前端**: 纯 HTML + JS + CSS，无框架依赖

## 快速开始

### 1. 安装 Python 依赖

```bash
pip install -r backend/requirements.txt
```

### 2. 配置环境变量

```bash
copy backend\.env.example backend\.env
# 编辑 backend\.env，填入你的 GEMINI_API_KEY
```

### 3. 启动应用

```bash
python run.py
```

首次启动时，SenseVoice 模型会在第一次转录请求时自动下载（~470MB）。

访问 http://localhost:3000

## 目录结构

```
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── config.py             # 配置管理
│   ├── models/               # 数据模型
│   ├── routers/              # API 路由
│   └── services/             # 业务服务
│       ├── sensevoice_service.py  # 本地转录
│       ├── gemini_service.py      # 云端笔记
│       └── bilibili_service.py    # B站导入
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js            # API 客户端
│       └── app.js            # 应用逻辑
└── run.py                    # 启动脚本
```
