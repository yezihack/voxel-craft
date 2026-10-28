<script setup>
import ItemIcon from './ItemIcon.vue'

/* 一个「格子」。底部快捷栏（.slot）与背包 54 格（.islot）共用这一个组件 ——
 * 原来两边是靠同一个 slotInner() 拼字符串才长得一样的，现在改成同一个模板。
 * 内部结构：键位号 + 图标 + 中文名 + 数量角标。 */
defineProps({
  id: { type: Number, default: 0 },          // 0 = 空格子
  name: { type: String, default: '' },
  count: { type: Number, default: 0 },       // 0 = 不显示角标（创造模式）
  keyLabel: { type: String, default: '' },   // 快捷格左上角的小数字
  title: { type: String, default: '空格子' },
  on: { type: Boolean, default: false },     // 是否被选中（快捷格）
  variant: { type: String, default: 'slot' }, // 'slot' 底部快捷栏 | 'islot' 背包格
})

defineEmits(['pick'])
</script>

<template>
  <div
    class="cell" :class="[variant, { on, void: !id }]" :title="title" @click="$emit('pick')"
  >
    <span v-if="keyLabel" class="key">{{ keyLabel }}</span>
    <ItemIcon v-if="id" :id="id" />
    <span class="nm">{{ id ? name : '' }}</span>
    <span v-if="id && count >= 1" class="cnt">{{ count }}</span>
  </div>
</template>

<style scoped>
/* ---------- 底部快捷栏：58×62，图标 32 ---------- */
.slot {
  --ic: 32px;
  position: relative;
  width: 58px;
  height: 62px;
  border-radius: 11px;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, .10);
  background: linear-gradient(160deg, rgba(255, 255, 255, .10), rgba(0, 0, 0, .28));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1px;
  transition: transform .12s, border-color .12s;
}

.slot:hover {
  transform: translateY(-3px)
}

.slot.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(67, 224, 255, .22), 0 0 18px rgba(67, 224, 255, .35)
}

.slot.void {
  opacity: .30
}

.slot .nm {
  font-size: 9.5px;
  color: var(--dim);
  letter-spacing: 0;
  line-height: 1.1;
  max-width: 54px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.slot.on .nm {
  color: var(--txt)
}

.slot .key {
  position: absolute;
  left: 4px;
  top: 2px;
  font-size: 9px;
  color: rgba(255, 255, 255, .45);
}

.slot .cnt {
  position: absolute;
  right: 4px;
  bottom: 3px;
  font-size: 10.5px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

/* ---------- 背包 54 格：高度 62，图标 30 ---------- */
.islot {
  --ic: 30px;
  position: relative;
  height: 62px;
  border-radius: 10px;
  cursor: pointer;
  overflow: hidden;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .045);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: transform .1s, border-color .1s, background .1s;
}

.islot:hover {
  border-color: var(--accent);
  transform: translateY(-2px)
}

.islot.void {
  opacity: .42
}

.islot.on {
  border-color: var(--accent);
  background: rgba(67, 224, 255, .14);
  box-shadow: 0 0 0 2px rgba(67, 224, 255, .18)
}

.islot .nm {
  font-size: 9px;
  color: var(--dim);
  max-width: 100%;
  padding: 0 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.islot.on .nm {
  color: var(--txt)
}

.islot .key {
  position: absolute;
  left: 3px;
  top: 1px;
  font-size: 8.5px;
  color: rgba(255, 255, 255, .42);
}

.islot .cnt {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

@media (max-width: 820px) {
  .slot {
    width: 48px;
    height: 54px;
    --ic: 26px;
  }

  .slot .nm {
    font-size: 8.5px;
    max-width: 44px;
  }

  .islot {
    height: 56px
  }
}

/* 手机横屏时 HUD 太挤，格子上的名字直接省掉 */
@media (max-height: 520px) {
  .slot {
    width: 44px;
    height: 48px;
    --ic: 24px;
  }

  .slot .nm {
    display: none
  }
}

/* 竖屏手机（≤560px 宽）：9 格必须能排进一屏，名字和键位号都省掉，
 * 只留图标 + 数量角标 —— 这两样才是选中方块时要看的。 */
@media (max-width: 560px) {
  .slot {
    width: 36px;
    height: 44px;
    --ic: 22px;
    border-width: 1.5px;
    border-radius: 9px;
  }

  .slot .nm,
  .slot .key {
    display: none
  }

  .slot .cnt {
    font-size: 9px;
    right: 2px;
    bottom: 1px;
  }
}

/* 窄竖屏（≤400px，360 宽的安卓机是主流）：36px 的 9 格加上间隙是 366，
 * 比屏幕还宽 —— 首尾两格会被边缘裁掉，点都点不到。再缩一档。 */
@media (max-width: 400px) {
  .slot {
    width: 32px;
    height: 40px;
    --ic: 20px;
    border-radius: 8px;
  }
}

/* 极窄（≤350px，如 iPhone SE 一代 320 宽）：28px 一格，9 格共 252。 */
@media (max-width: 350px) {
  .slot {
    width: 28px;
    height: 36px;
    --ic: 18px;
    border-radius: 7px;
  }
}
</style>
