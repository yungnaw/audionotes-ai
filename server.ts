import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API to fetch Bilibili content (Subtitles priority, then Audio)
  app.get("/api/bilibili", async (req, res) => {
    const { url, cid: requestedCid } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "Missing Bilibili URL" });
    }

    try {
      // 1. Extract BVID
      const bvidMatch = url.match(/BV[a-zA-Z0-9]+/);
      const avidMatch = url.match(/av(\d+)/);
      if (!bvidMatch && !avidMatch) {
         return res.status(400).json({ error: "Invalid Bilibili URL" });
      }
      
      const bvid = bvidMatch ? bvidMatch[0] : "";
      const avid = !bvid ? avidMatch![1] : "";

      // 2. Get Video Info (CID and Pages)
      const viewApi = bvid 
        ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
        : `https://api.bilibili.com/x/web-interface/view?aid=${avid}`;
      
      const viewRes = await axios.get(viewApi, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com" }
      });

      if (viewRes.data.code !== 0) {
        return res.status(400).json({ error: viewRes.data.message });
      }

      const { cid: defaultCid, title, bvid: realBvid, pages } = viewRes.data.data;

      // 如果没有请求具体的 CID，且存在多 P，先返回列表供前端选择（或者让前端处理）
      // 这里的逻辑改为：如果前端没传 cid，但有多 P，返回全量信息
      if (!requestedCid && pages && pages.length > 1) {
        return res.json({
          type: "list",
          title,
          bvid: realBvid,
          pages: pages.map((p: any) => ({
            cid: p.cid,
            part: p.part,
            page: p.page
          }))
        });
      }

      const cid = requestedCid || defaultCid;
      const currentPartName = pages.find((p: any) => p.cid == cid)?.part || "";

      // 3. TRY TO GET SUBTITLES FIRST (High Speed Way)
      const playerApi = `https://api.bilibili.com/x/player/v2?cid=${cid}&bvid=${realBvid}`;
      const playerRes = await axios.get(playerApi, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com" }
      });

      const subtitles = playerRes.data.data?.subtitle?.subtitles;
      if (subtitles && subtitles.length > 0) {
        // Fetch the first subtitle content
        const subtitleUrl = "https:" + subtitles[0].subtitle_url;
        const subContentRes = await axios.get(subtitleUrl);
        const subData = subContentRes.data.body;
        
        // Merge subtitles into plain text
        const fullText = subData.map((s: any) => s.content).join(" ");
        
        return res.json({
          title: pages.length > 1 ? `${title} (P${pages.find((p:any)=>p.cid==cid)?.page} - ${currentPartName})` : title,
          bvid: realBvid,
          cid: cid,
          type: "text",
          content: fullText
        });
      }

      // 4. FALLBACK TO AUDIO (Slow Way)
      const playUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${realBvid}&cid=${cid}&fnval=16`;
      const playRes = await axios.get(playUrlApi, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com" }
      });

      if (playRes.data.code !== 0) {
        return res.status(400).json({ error: playRes.data.message });
      }

      const dash = playRes.data.data.dash;
      if (!dash || !dash.audio || dash.audio.length === 0) {
        return res.status(400).json({ error: "No audio track found" });
      }

      const audioUrl = dash.audio[0].baseUrl;
      const audioRes = await axios.get(audioUrl, {
        headers: { 
          "User-Agent": "Mozilla/5.0", 
          "Referer": "https://www.bilibili.com",
          "Range": "bytes=0-" 
        },
        responseType: "arraybuffer"
      });

      const base64Audio = Buffer.from(audioRes.data).toString('base64');

      res.json({
        title,
        bvid: realBvid,
        type: "audio",
        mimeType: "audio/mp4",
        data: base64Audio
      });

    } catch (error: any) {
      console.error("Bilibili Error:", error.message);
      res.status(500).json({ error: "无法提取内容，请检查链接或网络。" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
