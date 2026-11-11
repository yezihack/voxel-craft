<script setup>
import { computed, ref } from 'vue'
import { engine } from '../engine.js'

/* 拼写词表：把 370 个可拼词条列成「各种单词的选项」。
 *
 * 数据来自 spell.js 的 spellBookEntries()（纯函数，已经排除 3×3 摆不下的长词），
 * 点一条走 engine.pickSpellEntry(key) 自动把字块摆进九宫格 —— 与配方书
 * 「点一条自动摆料」是同一套操作，玩家不用重新学。
 *
 * 中文文本走 DOM（ADR-0003），不烘进贴图集，所以这里直接渲染 text / pinyin。 */
const q = ref('')
const lang = ref('all')
const all = computed(() => (engine.spellBookEntries ? engine.spellBookEntries() : []))

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return all.value.filter((e) => {
    if (lang.value !== 'all' && e.lang !== lang.value) return false
    if (!s) return true
    return e.key.includes(s) ||
      String(e.text).toLowerCase().includes(s) ||
      String(e.gloss).toLowerCase().includes(s) ||
      String(e.pinyin).toLowerCase().includes(s) ||
      String(e.topicName).toLowerCase().includes(s) ||
      String(e.rhyme).toLowerCase().includes(s)
  })
})

const subOf = (e) => e.lang === 'zh' ? (e.pinyin || '拼音词语') : (e.gloss || e.rhyme || '英语词条')
const titleOf = (e) => e.text + (e.lang === 'zh' ? ' · ' + e.pinyin : e.gloss ? ' · ' + e.gloss : '') +
  '\n字母序列：' + e.key + '（' + e.key.length + ' 格）' +
  (e.topicName ? '\n主题：' + e.topicName : '') +
  '\n点一下自动摆进合成台，再点绿色结果格完成'
</script>

<template>
  <div class="spellbook">
    <div class="spelltools">
      <input v-model="q" class="spellsearch" type="search" placeholder="搜单词 / 拼音 / 释义…" />
      <div class="spelllangs">
        <button :class="{ on: lang === 'all' }" @click="lang = 'all'">全部</button>
        <button :class="{ on: lang === 'en' }" @click="lang = 'en'">英语</button>
        <button :class="{ on: lang === 'zh' }" @click="lang = 'zh'">拼音</button>
      </div>
    </div>
    <div class="spellhint">
      点一个词自动摆好字块，再点绿色结果格完成 · 字块要连着摆，最长 9 个字母
      <span class="spellcount">{{ list.length }} 条</span>
    </div>
    <div class="spelllist">
      <button
        v-for="e in list" :key="e.key" class="sp" :data-key="e.key" :data-lang="e.lang"
        :title="titleOf(e)" @click="engine.pickSpellEntry(e.key)"
      >
        <span class="sptext">{{ e.text }}</span>
        <span class="spsub">{{ subOf(e) }}</span>
        <span class="spkey">{{ e.key }} · {{ e.key.length }}</span>
      </button>
      <div v-if="!list.length" class="spellempty">没有匹配的词条</div>
    </div>
  </div>
</template>

<style scoped>
.spellbook {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.spelltools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spellsearch {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 9px;
  border-radius: 8px;
  font: inherit;
  font-size: 11px;
  color: var(--txt);
  border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .05);
  outline: none;
}

.spellsearch:focus {
  border-color: var(--accent);
}

.spelllangs {
  display: flex;
  gap: 3px;
  flex: 0 0 auto;
}

.spelllangs button {
  padding: 5px 8px;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .04);
  color: var(--dim);
}

.spelllangs button.on {
  border-color: var(--accent);
  color: var(--txt);
  background: rgba(67, 224, 255, .12);
}

.spellhint {
  font-size: 10px;
  color: var(--dim);
  line-height: 1.4;
}

.spellcount {
  float: right;
  color: var(--accent);
}

.spelllist {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
  max-height: 176px;
  overflow: auto;
  padding-right: 2px;
}

.sp {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-height: 48px;
  padding: 6px 7px;
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .04);
  color: var(--txt);
  transition: transform .1s, border-color .1s, background .1s;
}

.sp:hover {
  border-color: var(--accent);
  background: rgba(67, 224, 255, .10);
  transform: translateY(-2px);
}

.sptext {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spsub {
  font-size: 9.5px;
  color: var(--dim);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spkey {
  font-size: 9px;
  letter-spacing: .5px;
  color: rgba(94, 224, 138, .85);
}

.sp[data-lang="zh"] .spkey {
  color: rgba(255, 196, 92, .9);
}

.spellempty {
  grid-column: 1 / -1;
  padding: 14px 4px;
  font-size: 11px;
  color: var(--dim);
  text-align: center;
}
</style>
