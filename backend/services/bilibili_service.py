"""Bilibili video content extraction service.

Fetches subtitles (fast path) or audio (slow path) from Bilibili videos.
"""
import re
import logging
import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.bilibili.com",
}


def _collect_audio_urls(audio_list: list) -> list[str]:
    """Collect all available audio CDN URLs (base + backups) from dash audio list."""
    urls = []
    for item in audio_list[:3]:  # up to 3 quality levels
        base = item.get("baseUrl") or item.get("base_url", "")
        if base:
            urls.append(base)
        # backupUrl is a list of alternate CDN nodes
        for backup in item.get("backupUrl", []) or item.get("backup_url", []) or []:
            if backup and backup not in urls:
                urls.append(backup)
    return urls


async def _try_download_audio(client: httpx.AsyncClient, urls: list[str]) -> bytes | None:
    """Try each URL in order, return first successful download."""
    for url in urls:
        try:
            logger.info(f"Trying audio CDN: {url[:80]}...")
            res = await client.get(
                url,
                headers={**HEADERS, "Range": "bytes=0-"},
            )
            if res.status_code in (200, 206) and len(res.content) > 4096:
                logger.info(f"Audio downloaded OK: {len(res.content)} bytes")
                return res.content
            else:
                logger.warning(f"Bad response: status={res.status_code} size={len(res.content)}")
        except Exception as e:
            logger.warning(f"CDN failed ({url[:60]}...): {e}")
    return None


async def extract_video_info(url: str, cid: int | None = None) -> dict:
    """Extract content from a Bilibili video URL.

    Returns dict with type='list' (multi-part), 'text' (subtitles), or 'audio' (bytes).
    """
    # Extract BVID or AVID
    bvid_match = re.search(r"BV[a-zA-Z0-9]+", url)
    avid_match = re.search(r"av(\d+)", url)

    if not bvid_match and not avid_match:
        raise ValueError("无效的 Bilibili 链接，请输入包含 BV 号或 av 号的链接")

    bvid = bvid_match.group(0) if bvid_match else ""
    avid = avid_match.group(1) if not bvid and avid_match else ""

    # verify=False: handle CDN SSL issues; follow_redirects: CDN may redirect
    async with httpx.AsyncClient(
        headers=HEADERS, timeout=60, follow_redirects=True, verify=False
    ) as client:

        # ── Step 1: Get video metadata ──────────────────────────────────────
        view_api = (
            f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
            if bvid
            else f"https://api.bilibili.com/x/web-interface/view?aid={avid}"
        )
        view_res = await client.get(view_api)
        view_data = view_res.json()

        if view_data.get("code") != 0:
            raise ValueError(f"获取视频信息失败: {view_data.get('message', '未知错误')}")

        data = view_data["data"]
        default_cid = data["cid"]
        title = data["title"]
        real_bvid = data["bvid"]
        pages = data.get("pages", [])

        # ── Step 2: Multi-part — return page list if no specific CID ────────
        if cid is None and len(pages) > 1:
            return {
                "type": "list",
                "title": title,
                "bvid": real_bvid,
                "pages": [
                    {"cid": p["cid"], "part": p["part"], "page": p["page"]}
                    for p in pages
                ],
            }

        target_cid = cid or default_cid
        current_part = next(
            (p["part"] for p in pages if p["cid"] == target_cid), ""
        )
        display_title = (
            f"{title} (P{next((p['page'] for p in pages if p['cid'] == target_cid), 1)} - {current_part})"
            if len(pages) > 1
            else title
        )

        # ── Step 3: Try CC/AI subtitles (fast path, no CDN) ─────────────────
        try:
            player_api = (
                f"https://api.bilibili.com/x/player/v2?cid={target_cid}&bvid={real_bvid}"
            )
            player_res = await client.get(player_api)
            player_data = player_res.json()

            subtitles = (
                player_data.get("data", {})
                .get("subtitle", {})
                .get("subtitles", [])
            )
            if subtitles:
                subtitle_url = "https:" + subtitles[0]["subtitle_url"]
                sub_res = await client.get(subtitle_url)
                sub_body = sub_res.json().get("body", [])
                full_text = " ".join(s["content"] for s in sub_body)

                if full_text.strip():
                    logger.info(f"Subtitles found: {len(full_text)} chars")
                    return {
                        "type": "text",
                        "title": display_title,
                        "bvid": real_bvid,
                        "cid": target_cid,
                        "content": full_text,
                    }
        except Exception as e:
            logger.warning(f"Subtitle fetch failed, trying audio: {e}")

        # ── Step 4: Fallback — download audio stream from CDN ────────────────
        play_api = (
            f"https://api.bilibili.com/x/player/playurl"
            f"?bvid={real_bvid}&cid={target_cid}&fnval=16"
        )
        play_res = await client.get(play_api)
        play_data = play_res.json()

        if play_data.get("code") != 0:
            raise ValueError(
                f"获取播放地址失败: {play_data.get('message', '未知错误')}。"
                "该视频可能需要大会员或已下架。"
            )

        dash = play_data.get("data", {}).get("dash", {})
        audio_list = dash.get("audio", [])

        if not audio_list:
            raise ValueError(
                "未找到音频轨道。该视频可能需要大会员才能访问，"
                "或尝试换一个有 AI 字幕的视频。"
            )

        # Collect ALL CDN URLs (base + all backups across quality levels)
        all_audio_urls = _collect_audio_urls(audio_list)
        logger.info(f"Trying {len(all_audio_urls)} audio CDN URLs...")

        audio_data = await _try_download_audio(client, all_audio_urls)

        if audio_data is None:
            raise ValueError(
                "无法下载音频流。该视频无字幕且所有 CDN 节点均连接失败。\n"
                "建议：\n"
                "① 换一个有 AI 字幕的视频（如教程类、讲座类视频通常有字幕）\n"
                "② 开启全局代理后重试\n"
                "③ 直接上传本地音频文件"
            )

        return {
            "type": "audio",
            "title": display_title,
            "bvid": real_bvid,
            "cid": target_cid,
            "mime_type": "audio/mp4",
            "data": audio_data,
        }
