<script setup>
import { computed, ref } from 'vue'
import { engine } from '../engine.js'
import ItemIcon from './ui/ItemIcon.vue'
import RecipeBook from './RecipeBook.vue'
import SpellBook from './SpellBook.vue'

/* 3×3 合成台 + 字母盘 + 结果格 + 右边的配方书 / 词表。
 * 两种模式都显示（见 BagPanel）；右边默认停在「词表」，因为拼单词 / 拼音
 * 这个入口以前完全找不到，而配方书一键就能切回来。 */
const slots = computed(() => (engine.craftSlots ? [...engine.craftSlots] : []))
const result = computed(() => (engine.craftResult ? engine.craftResult() : null))
const glyphs = computed(() => engine.GLYPH_PAD || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
const tab = ref('spell')

const slotTitle = (id) => (id
  ? engine.defName(id) + '（点一下放回背包）'
  : '合成格 · 点背包里的格子放材料')
const outTitle = computed(() => {
  const r = result.value
  if (!r) return '把材料按配方摆进左边的九宫格；摆一行字块可以拼出单词或拼音'
  /* 拼写不给物品 —— 产物就是这个词本身，点一下算完成一次课业 */
  if (r.spell) {
    const e = r.spell.entries[0]
    return '拼成了「' + e.text + '」' + (e.gloss ? ' · ' + e.gloss : e.pinyin ? ' · ' + e.pinyin : '')
  }
  return '取走 ' + engine.defName(r.out) + ' ×' + r.n
})
</script>

<template>
  <div class="craftbox">
    <div class="craftleft">
      <div class="craftrow">
        <div class="craftgrid">
          <div
            v-for="(id, i) in slots" :key="i" class="cslot" :class="{ filled: !!id }"
            :title="slotTitle(id)" @click="engine.clearCraftSlot(i)"
          >
            <template v-if="id">
              <ItemIcon :id="id" />
              <span class="cnt">1</span>
            </template>
          </div>
        </div>
        <div class="craftarrow">➜</div>
        <div
          class="craftout" :class="{ can: !!result }" :title="outTitle"
          @click="engine.takeCraftResult()"
        >
          <template v-if="result && result.spell">
            <span class="spellword">{{ result.spell.entries[0].text }}</span>
          </template>
          <template v-else-if="result">
            <ItemIcon :id="result.out" />
            <span class="cnt">{{ result.n }}</span>
          </template>
          <span v-else class="none">?</span>
        </div>
      </div>
      <div class="glyphpad" title="点字母把字块摆进合成格；字块不占背包">
        <button
          v-for="ch in glyphs" :key="ch" class="gp" :data-ch="ch"
          :title="'字块·' + ch" @click="engine.placeGlyph(ch)"
        >{{ ch }}</button>
        <button class="gpback" title="退掉最后一个字块" @click="engine.undoGlyph()">←</button>
      </div>
    </div>
    <div class="craftright">
      <div class="crafthead">
        <div class="crafttabs">
          <button
            class="crafttab" :class="{ on: tab === 'spell' }" data-tab="spell"
            @click="tab = 'spell'"
          >词表 · 单词 / 拼音</button>
          <button
            class="crafttab" :class="{ on: tab === 'recipe' }" data-tab="recipe"
            @click="tab = 'recipe'"
          >配方书</button>
        </div>
        <button class="craftfill" @click="engine.clearCraftAll()">清空合成格</button>
      </div>
      <SpellBook v-show="tab === 'spell'" />
      <RecipeBook v-show="tab === 'recipe'" />
    </div>
  </div>
</template>

<style scoped>
.craftbox {
  display: flex;
  gap: 18px;
  margin-bottom: 14px;
  align-items: flex-start;
}

.craftleft {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 9px;
  flex: 0 0 auto;
}

.craftrow {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* A–Z 字母盘：27 个按钮（26 字母 + 退一格）正好 9×3，
 * 宽度跟上面的九宫格 + 箭头 + 结果格对齐，不额外撑宽面板。 */
.glyphpad {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 3px;
}

.glyphpad button {
  height: 24px;
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(236, 226, 200, .22);
  background: rgba(236, 226, 200, .07);
  color: var(--txt);
  transition: border-color .1s, background .1s, transform .1s;
}

.glyphpad button:hover {
  border-color: var(--accent);
  background: rgba(67, 224, 255, .16);
  transform: translateY(-1px);
}

.glyphpad .gpback {
  color: var(--dim);
  border-style: dashed;
}

.craftgrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}

.cslot {
  --ic: 28px;
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 9px;
  cursor: pointer;
  border: 1.5px solid rgba(255, 255, 255, .12);
  background: rgba(255, 255, 255, .05);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .1s, border-color .1s, background .1s;
}

.cslot:hover {
  border-color: var(--accent);
  transform: translateY(-2px)
}

.cslot.filled {
  border-color: rgba(67, 224, 255, .5);
  background: rgba(67, 224, 255, .10)
}

.cslot .cnt {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

.craftarrow {
  color: var(--dim);
  font-size: 19px
}

.craftout {
  --ic: 38px;
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 12px;
  cursor: pointer;
  border: 1.5px dashed rgba(94, 224, 138, .5);
  background: rgba(94, 224, 138, .08);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .1s, border-color .1s, background .1s;
}

.craftout.can {
  border-style: solid;
  border-color: var(--ok);
  background: rgba(94, 224, 138, .20);
  box-shadow: 0 0 16px rgba(94, 224, 138, .28)
}

.craftout.can:hover {
  transform: scale(1.06)
}

.craftout .cnt {
  position: absolute;
  right: 4px;
  bottom: 3px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

.craftout .none {
  color: var(--dim);
  font-size: 20px
}

/* 拼写的产物是**词本身**（ADR-0003：中文走 DOM 覆盖层，不做方块贴图）。
 * 60px 的格子装得下 3~4 个汉字，更长的词靠缩小字号兜住。 */
.craftout .spellword {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  line-height: 1.15;
  text-align: center;
  padding: 0 4px;
  word-break: break-all;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

.craftright {
  flex: 1 1 auto;
  min-width: 0
}

.crafthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: .6px;
  margin-bottom: 6px;
  white-space: nowrap;
}

.crafttabs {
  display: flex;
  gap: 4px;
  min-width: 0;
}

.crafttab {
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
}

.crafttab.on {
  border-color: var(--accent);
  background: rgba(67, 224, 255, .12);
  color: var(--txt);
}

.crafttab:hover {
  color: var(--txt);
}

.craftfill {
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
}

.craftfill:hover {
  border-color: var(--accent);
  color: var(--txt)
}
</style>
