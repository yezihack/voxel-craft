<script setup>
/* 致命错误提示（目前只有「不支持 WebGL」一种）。
 * 原 HTML 是直接 document.body.innerHTML = 一段内联样式的 div 把整页换掉，
 * 这里改成盖在最上层的一块同款样式 —— 视觉效果一样，但不用动 DOM 结构。 */
defineProps({
  msg: { type: String, required: true },
})
</script>

<template>
  <div class="fatal">{{ msg }}</div>
</template>

<style scoped>
.fatal {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--bg);
  color: #fff;
  font: 16px sans-serif;
  padding: 40px;
}
</style>
