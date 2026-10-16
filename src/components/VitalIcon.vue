<script setup>
/* 一个生命 / 饥饿 / 氧气图标。
 * 图形本身不写 fill（见 IconDefs.vue），由外层的 CSS 按状态着色 ——
 * `full` 是满的、`half` 走半格渐变、空着就是底色。 */
defineProps({
  id: { type: String, required: true },
  cls: { type: String, default: '' },
})
</script>

<template>
  <svg :class="cls" viewBox="0 0 20 20">
    <use :href="`#${id}`" />
  </svg>
</template>
