<script setup>
/* 图标定义：心 / 鸡腿 / 气泡。
 * 图形本身不写 fill，让外层 CSS 按状态着色（见 Vitals.vue）。 */
</script>

<template>
  <svg width="0" height="0" class="defs" aria-hidden="true">
    <defs>
      <path id="icHeart" d="M10 18.2C10 18.2 1.6 12.4 1.6 7.05A4.75 4.75 0 0 1 10 4.15a4.75 4.75 0 0 1 8.4 2.9C18.4 12.4 10 18.2 10 18.2Z" />
      <path id="icMeat" d="M12.6 2.2a5.1 5.1 0 0 0-4.4 7.65l-4.1 4.1a2.35 2.35 0 1 0 1.75 1.75l4.1-4.1A5.1 5.1 0 1 0 12.6 2.2Z" />
      <circle id="icBub" cx="6.5" cy="6.5" r="5.1" />
      <linearGradient id="halfHeart">
        <stop offset="50%" stop-color="#ff4d63" />
        <stop offset="50%" stop-color="#39404f" />
      </linearGradient>
      <linearGradient id="halfFood">
        <stop offset="50%" stop-color="#e8a35c" />
        <stop offset="50%" stop-color="#3a4152" />
      </linearGradient>
    </defs>
  </svg>
</template>

<style scoped>
.defs {
  position: absolute
}
</style>
