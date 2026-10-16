<script setup>
import { engine } from '../../engine.js'

/* 物品图标。图是 canvas 现画的等距立方体（方块）或平面图（物品），
 * isoIcon() 内部有缓存，同一个 id 只画一次。
 * 尺寸不写死在这里 —— 由外层容器用 --ic 变量给，响应式断点只改变量。 */
defineProps({
  id: { type: Number, required: true },
})
</script>

<template>
  <img class="ic" :src="engine.isoIcon(id)" alt="">
</template>
