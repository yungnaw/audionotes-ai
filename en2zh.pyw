#!/usr/bin/env python3
"""
英文→中文翻译脚本
使用模型：Helsinki-NLP/opus-mt-en-zh
支持：
1. 交互模式：运行脚本后逐行输入英文，回车得到中文
2. 文件批量模式：python en2zh.py --file input.txt --output output.txt
3. 命令行单句模式：python en2zh.py "Hello world"
"""

import sys
import re
import argparse
import threading
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext
    HAS_GUI = True
except ImportError:
    HAS_GUI = False

MODEL_NAME = "Helsinki-NLP/opus-mt-en-zh"

def _load_model():
    """加载模型并检测设备"""
    print(f"正在加载模型 {MODEL_NAME}...", file=sys.stderr)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda":
        print(f"使用 GPU: {torch.cuda.get_device_name()}", file=sys.stderr)
    else:
        print("使用 CPU", file=sys.stderr)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME).to(device)
    print("模型加载完成！", file=sys.stderr)
    return tokenizer, model, device

tokenizer, model, device = _load_model()


def _split_sentences(text: str) -> list[str]:
    """增强句子拆分：支持句号后没空格的情况（如 'agents.And'）"""
    # 在 .!? 后未跟空格但跟大写字母处插入临时标记，再按标准规则拆分
    text = re.sub(r'([.!?])(?=[A-Z])', r'\1\n', text)
    # 标准拆分：标点 + 空白
    parts = re.split(r'(?<=[.!?])\s+', text)
    return [p.strip() for p in parts if p.strip()]


def _chunk_text(text: str) -> list[str]:
    """将长文本按句子边界拆成 ~250 token 的块，保证内容不丢失且边界自然"""
    sents = _split_sentences(text)
    chunks, buf, buf_len = [], [], 0
    for sent in sents:
        sent_len = len(tokenizer.tokenize(sent))
        if buf_len > 0 and buf_len + sent_len > 250:
            chunks.append(" ".join(buf))
            buf, buf_len = [], 0
        buf.append(sent)
        buf_len += sent_len
    if buf:
        chunks.append(" ".join(buf))
    return chunks


def translate(text: str, progress_callback=None) -> str:
    """翻译单条文本，长文本自动分段"""
    if not text or not text.strip():
        return ""

    # 短文本：精确判断后直接翻译
    if len(text) < 2000:
        input_len = len(tokenizer(text)["input_ids"])
        if input_len <= 512:
            inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)
            outputs = model.generate(**inputs, num_beams=4, max_new_tokens=512, do_sample=False)
            return tokenizer.decode(outputs[0], skip_special_tokens=True)

    # 长文本：按句子切分后逐段翻译
    chunks = _chunk_text(text)
    results = []
    for i, chunk in enumerate(chunks, 1):
        if progress_callback:
            progress_callback(i, len(chunks))
        inputs = tokenizer(chunk, return_tensors="pt", truncation=True, max_length=512).to(device)
        outputs = model.generate(**inputs, num_beams=4, max_new_tokens=512, do_sample=False)
        results.append(tokenizer.decode(outputs[0], skip_special_tokens=True))

    return "\n\n".join(results)


def gui_mode():
    """图形界面模式：双击脚本后弹出窗口"""
    root = tk.Tk()
    root.title("英文→中文翻译")
    root.geometry("560x480")
    root.minsize(400, 320)

    main_frame = ttk.Frame(root, padding=16)
    main_frame.pack(fill=tk.BOTH, expand=True)

    # 状态栏
    status_var = tk.StringVar(value="正在加载模型… 首次运行需下载约 300MB")
    status_bar = ttk.Label(main_frame, textvariable=status_var, foreground="gray")
    status_bar.pack(fill=tk.X, pady=(0, 8))

    # 输入区域
    ttk.Label(main_frame, text="英文：").pack(anchor=tk.W)
    input_text = scrolledtext.ScrolledText(main_frame, height=6, font=("Consolas", 11))
    input_text.pack(fill=tk.BOTH, expand=True, pady=(2, 8))

    # 按钮行
    btn_frame = ttk.Frame(main_frame)
    btn_frame.pack(fill=tk.X, pady=(0, 8))
    translate_btn = ttk.Button(btn_frame, text="翻译", state=tk.DISABLED)
    translate_btn.pack(side=tk.LEFT, padx=(0, 8))
    ttk.Button(btn_frame, text="清空", command=lambda: output_text.delete("1.0", tk.END)).pack(side=tk.LEFT)
    ttk.Button(btn_frame, text="复制结果", command=lambda: (
        root.clipboard_clear(), root.clipboard_append(output_text.get("1.0", tk.END).strip())
    )).pack(side=tk.RIGHT)

    # 输出区域
    ttk.Label(main_frame, text="中文：").pack(anchor=tk.W)
    output_text = scrolledtext.ScrolledText(main_frame, height=6,
                                            font=("Microsoft YaHei", 11), state=tk.DISABLED)
    output_text.pack(fill=tk.BOTH, expand=True, pady=(2, 0))

    # 后台加载模型
    def load():
        global tokenizer, model, device
        try:
            tokenizer, model, device = _load_model()
            root.after(0, lambda: (
                translate_btn.config(state=tk.NORMAL),
                status_var.set(f"模型已加载（{'GPU' if device == 'cuda' else 'CPU'}）")
            ))
        except Exception as e:
            root.after(0, lambda: status_var.set(f"加载失败：{e}"))

    threading.Thread(target=load, daemon=True).start()

    # 翻译逻辑（后台线程，不卡界面）
    def do_translate():
        en = input_text.get("1.0", tk.END).strip()
        if not en:
            return

        translate_btn.config(state=tk.DISABLED)
        status_var.set("翻译中…")
        output_text.config(state=tk.NORMAL)
        output_text.delete("1.0", tk.END)
        output_text.insert("1.0", "正在翻译，请稍候…")
        output_text.config(state=tk.DISABLED)

        def progress(i, n):
            root.after(0, lambda: status_var.set(f"翻译中… 第 {i}/{n} 段"))

        def run():
            try:
                zh = translate(en, progress_callback=progress)
                root.after(0, lambda: (
                    output_text.config(state=tk.NORMAL),
                    output_text.delete("1.0", tk.END),
                    output_text.insert("1.0", zh),
                    output_text.config(state=tk.DISABLED),
                    status_var.set(f"翻译完成 ✓ 共 {len(zh)} 字"),
                    translate_btn.config(state=tk.NORMAL),
                ))
            except Exception as e:
                root.after(0, lambda: (
                    output_text.config(state=tk.NORMAL),
                    output_text.delete("1.0", tk.END),
                    output_text.insert("1.0", f"翻译出错：{e}"),
                    output_text.config(state=tk.DISABLED),
                    status_var.set("翻译失败"),
                    translate_btn.config(state=tk.NORMAL),
                ))

        threading.Thread(target=run, daemon=True).start()

    translate_btn.config(command=do_translate)
    input_text.bind("<Control-Return>", lambda _: do_translate())

    root.mainloop()


def interactive_mode():
    """交互模式：逐行输入，逐行翻译"""
    print("\n进入交互翻译模式（输入 q 或 quit 退出）")
    print("=" * 50)
    while True:
        try:
            en_text = input("\n英文 > ").strip()
        except EOFError:
            break
        if en_text.lower() in ("q", "quit", "exit"):
            print("再见！")
            break
        if not en_text:
            continue
        zh_text = translate(en_text)
        print(f"中文 > {zh_text}")


def batch_file(input_file: str, output_file: str):
    """批量翻译文件：每行一条英文"""
    try:
        with open(input_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        if not lines:
            print(f"输入文件 {input_file} 为空或无有效内容")
            return

        results = []
        for i, line in enumerate(lines, 1):
            print(f"翻译进度: {i}/{len(lines)}", end="\r")
            results.append(translate(line))

        with open(output_file, "w", encoding="utf-8") as f:
            f.write("\n".join(results))
        print(f"\n翻译完成！结果已保存至 {output_file}")
    except FileNotFoundError:
        print(f"错误：文件 {input_file} 不存在")
    except Exception as e:
        print(f"批量翻译出错：{e}")


def main():
    parser = argparse.ArgumentParser(description="英文→中文翻译工具")
    parser.add_argument("text", nargs="?", help="要翻译的英文句子")
    parser.add_argument("--file", "-f", help="批量翻译的输入文件（每行一句英文）")
    parser.add_argument("--output", "-o", help="批量翻译的输出文件（默认为 input_file + .zh.txt）")
    args = parser.parse_args()

    if args.file:
        out_file = args.output or (args.file + ".zh.txt")
        batch_file(args.file, out_file)
    elif args.text:
        print(translate(args.text))
    elif HAS_GUI:
        gui_mode()
    else:
        interactive_mode()


if __name__ == "__main__":
    main()