Type: task
Status: needs-triage
Blocked by: 05

# 世界内题干：把课业挂在讲席上方

复用 `nametags.js` 的投影机制（viewProj → NDC → CSS 变量），
让题干真的浮在学堂讲席上方的世界坐标处，而不是一个屏幕居中的弹窗。

- 需要把 `tagPos` 那套「非响应式坐标 + 响应式语义」的分工**泛化**，
  让 `LessonTag.vue` 也能用，而不是复制一份投影代码。
- 照抄 nametags 的三条约束：距离剔除（46 格上限）、视锥剔除、越远越淡。
  题干数量必须 capped —— 每帧投影的东西涨上去会直接吃帧率。
- ⚠ 画布是 devicePixelRatio 缩放过的，投影结果要除回 CSS 像素，
  否则标签整体偏到右下角（nametags.js 里踩过这个坑）。

## Answer

## Comments
