<script setup>
import { ref } from 'vue'

/* WebGL 主画面。整个游戏只画在这一张画布上，其余全是覆盖在上面的 DOM。
 * 元素本身交给 App.vue 传给引擎（引擎要在它上面建上下文、绑指针锁定）。 */
const canvasEl = ref(null)
defineExpose({ canvasEl })
</script>

<template>
  <canvas ref="canvasEl" class="gl" />
</template>

<style scoped>
.gl {
  position: fixed;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  /* 触屏上必须禁掉浏览器手势：否则手指滑动会被当成滚动 / 下拉刷新 /
   * 双指缩放，画面跟着页面一起动，视角反而转不动。 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
</style>
