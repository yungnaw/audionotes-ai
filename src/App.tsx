/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileAudio, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  BookOpen, 
  FileText,
  ChevronRight,
  ChevronLeft,
  Download,
  Trash2,
  Clock,
  AudioLines,
  Maximize2,
  X,
  MessageSquareText,
  Sparkles,
  Files
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import JSZip from 'jszip';

// --- Types ---

enum ProcessStatus {
  IDLE = 'idle',
  UPLOADING = 'uploading',
  TRANSCRIBING = 'transcribing',
  SUMMARIZING = 'summarizing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

interface AudioFile {
  id: string;
  file?: File;
  name: string;
  size: string;
  status: ProcessStatus;
  progress: number;
  transcription?: string;
  studyNotes?: string;
  error?: string;
  sourceType?: 'file' | 'bili_text';
}

// --- Constants ---

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB for Gemini inline data
const ALLOWED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/m4a', 'audio/ogg'];

// --- Utility: File Size Formatter ---
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// --- Gemini AI Setup ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export default function App() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [biliUrl, setBiliUrl] = useState('');
  const [isBiliLoading, setIsBiliLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fullScreenView, setFullScreenView] = useState<'notes' | 'transcription' | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [biliMultiP, setBiliMultiP] = useState<{ title: string, bvid: string, pages: any[] } | null>(null);
  const [selectedCids, setSelectedCids] = useState<number[]>([]);
  const [device, setDevice] = useState<'cpu' | 'cuda'>('cpu');
  const [ncpu, setNcpu] = useState<number>(8);
  const [cudaAvailable, setCudaAvailable] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/models/system')
      .then(res => res.json())
      .then(data => {
        setDevice(data.device || 'cpu');
        setNcpu(data.ncpu || 8);
        setCudaAvailable(data.cuda_available || false);
      })
      .catch(err => console.error("Failed to load system config:", err));
  }, []);

  const handleUpdateSystemConfig = (newDevice: 'cpu' | 'cuda', newNcpu: number) => {
    setDevice(newDevice);
    setNcpu(newNcpu);
    fetch('/api/models/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: newDevice, ncpu: newNcpu })
    })
      .then(res => res.json())
      .catch(err => console.error("Failed to update system config:", err));
  };

  useEffect(() => {
    if (biliMultiP) {
      setSelectedCids(biliMultiP.pages.map(p => p.cid));
    } else {
      setSelectedCids([]);
    }
  }, [biliMultiP]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFile = files.find(f => f.id === selectedFileId);

  // --- Handlers ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    addFiles(selectedFiles);
  };

  const addFiles = (newFiles: File[]) => {
    const validFiles = newFiles
      .filter(file => {
        const isAudioType = file.type.startsWith('audio/') || ALLOWED_TYPES.includes(file.type);
        const isAudioExt = /\.(mp3|wav|m4a|mp4|ogg|aac|m4s)$/i.test(file.name);
        
        if (!isAudioType && !isAudioExt) {
          alert(`不支持的文件类型: ${file.name}`);
          return false;
        }
        return true;
      })
      .map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        file,
        name: file.name,
        size: formatFileSize(file.size),
        status: ProcessStatus.IDLE,
        progress: 0,
      }));

    setFiles(prev => [...prev, ...validFiles]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    if (selectedFileId === id) setSelectedFileId(null);
  };

  const startBatchProcess = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    const pendingFiles = files.filter(f => f.status === ProcessStatus.IDLE || f.status === ProcessStatus.FAILED);
    
    for (const audioFile of pendingFiles) {
      await processSingleFile(audioFile.id);
    }

    setIsProcessing(false);
  };

  const processSingleFile = async (id: string) => {
    const audioFile = files.find(f => f.id === id);
    if (!audioFile) return;

    try {
      if (audioFile.sourceType === 'bili_text' && audioFile.transcription) {
        // 极速模式：直接处理文本
        updateFileStatus(id, ProcessStatus.SUMMARIZING, 50);
        
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `
            你是一位专业的学术助理。请根据以下从视频中提取的字幕内容，整理出一份极其详实、结构清晰的学习笔记。
            
            ${customPrompt ? `用户特别要求：${customPrompt}` : ''}

            笔记必须使用中文编写，包含以下部分：
            - # [主题名称]
            - ## 核心摘要 (概括主要内容)
            - ## 详细知识点 (分章节深入细节，不要遗漏要点)
            - ## 关键概念解析
            - ## 动作建议或结论
            
            字幕内容如下：
            ${audioFile.transcription}
          `
        });

        updateFileStatus(id, ProcessStatus.COMPLETED, 100, {
          studyNotes: result.text?.trim()
        });
        return;
      }

      // 普通模式：处理音频文件
      if (!audioFile.file) return;
      updateFileStatus(id, ProcessStatus.UPLOADING, 10);
      
      const base64Data = await fileToBase64(audioFile.file);
      updateFileStatus(id, ProcessStatus.TRANSCRIBING, 30);

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: audioFile.file.type || 'audio/mpeg',
                  data: base64Data
                }
              },
              {
                text: `You are an expert academic assistant. 
                Tasks:
                1. Transcribe this audio accurately.
                2. Create a comprehensive, well-structured study guide based on the transcription.
                
                ${customPrompt ? `Special User Requirements: ${customPrompt}` : ''}

                The study guide MUST be written in Chinese and include:
                - # [Topic Name]
                - ## 核心摘要 (Core Summary)
                - ## 详细笔记 (Detailed Notes) - with bullet points and sub-sections.
                - ## 关键概念 & 定义 (Key Concepts)
                - ## 动作建议/结论 (Takeaways)
                
                Please separate the transcription and the study guide clearly using a marker like "---TRANSCRIPTION_START---" and "---STUDY_NOTES_START---".`
              }
            ]
          }
        ]
      });

      const responseText = result.text || '';
      const transcriptionPart = responseText.split('---TRANSCRIPTION_START---')[1]?.split('---STUDY_NOTES_START---')[0] || '';
      const notesPart = responseText.split('---STUDY_NOTES_START---')[1] || responseText;

      updateFileStatus(id, ProcessStatus.COMPLETED, 100, {
        transcription: transcriptionPart.trim(),
        studyNotes: notesPart.trim()
      });

    } catch (error: any) {
      console.error("AI Processing Error:", error);
      updateFileStatus(id, ProcessStatus.FAILED, 0, { error: error.message || '处理失败，请检查文件。' });
    }
  };

  const updateFileStatus = (id: string, status: ProcessStatus, progress: number, extra = {}) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status, progress, ...extra } : f));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const downloadNotes = (file: AudioFile) => {
    if (!file.studyNotes) return;
    const blob = new Blob([file.studyNotes], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.split('.')[0]}_学习笔记.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBatchExport = async () => {
    const completedFiles = files.filter(f => f.status === ProcessStatus.COMPLETED && f.studyNotes);
    if (completedFiles.length === 0) {
      alert("没有已完成的笔记可供导出。");
      return;
    }

    if (completedFiles.length === 1) {
      downloadNotes(completedFiles[0]);
      return;
    }

    try {
      const zip = new JSZip();
      
      completedFiles.forEach(file => {
        // Clean up filename to remove some special characters that might break zip
        const safeName = file.name.replace(/[\\/:*?"<>|]/g, '_').split('.')[0];
        const fileName = `${safeName}_学习笔记.md`;
        zip.file(fileName, file.studyNotes!);
      });

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AudioSense_笔记批量导出_${new Date().toLocaleDateString()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Batch export failed:", error);
      alert("批量导出失败，请重试。");
    }
  };

  const handleBiliImport = async (cid?: number) => {
    if (!biliUrl) return;
    setIsBiliLoading(true);
    try {
      const urlWithCid = cid ? `${biliUrl}&cid=${cid}` : biliUrl;
      const res = await fetch(`/api/bilibili?url=${encodeURIComponent(urlWithCid)}${cid ? `&cid=${cid}` : ''}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.type === 'list') {
        // 多 P 视频，打开选择器
        setBiliMultiP(data);
        return;
      }

      if (data.type === 'text') {
        // 快速路径：已有字幕
        const newFile: AudioFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: `[B站字幕] ${data.title}`,
          size: "文字内容",
          status: ProcessStatus.IDLE,
          progress: 0,
          transcription: data.content,
          sourceType: 'bili_text'
        };
        setFiles(prev => [...prev, newFile]);
      } else {
        // 慢速路径：需要下载音频
        const byteCharacters = atob(data.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: data.mimeType });
        const file = new File([blob], `${data.title}.mp4`, { type: data.mimeType });

        const newFile: AudioFile = {
          id: Math.random().toString(36).substr(2, 9),
          file,
          name: `[B站音频] ${data.title}`,
          size: formatFileSize(file.size),
          status: ProcessStatus.IDLE,
          progress: 0,
          sourceType: 'file'
        };
        setFiles(prev => [...prev, newFile]);
      }
      setBiliUrl('');
      setBiliMultiP(null);
    } catch (err: any) {
      alert("Bilibili 导入失败: " + (err.message || "由于B站限制，暂时无法获取内容。"));
    } finally {
      setIsBiliLoading(false);
    }
  };

  const importSpecificPages = async (selectedPages: any[]) => {
    setIsBiliLoading(true);
    setBiliMultiP(null);
    try {
      for (const page of selectedPages) {
        await handleBiliImport(page.cid);
      }
      setBiliUrl('');
    } finally {
      setIsBiliLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-300 font-sans selection:bg-zinc-800">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-zinc-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-100 flex items-center justify-center text-zinc-900 font-bold text-lg">
            A
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight text-zinc-100">AudioSense</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">智能音频学习助手</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Chatbot Toggle Button */}
          <button 
            onClick={() => setShowPromptSettings(!showPromptSettings)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
              showPromptSettings 
              ? 'bg-zinc-100 text-zinc-900 border-zinc-100 shadow-[0_0_15px_rgba(255,255,255,0.15)]' 
              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:border-zinc-700'
            }`}
          >
            <MessageSquareText size={16} />
            <span className="text-xs font-bold">系统与偏好设置</span>
            {showPromptSettings ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
          
          <div className="h-6 w-px bg-zinc-800 mx-2" />

          <button 
            onClick={handleBatchExport}
            disabled={!files.some(f => f.status === ProcessStatus.COMPLETED)}
            className="text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 px-3 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Files size={16} />
            批量导出
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            <Upload size={16} />
            上传文件
          </button>

          <div className="pl-3">
            <button 
              onClick={startBatchProcess}
              disabled={isProcessing || !files.some(f => f.status === ProcessStatus.IDLE)}
              className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
                isProcessing || !files.some(f => f.status === ProcessStatus.IDLE)
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-zinc-100 text-zinc-900 hover:bg-white active:scale-95 shadow-[0_4px_14px_0_rgba(255,255,255,0.1)] hover:shadow-[0_6px_20px_rgba(255,255,255,0.15)]'
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  正在处理...
                </span>
              ) : '+ 开始转换'}
            </button>
          </div>
        </div>
      </header>

      <main className={`max-w-[1440px] mx-auto grid grid-cols-1 h-[calc(100vh-76px)] overflow-hidden transition-all duration-500 ease-in-out ${
        showPromptSettings ? 'md:grid-cols-[320px,1fr,460px]' : 'md:grid-cols-[320px,1fr,0px]'
      }`}>
        {/* Sidebar: File List */}
        <aside className="border-r border-zinc-800 bg-[#0d0d0d] overflow-y-auto p-6 flex flex-col gap-6">
          {/* Bilibili Import Section */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Bilibili 导入</h2>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="输入 B 站视频链接..."
                value={biliUrl}
                onChange={(e) => setBiliUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBiliImport()}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500 transition-colors"
                disabled={isBiliLoading}
              />
              <button 
                onClick={() => handleBiliImport()}
                disabled={isBiliLoading || !biliUrl}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 px-3 py-1.5 rounded text-xs font-bold transition-colors"
              >
                {isBiliLoading ? <Loader2 size={14} className="animate-spin" /> : "导入"}
              </button>
            </div>
            <p className="text-[9px] text-zinc-600">支持 BV 号或视频完整链接</p>
          </div>

          <div className="flex items-center justify-between pb-3 mt-4 border-b border-zinc-900">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-widest pl-1">我的资源库 <span className="opacity-60 font-mono ml-1">({files.length})</span></h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setFiles([])}
                className="p-1.5 hover:bg-rose-500/10 rounded-md text-zinc-500 hover:text-rose-400 transition-colors"
                title="清除所有"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {files.length === 0 ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 flex-1 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800/60 bg-zinc-900/10 rounded-2xl p-8 cursor-pointer hover:border-zinc-500 hover:bg-zinc-900/40 transition-all group"
            >
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg text-zinc-500 group-hover:text-zinc-100 mb-4 transition-colors">
                <Upload size={24} />
              </div>
              <p className="text-xs font-medium text-center text-zinc-400">点击或拖拽音频文件到此处</p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {files.map((file) => (
                  <motion.div
                    key={file.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => setSelectedFileId(file.id)}
                    className={`p-3 rounded-lg cursor-pointer border transition-all ${
                      selectedFileId === file.id 
                      ? 'bg-zinc-800/50 border-zinc-700 shadow-sm' 
                      : 'bg-transparent border-transparent hover:bg-zinc-900 hover:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        file.status === ProcessStatus.COMPLETED ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                        file.status === ProcessStatus.FAILED ? 'bg-rose-500' :
                        file.status === ProcessStatus.IDLE ? 'bg-zinc-700' : 'bg-blue-500 animate-pulse'
                      }`} />
                      
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-sm font-medium truncate ${selectedFileId === file.id ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-300'}`}>
                          {file.name}
                        </h3>
                      </div>
                      
                      {selectedFileId === file.id && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                          className="p-1 text-zinc-600 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </aside>

        {/* Main Content: Viewer */}
        <section className="bg-[#0a0a0a] overflow-y-auto flex flex-col">
          {selectedFile ? (
            <>
              {/* Batch/File header info bar */}
              <div className="p-6 bg-zinc-900/30 border-b border-zinc-800 flex items-center gap-6">
                <div className="flex-1">
                  <div className="flex justify-between mb-2 text-[10px] font-bold uppercase tracking-widest">
                    <span className="text-zinc-500">处 理 进 度</span>
                    <span className="text-zinc-100">{selectedFile.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-zinc-100 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${selectedFile.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="px-3 py-1.5 border border-zinc-800 rounded text-[10px] font-mono text-zinc-500 uppercase">
                    {selectedFile.file.type.split('/')[1] || 'AUDIO'}
                  </div>
                </div>
              </div>

              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/10">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">AI 智 能 学 习 笔 记</span>
                      <button 
                        onClick={() => setFullScreenView('notes')}
                        className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="全屏查看"
                      >
                        <Maximize2 size={12} />
                      </button>
                    </div>
                    {selectedFile.status === ProcessStatus.COMPLETED && (
                      <button 
                        onClick={() => downloadNotes(selectedFile)}
                        className="text-[10px] font-bold flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded px-2 py-1 transition-all"
                      >
                        <Download size={12} /> 导出 Markdown
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-12">
                    {selectedFile.status === ProcessStatus.COMPLETED ? (
                      <div className="max-w-3xl mx-auto markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {selectedFile.studyNotes || ''}
                        </ReactMarkdown>
                      </div>
                    ) : selectedFile.status === ProcessStatus.FAILED ? (
                      <div className="h-full flex flex-col items-center justify-center p-12 bg-rose-950/10 rounded-2xl border border-rose-900/20">
                        <AlertCircle size={40} className="text-rose-500 mb-4" />
                        <h3 className="text-lg font-bold text-zinc-100">处理失败</h3>
                        <p className="text-sm text-zinc-500 text-center mt-2 max-w-sm">{selectedFile.error}</p>
                        <button 
                          onClick={() => processSingleFile(selectedFile.id)}
                          className="mt-8 px-8 py-2 bg-zinc-100 text-zinc-900 rounded-lg text-sm font-bold"
                        >
                          重试
                        </button>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-600">
                        <Loader2 size={32} className="animate-spin mb-4 text-zinc-700" />
                        <p className="text-sm font-medium tracking-tight">AI 正在深度解析音频内容...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Transcription Pane */}
                <div className="w-[340px] border-l border-zinc-800 bg-[#0d0d0d] flex flex-col hidden lg:flex">
                  <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">原始转录文本</span>
                    <button 
                      onClick={() => setFullScreenView('transcription')}
                      className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                      title="全屏查看"
                    >
                      <Maximize2 size={12} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {selectedFile.transcription ? (
                      <div className="text-zinc-500 text-xs leading-relaxed font-mono whitespace-pre-wrap">
                        {selectedFile.transcription}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">等待数据中...</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-[#0a0a0a]">
              <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-sm flex items-center justify-center text-zinc-500 mb-8">
                <AudioLines size={32} strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-bold text-zinc-100 mb-3 tracking-tight">准备好开始分析了吗？</h2>
              <p className="text-zinc-500 max-w-md text-sm leading-relaxed mb-10">
                上传讲座、会议、语音备忘录或导入 B 站视频，
                AI 助理将秒级生成结构化、详实的高质量学习笔记。
              </p>
              
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-3 bg-zinc-100 hover:bg-white text-zinc-900 text-sm font-bold rounded-xl transition-all shadow-[0_4px_20px_rgba(255,255,255,0.1)] active:scale-95 flex items-center gap-2 mb-12"
              >
                <Upload size={18} />
                立即上传音频
              </button>

              <div className="grid grid-cols-3 gap-8 w-full max-w-lg grayscale opacity-40">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 rounded border border-zinc-800 flex items-center justify-center">
                    <FileAudio size={16} />
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest">批量上传</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 rounded border border-zinc-800 flex items-center justify-center">
                    <FileText size={16} />
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest">极速转录</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 rounded border border-zinc-800 flex items-center justify-center">
                    <BookOpen size={16} />
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest">AI 总结</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Chatbot Panel (Collapsible Right Sidebar) */}
        <aside className={`border-l border-zinc-800 bg-[#0d0d0d] overflow-hidden flex flex-col transition-all duration-500 rounded-l-2xl ${
          showPromptSettings ? 'opacity-100' : 'opacity-0 skew-x-1'
        }`}>
          <div className="p-6 border-b border-zinc-800 bg-zinc-950/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-zinc-100">系统偏好与设置</h3>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5 font-bold">PREFERENCES & CONFIG</p>
              </div>
            </div>
            <button 
              onClick={() => setShowPromptSettings(false)}
              className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <div className="bg-zinc-950/50 rounded-xl p-4 border border-zinc-800/50">
              <p className="text-xs text-zinc-500 leading-relaxed italic">
                "在此输入特殊指令（Prompt）调整笔记，或在下方管理本地 SenseVoice 转录引擎的运行硬件和并行数量。"
              </p>
            </div>

            {/* 本地转录引擎设置 */}
            <div className="space-y-4 p-4 rounded-xl border border-zinc-800 bg-[#0c0c0c] shadow-inner">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">
                本地转录引擎设置 (SenseVoice)
              </label>
              
              {/* CPU/GPU Toggle */}
              <div className="space-y-2">
                <span className="text-xs text-zinc-400 block font-medium">运行设备 (Device):</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleUpdateSystemConfig('cpu', ncpu)}
                    className={`px-3 py-2 text-xs font-bold rounded-lg border transition-all ${
                      device === 'cpu'
                        ? 'bg-zinc-100 text-zinc-900 border-zinc-100 shadow-[0_2px_8px_rgba(255,255,255,0.1)]'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:border-zinc-700'
                    }`}
                  >
                    CPU 模式
                  </button>
                  <button
                    onClick={() => {
                      if (!cudaAvailable) {
                        alert("检测到当前 Python 环境尚未正确安装 CUDA 支持库，或您的设备没有 NVIDIA 显卡。若要使用 GPU，请在当前环境运行清华加速源安装：\nuv pip install torch torchaudio -f https://mirrors.tuna.tsinghua.edu.cn/pytorch-wheels/cu121/ --force-reinstall");
                      }
                      handleUpdateSystemConfig('cuda', ncpu);
                    }}
                    className={`px-3 py-2 text-xs font-bold rounded-lg border transition-all flex items-center justify-center gap-1.5 ${
                      device === 'cuda'
                        ? 'bg-zinc-100 text-zinc-900 border-zinc-100 shadow-[0_2px_8px_rgba(255,255,255,0.1)]'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:border-zinc-700'
                    }`}
                  >
                    GPU (CUDA) 模式
                    {cudaAvailable && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                  </button>
                </div>
                {!cudaAvailable && (
                  <p className="text-[9px] text-zinc-600 italic">
                    ⚠️ 系统未检测到可用的 NVIDIA CUDA 环境（请参照提示安装）
                  </p>
                )}
              </div>

              {/* Thread Count Setting */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400 font-medium">最大并行个数 (Threads):</span>
                  <span className="text-xs font-mono font-bold text-zinc-300">{ncpu}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="16"
                  step="1"
                  value={ncpu}
                  onChange={(e) => handleUpdateSystemConfig(device, parseInt(e.target.value))}
                  className="w-full accent-zinc-100 bg-zinc-800 h-1 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
                  <span>1 线程</span>
                  <span>推荐: 8 线程</span>
                  <span>16 线程</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">自定义提示词指令</label>
              <textarea 
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="例如：请提取所有提到的代码片段；将对话整理成访谈录形式；解释其中涉及的所有金融术语..."
                className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-300 focus:outline-none focus:border-zinc-500 transition-all resize-none leading-relaxed placeholder:text-zinc-700 shadow-inner"
              />
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">常用功能模板</label>
              <div className="grid gap-2">
                <button 
                  onClick={() => setCustomPrompt('请使用严谨的学术风格，重点提取论文引用、研究方法和实证数据结果。')}
                  className="p-3 border border-zinc-800 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all text-left flex items-center justify-between group"
                >
                  <span>精简学术风格</span>
                  <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <button 
                  onClick={() => setCustomPrompt('请将所有知识点以 Markdown 表格的形式呈现，横向对比不同选项的优缺点。')}
                  className="p-3 border border-zinc-800 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all text-left flex items-center justify-between group"
                >
                  <span>结构化表格模式</span>
                  <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <button 
                  onClick={() => setCustomPrompt('请在每个章节后增加一段其在商业环境下的落地建议、潜在风险以及实际应用方案。')}
                  className="p-3 border border-zinc-800 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all text-left flex items-center justify-between group"
                >
                  <span>商业策略深度分析</span>
                  <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <button 
                  onClick={() => setCustomPrompt('')}
                  className="p-2 text-[10px] text-zinc-600 hover:text-rose-400 transition-all text-center mt-2 font-bold"
                >
                  重置为系统默认
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 bg-zinc-950/80 border-t border-zinc-800">
            <div className="flex items-center gap-3 text-[10px] text-zinc-600 font-medium">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              配置已就绪，将在下次处理时自动应用
            </div>
          </div>
        </aside>
      </main>

      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        multiple
        accept=".mp3,.wav,.m4a"
      />

      {/* Multi-P Selection Modal */}
      <AnimatePresence>
        {biliMultiP && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-zinc-100">识别到多分 P 视频</h3>
                  <p className="text-xs text-zinc-500 mt-1">{biliMultiP.title}</p>
                </div>
                <button onClick={() => setBiliMultiP(null)} className="text-zinc-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              {/* Select All Toggle */}
              <div className="px-6 py-2.5 bg-zinc-900/30 border-b border-zinc-800/50 flex items-center justify-between">
                <span className="text-xs text-zinc-500">选择要导入的分 P 视频</span>
                <button
                  onClick={() => {
                    if (selectedCids.length === biliMultiP.pages.length) {
                      setSelectedCids([]);
                    } else {
                      setSelectedCids(biliMultiP.pages.map(p => p.cid));
                    }
                  }}
                  className="text-xs text-zinc-400 hover:text-white transition-colors font-medium"
                >
                  {selectedCids.length === biliMultiP.pages.length ? "取消全选" : "全选"}
                </button>
              </div>

              <div className="max-h-[350px] overflow-y-auto p-4 space-y-1">
                {biliMultiP.pages.map((p) => {
                  const isSelected = selectedCids.includes(p.cid);
                  return (
                    <div
                      key={p.cid}
                      onClick={() => {
                        setSelectedCids(prev => 
                          prev.includes(p.cid) 
                            ? prev.filter(id => id !== p.cid) 
                            : [...prev, p.cid]
                        );
                      }}
                      className="flex items-center gap-4 p-3 hover:bg-zinc-800/60 rounded-xl transition-colors text-left group cursor-pointer border border-transparent hover:border-zinc-800"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // Handled by div onClick
                        className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-zinc-100 focus:ring-0 cursor-pointer"
                      />
                      <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500 group-hover:bg-zinc-700 transition-colors">
                        P{p.page}
                      </div>
                      <span className="text-sm text-zinc-300 flex-1 truncate">{p.part}</span>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 bg-zinc-900/80 border-t border-zinc-800 flex justify-between gap-3">
                <button 
                  onClick={() => setBiliMultiP(null)}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    const selected = biliMultiP.pages.filter(p => selectedCids.includes(p.cid));
                    if (selected.length === 0) {
                      alert("请选择至少一个分 P 视频导入");
                      return;
                    }
                    importSpecificPages(selected);
                  }}
                  disabled={selectedCids.length === 0}
                  className="px-6 py-2 bg-zinc-100 text-black text-sm font-bold rounded-lg hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  导入已选 ({selectedCids.length} 个分 P)
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Screen Modal */}
      <AnimatePresence>
        {fullScreenView && selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] bg-[#0a0a0a] flex flex-col"
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/20 px-8">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                  {fullScreenView === 'notes' ? '全屏查看：AI 学习笔记' : '全屏查看：原始转录文本'}
                </span>
                <span className="text-xs text-zinc-600">{selectedFile.name}</span>
              </div>
              <button 
                onClick={() => setFullScreenView(null)}
                className="p-2 text-zinc-500 hover:text-zinc-100 transition-colors bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-12 md:p-20">
              <div className="max-w-4xl mx-auto">
                {fullScreenView === 'notes' ? (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedFile.studyNotes || ''}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-zinc-400 text-sm leading-relaxed font-mono whitespace-pre-wrap">
                    {selectedFile.transcription}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
