<script setup>
import { computed } from 'vue'
import { engine, ui } from '../engine.js'
import ItemIcon from './ui/ItemIcon.vue'

/* 附魔台面板。
 *
 * 左：可上台的装备（生存模式 = 背包里真有的，创造模式 = 全部可附魔物品）
 * 右：这件装备适用的词条，每条给出「现在 → 下一级」的效果与材料
 *
 * 视觉口径和背包面板一致（同一套深色玻璃面板），但词条行按各自的 hue 上色 ——
 * 八条词条一眼分得开，不用读字也能扫。
 *
 * ⚠ 全部派生数据都走 engine.*View()，组件里不自己算规则：
 *   词条表 / 成本 / 背包够不够都在引擎侧（enchant.js + selectors.js），
 *   组件只负责把它画出来。这样无头测试能直接断言数值，不用去啃 DOM。 */
const targets = computed(() => (engine.enchantTargetsView ? engine.enchantTargetsView() : []))
const offers = computed(() => (engine.enchantOffersView ? engine.enchantOffersView() : []))
const target = computed(() => (engine.enchantTargetView ? engine.enchantTargetView() : null))

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`
const pips = (o) => Array.from({ length: o.max }, (_, i) => i < o.level)
const actionLabel = (o) => (o.maxed ? '已满' : o.level ? '升级' : '铭刻')
</script>

<template>
  <div v-show="ui.enchantOpen" class="ench" @click.self="engine.closeEnchant()">
    <div class="enchpanel">
      <div class="enchead">
        <h2>附魔台</h2>
        <button class="enchclose" title="关闭（Esc）" @click="engine.closeEnchant()">✕</button>
      </div>
      <div class="sub">
        选一件装备放上台面，挑一条词条铭刻 —— 材料按等级递增，等级越高越贵。
        <b>铭刻记在装备种类上，同类装备共享</b>（换一把新剑不用重刻）。
      </div>

      <div class="enchbody">
        <!-- 左：可铭刻的装备 -->
        <div class="enchside">
          <div class="enchlab">台面 · 点一下摆上去</div>
          <div v-if="!targets.length" class="enchempty">
            背包里没有能铭刻的装备。<br>
            武器 / 工具 / 护甲 / 弓 / 盾 才能上台。
          </div>
          <div class="enchgrid">
            <button
              v-for="t in targets" :key="t.id" class="etgt" :class="{ on: t.on, has: t.n }"
              :title="t.name + (t.summary ? ' · ' + t.summary : ' · 还没铭刻')"
              @click="engine.enchantPickItem(t.id)"
            >
              <ItemIcon :id="t.id" />
              <span class="nm">{{ t.name }}</span>
              <span v-if="t.count > 1" class="cnt">{{ t.count }}</span>
              <span v-if="t.n" class="dot" />
            </button>
          </div>
        </div>

        <!-- 右：词条 -->
        <div class="enchmain">
          <div class="enchlab">
            <template v-if="target">「{{ target.name }}」可铭刻的词条</template>
            <template v-else>先把装备摆上台面</template>
            <span v-if="target && target.summary" class="nowon">已刻：{{ target.summary }}</span>
          </div>

          <div v-if="!target" class="enchempty">
            点左边任意一件装备 → 这里会列出它能刻的词条
          </div>
          <div v-else-if="!offers.length" class="enchempty">这件装备没有适用的词条</div>

          <div v-else class="enchrows">
            <div
              v-for="o in offers" :key="o.key" class="row"
              :class="{ maxed: o.maxed, can: o.can }"
            >
              <div class="tag" :style="{ background: rgb(o.hue) }">{{ o.tag }}</div>
              <div class="mid">
                <div class="l1">
                  <b>{{ o.name }}</b>
                  <span class="pips">
                    <i v-for="(on, i) in pips(o)" :key="i" :class="{ on }" :style="on ? { background: rgb(o.hue) } : null" />
                  </span>
                  <span class="lv">{{ o.level }}/{{ o.max }}</span>
                </div>
                <div class="l2">
                  <template v-if="o.maxed">{{ o.now }}</template>
                  <template v-else>
                    <span class="next">{{ o.desc }}</span>
                    <span v-if="o.level" class="was">（现在：{{ o.now }}）</span>
                  </template>
                </div>
              </div>
              <div class="cost">
                <span v-for="c in o.cost" :key="c.id" class="ci" :class="{ bad: !c.ok }"
                      :title="c.name + ' · 需要 ' + c.n + ' · 现有 ' + c.have">
                  <ItemIcon :id="c.id" /><em>{{ c.n }}</em>
                </span>
                <span v-if="!o.cost.length" class="ci none">—</span>
              </div>
              <button class="go" :disabled="!o.can" @click="engine.enchantInscribe(o.key)">
                {{ actionLabel(o) }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="enchfoot">
        <span class="tip">材料从背包直接扣 · 创造模式不扣材料 · 同类装备共享铭刻</span>
        <button class="enchdone" @click="engine.closeEnchant()">关上台面</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ench {
  position: fixed;
  inset: 0;
  z-index: 31;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 7, 13, .74);
  backdrop-filter: blur(6px);
}

.enchpanel {
  width: min(940px, 95vw);
  max-height: 88vh;
  overflow: auto;
  border-radius: 20px;
  padding: 18px 20px 16px;
  background:
    radial-gradient(120% 80% at 12% 0%, rgba(150, 110, 240, .16), transparent 62%),
    linear-gradient(160deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .02));
  border: 1px solid var(--panel-brd);
  box-shadow: 0 30px 90px rgba(0, 0, 0, .72);
}

.enchead {
  display: flex;
  align-items: center;
  justify-content: space-between
}

.enchead h2 {
  margin: 0;
  font-size: 17px;
  color: #c9a8ff;
  letter-spacing: .5px;
}

.enchclose {
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

.enchclose:hover {
  border-color: #c9a8ff;
  color: var(--txt)
}

.sub {
  color: var(--dim);
  font-size: 11.5px;
  line-height: 1.6;
  margin: 4px 0 14px;
}

.sub b {
  color: #c9a8ff;
  font-weight: 600
}

.enchbody {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.enchside {
  flex: 0 0 232px;
  min-width: 0;
}

.enchmain {
  flex: 1 1 auto;
  min-width: 0;
}

.enchlab {
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: .6px;
  margin-bottom: 7px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nowon {
  margin-left: auto;
  color: #c9a8ff;
  letter-spacing: 0;
}

.enchempty {
  padding: 14px;
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, .13);
  color: var(--dim);
  font-size: 11.5px;
  line-height: 1.7;
  text-align: center;
}

.enchgrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  max-height: 320px;
  overflow: auto;
}

.etgt {
  --ic: 26px;
  position: relative;
  height: 60px;
  border-radius: 10px;
  cursor: pointer;
  padding: 3px 2px;
  border: 1.5px solid rgba(255, 255, 255, .10);
  background: rgba(255, 255, 255, .045);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font: inherit;
  color: inherit;
  transition: transform .1s, border-color .1s, background .1s;
}

.etgt:hover {
  border-color: #c9a8ff;
  transform: translateY(-2px)
}

.etgt.on {
  border-color: #c9a8ff;
  background: rgba(150, 110, 240, .18);
  box-shadow: 0 0 0 2px rgba(150, 110, 240, .22);
}

.etgt .nm {
  font-size: 9px;
  color: var(--dim);
  max-width: 100%;
  padding: 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.etgt.on .nm {
  color: var(--txt)
}

.etgt .cnt {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 9.5px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000, 0 0 2px #000;
}

/* 右上角的小紫点 = 这件（种）装备上已经有词条了 */
.etgt .dot {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c9a8ff;
  box-shadow: 0 0 6px rgba(201, 168, 255, .9);
}

.enchrows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, .09);
  background: rgba(255, 255, 255, .035);
}

.row.can {
  border-color: rgba(150, 110, 240, .38);
  background: rgba(150, 110, 240, .09);
}

.row.maxed {
  opacity: .62
}

.tag {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #0a0c12;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, .22);
}

.mid {
  flex: 1 1 auto;
  min-width: 0;
}

.l1 {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--txt);
}

.pips {
  display: inline-flex;
  gap: 2px
}

.pips i {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: rgba(255, 255, 255, .16);
  display: block;
}

.lv {
  font-size: 9.5px;
  color: var(--dim)
}

.l2 {
  font-size: 10.5px;
  color: var(--dim);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.l2 .next {
  color: var(--ok)
}

.l2 .was {
  color: var(--dim);
  opacity: .8
}

.cost {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
}

.ci {
  --ic: 18px;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 9.5px;
  color: var(--dim);
}

.ci em {
  font-style: normal;
  font-weight: 700;
  color: var(--txt)
}

.ci.bad em {
  color: #ff8a8a
}

.ci.none {
  opacity: .5
}

.go {
  flex: 0 0 auto;
  min-width: 52px;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(150, 110, 240, .5);
  background: rgba(150, 110, 240, .18);
  color: #d9c6ff;
  transition: background .12s, border-color .12s;
}

.go:hover:not(:disabled) {
  background: rgba(150, 110, 240, .34);
  border-color: #c9a8ff
}

.go:disabled {
  cursor: not-allowed;
  opacity: .42;
  border-color: rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .04);
  color: var(--dim);
}

.enchfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  padding-top: 11px;
  border-top: 1px solid rgba(255, 255, 255, .07);
}

.enchfoot .tip {
  font-size: 10.5px;
  color: var(--dim);
}

.enchdone {
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 9px;
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .05);
  color: var(--dim);
}

.enchdone:hover {
  border-color: #c9a8ff;
  color: var(--txt)
}

/* 窄屏：左右改上下，装备格 6 列 —— 4 列在 360 宽的机器上一格只剩 40px，
 * 图标 26px 会被挤到贴边。 */
@media (max-width: 720px) {
  .enchbody {
    flex-direction: column
  }

  .enchside {
    flex: 0 0 auto;
    width: 100%
  }

  .enchgrid {
    grid-template-columns: repeat(6, 1fr);
    max-height: 150px;
  }

  .l2 .was {
    display: none
  }

  .enchfoot .tip {
    display: none
  }
}
</style>
