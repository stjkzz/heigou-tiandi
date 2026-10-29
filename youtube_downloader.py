#!/usr/bin/env python3
"""
YouTube 视频下载器
基于 yt-dlp，支持视频和音频下载

安装依赖:
    pip install yt-dlp

用法:
    python youtube_downloader.py <URL> [选项]
"""

import argparse
import os
import sys
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    print("请先安装 yt-dlp: pip install yt-dlp")
    sys.exit(1)


def download_video(url: str, output_dir: str = "./downloads", audio_only: bool = False):
    """
    下载 YouTube 视频

    Args:
        url: YouTube 视频链接
        output_dir: 下载保存目录
        audio_only: 是否只下载音频
    """
    # 创建输出目录
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # 基础配置
    ydl_opts = {
        "outtmpl": str(output_path / "%(title)s.%(ext)s"),
        "noplaylist": True,  # 不下载播放列表，只下载单个视频
        "quiet": False,
        "no_warnings": False,
    }

    if audio_only:
        # 只下载音频（MP3 格式）
        ydl_opts.update({
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        })
        print(f"🎵 正在下载音频: {url}")
    else:
        # 下载最佳质量视频（MP4 格式）
        ydl_opts.update({
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "merge_output_format": "mp4",
        })
        print(f"🎬 正在下载视频: {url}")

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", "未知标题")
            print(f"✅ 下载完成: {title}")
            return True
    except Exception as e:
        print(f"❌ 下载失败: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="YouTube 视频下载器")
    parser.add_argument("url", help="YouTube 视频链接")
    parser.add_argument("-o", "--output", default="./downloads", help="输出目录 (默认: ./downloads)")
    parser.add_argument("-a", "--audio", action="store_true", help="只下载音频 (MP3)")
    parser.add_argument("-l", "--list-formats", action="store_true", help="列出可用格式")

    args = parser.parse_args()

    if args.list_formats:
        # 列出可用格式
        print(f"📋 正在获取可用格式: {args.url}")
        with yt_dlp.YoutubeDL({"quiet": True}) as ydl:
            info = ydl.extract_info(args.url, download=False)
            formats = info.get("formats", [])
            print(f"\n视频标题: {info.get('title', '未知')}")
            print(f"时长: {info.get('duration', 0) // 60} 分钟")
            print("\n可用格式:")
            print("-" * 60)
            for f in formats:
                if f.get("vcodec") != "none":
                    print(f"ID: {f['format_id']:>4} | {f.get('resolution', 'N/A'):>10} | "
                          f"{f.get('ext', 'N/A'):>4} | {f.get('vcodec', 'N/A')}")
        return

    # 执行下载
    success = download_video(args.url, args.output, args.audio)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
