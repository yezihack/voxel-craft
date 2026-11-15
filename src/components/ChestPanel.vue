<script setup>
import { computed } from 'vue'
import { engine, ui } from '../engine.js'
import ItemIcon from './ui/ItemIcon.vue'

/* 箱子面板。
 *
 * 上半是箱子自己的格（容量按箱子种类：木箱 9 / 铁箱 18 / 金箱 27 / 末影箱 36），
 * 下半是玩家背包。**两边点一下就搬**：点箱子里的东西 = 全取到背包，
 * 点背包里的东西 = 放进箱子。触屏上拖拽很难点准，所以不做拖拽。
 *
 * ⚠ 全部派生数据都走 engine.*，组件里不自己算规则：
 *   容量在 chests.js（CHEST_TYPES），物品名在 config.js。
 *   这样无头测试能直接断言数值，不用去啃 DOM。 */
const pos = computed(() => ui.chestPos)
const cap = computed(() => (engine.chestCapacity ? engine.chestCapacity() : 9))

/* 箱子里的东西：{ 物品id: 数量 } → 按 id 排序的数组（显示稳定，不会每次重排） */
const items = computed(() => {
  const src = ui.chestItems || {}
  return Object.keys(src)
    .map((k) => ({ id: +k, n: src[k] | 0, name: engine.defName(+k) }))
    .filter((e) => e.id > 0 && e.n > 0)
    .sort((a, b) => a.id - b.id)
})

/* 按容量铺成格子：空格子也画出来 —— 得让人看得见「还剩几格」。 */
const cells = computed(() => {
  const out = items.value.slice(0, cap.value)
  while (out.length < cap.value) out.push(null)
  return out
})

/* 箱子的列数：9 / 18 / 27 / 36 → 9 / 9 / 9 / 6？统一 9 列最规整，
 * 36 格就是 4 行。列数固定 9，窄屏再降。 */
const COLS = 9

/* 玩家背包：只显示有东西的格子（箱子已经够占地方了，不必再铺 54 个空格）。 */
const bag = computed(() => {
  const v = engine.invSlotsView ? engine.invSlotsView() : []
  return v.filter((s) => s.id && s.count > 0)
})

const used = computed(() => items.value.length)
const title = computed(() => (pos.value ? pos.value.name : '箱子'))

function chestTitle(c) {
  if (!c) return '空格'
  return c.name + ' ×' + c.n + ' · 点一下全部取出'
}
function bagTitle(s) {
  return s.name + ' ×' + s.count + ' · 点一下放进箱子'
}
</script>

<template>
  <div v-show="ui.chestOpen" class="chest" @click.self="engine.closeChest()">
    <div class="chestpanel">
      <div class="chesthead">
        <h2>{{ title }}</h2>
        <button class="chestclose" title="关闭（Esc）" @click="engine.closeChest()">✕</button>
      </div>
      <div class="sub">
        点箱子里的东西<b>全部取出</b> · 点背包里的东西<b>放进箱子</b>
        <span class="cap">已用 {{ used }}/{{ cap }} 格</span>
      </div>

      <!-- 箱子格 -->
      <div class="cgrid">
        <button
          v-for="(c, i) in cells" :key="'c' + i" class="cslot"
          :class="{ filled: !!c }" :title="chestTitle(c)"
          :disabled="!c" @click="c && engine.chestTake(c.id)"
        >
          <template v-if="c">
            <ItemIcon :id="c.id" />
            <span class="cnt">{{ c.n }}</span>
          </template>
        </button>
      </div>

      <div class="cfoot">
        <button class="ctakeall" :disabled="!items.length" @click="engine.chestTakeAll()">
          全部取出
        </button>
        <span class="tip">箱子里的东西会随存档保存</span>
        <button class="cdone" @click="engine.closeChest()">关上箱盖</button>
      </div>

      <!-- 背包（只列有东西的格子） -->
      <div class="invlab">背包 · 点一下放进箱子</div>
      <div v-if="!bag.length" class="cempty">背包是空的</div>
      <div v-else class="bgrid">
        <button
          v-for="s in bag" :key="s.i" class="bslot filled"
          :title="bagTitle(s)" @click="engine.chestPut(s.id)"
        >
          <ItemIcon :id="s.id" />
          <span class="cnt">{{ s.count }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chest {
  position: fixed;
  inset: 0;
  z-index: 32;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 7, 13, .74);
  backdrop-filter: blur(6px);
}

.chestpanel {
  width: min(760px, 95vw);
  max-height: 88vh;
  overflow: auto;
  border-radius: 20px;
  padding: 18px 20px 16px;
  background:
    radial-gradient(120% 80% at 12% 0%, rgba(214, 168, 92, .16), transparent 62%),
    linear-gradient(160deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .02));
  border: 1px solid var(--panel-brd);
  box-shadow: 0 30px 90px rgba(0, 0, 0, .72);
}

.chesthead {
  display: flex;
  align-items: center;
  justify-content: space-between
}

.chesthead h2 {
  margin: 0;
  font-size: 17px;
  color: #e0b768;
  letter-spacing: .5px;
}

.chestclose {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
}

.chestclose:hover {
  color: #e0b768;
  border-color: #e0b768
}

.sub {
  color: var(--dim);
  font-size: 11.5px;
  line-height: 1.7;
  margin: 4px 0 12px
}

.sub b {
  color: #e0b768;
  font-weight: 600
}

.cap {
  float: right;
  color: var(--accent);
  letter-spacing: 0
}

/* 箱子格：与背包格同尺寸，视觉上是一套东西 */
.cgrid,
.bgrid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 6px
}

.cslot,
.bslot {
  --ic: 30px;
  position: relative;
  aspect-ratio: 1;
  border-radius: 9px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .045);
  display: flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  color: inherit;
  padding: 0;
  transition: transform .1s, border-color .1s, background .1s;
}

.cslot:disabled {
  cursor: default
}

.cslot.filled,
.bslot.filled {
  border-color: rgba(224, 183, 104, .45);
  background: rgba(224, 183, 104, .10);
  cursor: pointer
}

.cslot.filled:hover,
.bslot.filled:hover {
  border-color: #e0b768;
  transform: translateY(-2px)
}

.cslot .cnt,
.bslot .cnt {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

.cfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid rgba(255, 255, 255, .07);
}

.cfoot .tip {
  font-size: 10.5px;
  color: var(--dim)
}

.ctakeall,
.cdone {
  flex: 0 0 auto;
  padding: 7px 13px;
  border-radius: 9px;
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
}

.ctakeall {
  border-color: rgba(224, 183, 104, .45);
  background: rgba(224, 183, 104, .12);
  color: #e0b768
}

.ctakeall:hover:not(:disabled) {
  background: rgba(224, 183, 104, .24)
}

.ctakeall:disabled {
  opacity: .4;
  cursor: not-allowed
}

.cdone:hover {
  color: #e0b768;
  border-color: #e0b768
}

.invlab {
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: .6px;
  margin: 14px 0 6px
}

.cempty {
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, .13);
  color: var(--dim);
  font-size: 11.5px;
  text-align: center
}

/* 窄屏：9 列在 360 宽的机器上一格只剩 32px，图标会被挤到贴边 → 降 6 列 */
@media (max-width: 720px) {
  .cgrid,
  .bgrid {
    grid-template-columns: repeat(6, 1fr);
    gap: 5px
  }

  .cfoot .tip {
    display: none
  }
}
</style>
