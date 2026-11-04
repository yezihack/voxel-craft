# 工单：宣传素材整理成可点击浏览的素材库

状态：已完成
范围：`intro.html`（素材库 + 全屏查看器）、`src/components/StartVeil.vue`（宣传页入口）

---

## 一、问题

1. **线上根本没有宣传页**。`https://voxel-craft-516.pages.dev/intro.html`、
   `/media/demo.mp4`、`/media/*.webp` 全部返回 1209 字节的 `index.html` ——
   是 Cloudflare Pages 的 SPA 兜底。线上跑的是旧构建，`intro.html` 与 `public/media/`
   从来没部署上去过。
2. **素材只能「切换」，不能「浏览」**。原来的图集只做「点缩略图换主图」，
   主图没法放大、视频没法带声音放大播、也没有一个地方能把全部素材一次列清。
3. **游戏页没有任何通往宣传页的入口**。访客打开 `/` 只看到开始面板，
   不知道还有录屏和截图。

## 二、做法

### 1. 素材库（`#media`）
把 `public/media/` 里的全部 8 件素材列成卡片网格（`auto-fill minmax(220px,1fr)`）：

| 卡片 | 格式 | 尺寸 |
|---|---|---|
| 实机演示 · 50 秒 | MP4 | 1280×720 |
| 生存模式 · 主世界湖泊 | WebP | 1280×720 |
| 创造模式 · 高空俯瞰 | WebP | 1280×720 |
| 方块库 · 物品栏 | WebP | 1280×720 |
| 熔火深渊 · 岩浆海 | WebP | 1280×720 |
| 手机竖屏 · 触屏操作 | WebP | **780×1688** |
| 视频封面 | WebP | 1280×720 |
| 试玩二维码 | SVG | 矢量 |

每张卡片两层交互：整卡是一个全尺寸透明 `<button class="hit">`（点开查看），
右上角是独立的 `<a download>`（下载原文件）。**不能把 `<a>` 嵌进 `<button>`** ——
非法嵌套，触屏上点哪个都说不清。

体积一栏**现读 `Content-Length`**，不写死数字（素材换了体积跟着变）。
矢量图那一格刻意不报：文本资源会被 gzip，`Range` 报出来的是压缩后长度
（实测 495 B vs 磁盘 1651 B），和玩家下载到的字节数对不上，不如不报。

### 2. 全屏查看器（`#lb`）
素材库卡片、图集主图、hero 视频的放大键共用一套：

- 打开：`display:grid` + `body.lb-open{overflow:hidden}` 锁滚动
- 翻页：`← →` 与两侧按钮，**首尾环绕**
- 关闭：`Esc` / 右上「✕ 关闭」/ 点空白处；关闭时清空舞台、恢复焦点
- **视频节点按需创建**：首屏不能为一段 4.6 MB 的录屏付流量，只有真的点开
  「实机演示」时才建 `<video>`，关掉就 `pause()` + 移除
- 下载按钮跟着当前素材走（`href` + `download` 文件名同步）

### 3. 图集主图
原来只能切缩略图。加一层 `.gal-hit` 透明按钮 + 右上 `⤢` 角标，
点主图按**当前缩略图**打开查看器（`SHOTS = MEDIA.slice(1, 6)`，
省得「当前第几张」再跟 MEDIA 下标偏移对账）。

### 4. 入口
- 顶栏加「素材库」锚点，`#media` 直达
- hero 视频右上角加 `⤢` 放大键（带声音、带进度条）
- 游戏页 `StartVeil.vue` 底部加 `✦ 宣传页 · 实机演示` 链接，
  点击时先 `engine.saveNow(false)` 静默存一次再跳走 ——
  自动存档是 60 秒一次，不能保证此刻最新

### 5. 竖屏截图的裁切
`shot-mobile.webp` 实际是 **780×1688 竖屏**（原标注误写成 1280×720）。
塞进 16:9 的框里 `object-fit:cover` 只会截到中间一片水面，所以加
`object-position:50% 95%`，把摇杆、跳/潜/挖/放四个键和快捷栏带进画面 ——
那才是这张图要说的东西。图集主图与素材库卡片共用同一条规则。

## 三、验证

```
npx vite build                                    → 通过，intro.html 48.07 kB
node .scratch/promo-gallery/probe.mjs             → 29 项断言全过
node .scratch/cf/verify.mjs（CF_URL=本地预览）    → HTTP 200 / WebGL ok / 零报错
```

`probe.mjs` 覆盖：
1. 8 张卡片、每张都有下载链接与查看入口、除矢量图外 7 张读到真实体积
2. 点视频卡 → `<video>` + mp4/webm 双源 + 原生控件 + 标题 / 计数 / 下载指向
3. `→` 翻页、切到图片时**视频节点被移除**（不会后台继续播）、`←` 翻回、首尾环绕
4. `Esc` 关闭、恢复滚动、舞台清空
5. 主图入口跟着当前缩略图（3 / 5）、标题同步
6. hero 放大键直接打开视频（1 / 8）
7. 游戏页存在 `.promolink` 且 `href="/intro.html"`
8. 390×844 视口无横向溢出
9. 全流程零控制台报错

## 四、踩坑

1. **`vite preview` 的响应头会骗人**：`curl -I` 拿到 `Content-Length: 1651`，
   浏览器 `fetch(HEAD)` 却拿到 `null` —— 因为浏览器带 `Accept-Encoding`，
   SVG 这类文本资源被 gzip 成 chunked，服务端就不发 `Content-Length` 了。
   用 `Range: bytes=0-0` 能拿到总长，但那是**压缩后**的 495 B。
   结论：文本资源的体积不可靠，别报。
2. **`scroll-behavior:smooth` 会让无头截图截到半路**：`scrollIntoView()` 后
   等 600 ms 不够，截出来顶部一大片空白，看着像布局崩了。
   断言前先 `document.documentElement.style.scrollBehavior='auto'` 再
   `window.scrollTo`，并核对 `nav.getBoundingClientRect().top === 0`。
3. **`npx vite preview ... &` 起的后台进程会被回收**，探针直接 `ERR_CONNECTION_REFUSED`。
   要用受管后台任务（`run_in_background`），不能用 shell 的 `&`。

## 五、遗留

`demo.mp4` 片头 0–3.5 秒是静止的开始面板（t=5s 已进入游戏）。
这是录制流程的遗留（录屏从创建 context 就开始，地形要 8~9 秒才就绪），
不在本次「整理」范围内 —— 重编码会改动已发布的素材，等确认后再做。
