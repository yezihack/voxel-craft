#!/usr/bin/env bash
# 宣传页素材后期：PNG → WebP、WebM → 裁剪版 MP4/WebM、抽一帧当视频封面。
#
# 为什么两个视频格式都留：
#   .mp4 (H.264)  Safari / iOS 老版本不一定能播 WebM，必须兜底
#   .webm (VP9)   Chrome / Firefox / Edge 原生支持，同画质体积更小
# <video> 里按 mp4 → webm 顺序写 source，浏览器自己挑能播的那个。
#
# 为什么必须裁片头：
#   Playwright 的录屏**从创建 context 那一刻就开始**，而游戏要等地形生成完
#   才能开始玩（waitReady 轮询，实测 8~9 秒）。这段时间画面是静止的开始面板，
#   60 秒的片子有 1/6 是死画面。TRIM 就是砍掉这段，只保留约 2 秒开始面板
#   当片头卡。改动录制节奏后要重新核对 TRIM。
#
# 用 /d/local/bin/ffmpeg（full build，有 libx264/libvpx/libwebp）；
# Playwright 自带那个 ffmpeg 只有 VP8/WebM，编不了 H.264。

set -euo pipefail
cd "$(dirname "$0")/../.."

FF=/d/local/bin/ffmpeg
RAW=.scratch/promo/raw
MEDIA=public/media
TRIM=8.6          # 秒；砍掉的静止开始面板时长

mkdir -p "$MEDIA"

echo "=== PNG → WebP ==="
for f in shot-survival shot-creative shot-library shot-lava shot-mobile; do
  if [ -f "$RAW/$f.png" ]; then
    "$FF" -hide_banner -loglevel error -y -i "$RAW/$f.png" \
      -c:v libwebp -quality 86 -compression_level 6 "$MEDIA/$f.webp"
    echo "  ✓ $f.webp  $(du -h "$MEDIA/$f.webp" | cut -f1)"
  fi
done

echo "=== WebM → CFR 母版 ==="
# Playwright 的 WebM 是变帧率的，直接 -ss 会落在错误的帧上（实测偏 5 秒以上）。
# 先转成恒定 25fps 的母版，之后所有裁剪/抽帧都基于它，时间轴才是可信的。
"$FF" -hide_banner -loglevel error -y -i "$MEDIA/demo.webm" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 25 \
  -movflags +faststart -an "$RAW/master.mp4"

echo "=== 裁剪 + 输出 MP4 ==="
"$FF" -hide_banner -loglevel error -y -ss "$TRIM" -i "$RAW/master.mp4" \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -movflags +faststart -an "$MEDIA/demo.mp4"
echo "  ✓ demo.mp4  $(du -h "$MEDIA/demo.mp4" | cut -f1)"

echo "=== 输出 WebM (VP9) ==="
"$FF" -hide_banner -loglevel error -y -i "$MEDIA/demo.mp4" \
  -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -an \
  "$MEDIA/demo.webm"
echo "  ✓ demo.webm $(du -h "$MEDIA/demo.webm" | cut -f1)"

echo "=== 封面帧 ==="
# 取裁剪后第 7 秒：此时已在主世界湖景，不是开始面板也不是黑场。
"$FF" -hide_banner -loglevel error -y -i "$MEDIA/demo.mp4" -ss 7 \
  -frames:v 1 -c:v libwebp -quality 82 "$MEDIA/demo-poster.webp"
echo "  ✓ demo-poster.webp  $(du -h "$MEDIA/demo-poster.webp" | cut -f1)"

echo "=== 时长 ==="
"$FF" -hide_banner -loglevel error -i "$MEDIA/demo.mp4" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1 || true

echo "=== 成品清单 ==="
ls -lh "$MEDIA"
