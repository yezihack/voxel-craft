<script setup>
/* HUD 卡片。全局样式里的 .card 负责外观，这里只负责「里面塞什么」。 */
defineProps({
  title: { type: String, default: '' },
})
</script>

<template>
  <div class="card">
    <b v-if="title">{{ title }}</b>
    <slot />
  </div>
</template>
