# 宣传页素材补齐（intro.html）

## 背景

`intro.html` 是项目的宣传落地页（深色主题 + GSAP 滚动动画）。此前有三处占位：

1. hero 区一个 CSS 立方体，标注「实机演示 · 替换为录屏」
2. 「三种模式」下一块虚线框，标注「实机画面 · 待替换」
3. 页脚一个空的 `.dl-qr` 容器

另外 `<script src="kit/daoliu.js">` 引用了一个仓库里不存在的文件。

目标：用**真实素材**填掉这三处，不引入假图、不手绘截图。

## 做法

### 1. 素材生产（Playwright 驱动真实游戏）

`.scratch/promo/` 下的脚本直接跑 dev server 上的真游戏，用 `import('/src/game/*.js')`
拿到**与运行中应用同一个模块实例**，因此可以直接改 `player.x/y/z/yaw/pitch`、
调 `switchDim()`、`spawnMob()`。

- `capture.mjs` → 5 张 1280×720 截图
- `record.mjs` → 1 段 1280×720 录屏
- `postprocess.sh` → PNG→WebP、WebM→裁剪 MP4/VP9、抽封面
- `qr.mjs` → 二维码 SVG

**机位不能拍脑袋选。** `capture.mjs` 里的 `scoutVista()` / `scoutLava()` 会在
±48 格范围内按 3 格步长扫描，对每个候选点再转 24 个朝向打分：

- 遮挡（前方地形高出视线的最大值）—— 减分
- 近景有树挡住 —— 减分
- 视野远端出现水面 / 岩浆 —— 加分
- 站得比海平面高 —— 加分

早期版本固定写死坐标，结果生存那张整幅被树冠罩住、熔火那张埋在黑曜石结构里。

### 2. 录屏的三个坑

**坑 A：灰边。** Playwright 把浏览器**窗口外框**设成视口尺寸，但窗口里真正能画的
内容面比外框小一圈，恒定差 **宽 −34 / 高 −104**（三组视口独立验证）。录屏录的是
内容面，差额由 Playwright 用灰底补齐 → 视频四周出现灰条。
解法：视口请求 `1314×824`，内容面正好回到 `1280×720`。

**坑 B：背包面板关不掉。** `openBag()` 在拿不到指针锁时会调 `pauseGame()`，
把 `running` 置 false；而 `input.js` 里 `KeyE` 的处理条件是 `k === 'KeyE' && running`
→ 第二次按 E 直接被忽略。无头浏览器必然拿不到指针锁，所以必然复现。
解法：录制脚本走动作层 `startGame(false)`（内部 `closeBag(true)` + 恢复 running，
且不请求指针锁）。

**坑 C：片头太长。** 录屏从创建 context 那一刻就开始，而游戏要等地形生成完
（`waitReady` 轮询，实测 8~9 秒）。60 秒的片子里 1/6 是静止的开始面板。
解法：`postprocess.sh` 用 `TRIM=8.6` 裁掉，只留约 2 秒当片头卡。

另外 Playwright 的 WebM 是**变帧率**的，直接 `-ss` 会落在错误的帧上（实测偏 5 秒以上）。
所以先转成恒定 25fps 的母版，后续裁剪/抽帧全部基于母版。

### 3. 页面改造

- hero：`<video>` + mp4/webm 双源 + poster，`preload="none"` +
  IntersectionObserver 进入视口才播放（省流量），静音循环，右下角切换声音
- 截图位：主图 + 5 张缩略图的图集，点击切换，标签跟随
- 页脚：QR 图 + 「扫码直接开玩」
- 素材路径统一用 `/media/...`（Vite `public/` 约定），否则 `vite build` 会去
  HTML 同级目录找文件而失败
- 删掉失效的 `kit/daoliu.js`
- 补内联 SVG favicon（原来请求 `/favicon.ico` 404）

### 4. 为什么改 vite.config.js

Vite 默认只把 `index.html` 当入口，`intro.html` **根本不进 dist** ——
线上访问 `/intro.html` 只会落到 404 / SPA 兜底，宣传页等于不存在。
加了 `rollupOptions.input` 多页入口。

## 验证

```bash
npx vite build                     # 必须产出 dist/intro.html + dist/media/*
node .scratch/promo/verify-intro.mjs   # 桌面 + 手机双视口，零控制台报错
node .scratch/promo/qr-check.mjs       # jsQR 真解码，断言扫出试玩地址
```

`verify-intro.mjs` 检查项：

- 11 个 `<img>` 全部 `naturalWidth > 0`
- `<video>` `readyState === 4`、`videoWidth === 1280`、正在播放、duration ≈ 50
- 点第 4 张缩略图后主图索引与标签同步
- 控制台 0 报错、0 个 HTTP 4xx/5xx

`qr-check.mjs` 把页面上的 QR 画进 canvas，用 jsQR 解码，断言结果是
`https://voxel-craft-516.pages.dev/`（不是「图里有方块」就算过）。

`demo.mp4` 的 `ERR_ABORTED` 是浏览器拿到足够数据后主动掐断 range 请求，
`readyState` 到 4 即为正常，验收脚本单独归类不计失败。
