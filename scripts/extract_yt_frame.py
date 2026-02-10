#!/usr/bin/env python3
"""Extract a single frame from a YouTube video at a target timestamp.

Outputs JSON to stdout:
{
  "mimeType": "image/jpeg",
  "imageBytes": "<base64>",
  "width": 1280,
  "height": 720
}
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from typing import Any

import imageio_ffmpeg
from yt_dlp import YoutubeDL


def _err(message: str, *, details: str | None = None) -> None:
    payload: dict[str, Any] = {"error": message}
    if details:
        payload["details"] = details
    print(json.dumps(payload), file=sys.stderr)


def _pick_format(info: dict[str, Any]) -> dict[str, Any]:
    formats = info.get("formats") or []
    if not isinstance(formats, list):
        raise RuntimeError("No video formats found in yt-dlp response.")

    ranked: list[tuple[tuple[int, int, int, float], dict[str, Any]]] = []
    for fmt in formats:
        if not isinstance(fmt, dict):
            continue
        url = fmt.get("url")
        vcodec = fmt.get("vcodec")
        if not isinstance(url, str) or not url:
            continue
        if vcodec == "none":
            continue

        ext = fmt.get("ext")
        protocol = str(fmt.get("protocol") or "")
        height = int(fmt.get("height") or 0)
        tbr = float(fmt.get("tbr") or 0.0)
        is_mp4 = 1 if ext == "mp4" else 0
        is_http = 1 if protocol.startswith("http") else 0
        quality_height = min(height, 1080)
        # Prefer mp4/http/high-res/high-bitrate sources for stable ffmpeg decode.
        score = (is_mp4, is_http, quality_height, tbr)
        ranked.append((score, fmt))

    if not ranked:
        raise RuntimeError("No playable video format URL found.")

    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1]


def _run_ffmpeg(
    *,
    ffmpeg_bin: str,
    input_url: str,
    timestamp_seconds: float,
    headers: dict[str, str],
    pre_input_seek: bool,
) -> bytes:
    header_blob = "".join(f"{k}: {v}\r\n" for k, v in headers.items() if isinstance(v, str))
    cmd = [ffmpeg_bin, "-v", "error"]
    if pre_input_seek:
        cmd.extend(["-ss", f"{timestamp_seconds:.3f}"])
    if header_blob:
        cmd.extend(["-headers", header_blob])
    cmd.extend(["-i", input_url])
    if not pre_input_seek:
        cmd.extend(["-ss", f"{timestamp_seconds:.3f}"])
    cmd.extend(["-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "-"])

    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0 or not proc.stdout:
        stderr = proc.stderr.decode("utf-8", errors="ignore")
        mode = "pre-input seek" if pre_input_seek else "post-input seek"
        raise RuntimeError(f"ffmpeg failed ({mode}): {stderr.strip()}")

    return proc.stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--timestamp", required=True, type=float)
    args = parser.parse_args()

    video_id = args.video_id.strip()
    if not video_id:
        _err("Missing video id.")
        return 2

    timestamp_seconds = max(0.0, float(args.timestamp))
    video_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
        }
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)

        if not isinstance(info, dict):
            raise RuntimeError("yt-dlp returned invalid metadata.")

        selected = _pick_format(info)
        stream_url = selected.get("url")
        if not isinstance(stream_url, str) or not stream_url:
            raise RuntimeError("Selected format did not include a stream URL.")

        headers = {}
        if isinstance(info.get("http_headers"), dict):
            headers.update(info["http_headers"])
        if isinstance(selected.get("http_headers"), dict):
            headers.update(selected["http_headers"])

        ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
        try:
            image_bytes = _run_ffmpeg(
                ffmpeg_bin=ffmpeg_bin,
                input_url=stream_url,
                timestamp_seconds=timestamp_seconds,
                headers=headers,
                pre_input_seek=True,
            )
        except RuntimeError:
            image_bytes = _run_ffmpeg(
                ffmpeg_bin=ffmpeg_bin,
                input_url=stream_url,
                timestamp_seconds=timestamp_seconds,
                headers=headers,
                pre_input_seek=False,
            )

        payload = {
            "mimeType": "image/jpeg",
            "imageBytes": base64.b64encode(image_bytes).decode("ascii"),
            "width": selected.get("width"),
            "height": selected.get("height"),
        }
        print(json.dumps(payload))
        return 0
    except Exception as exc:  # noqa: BLE001
        _err("Failed to extract frame from YouTube.", details=str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
