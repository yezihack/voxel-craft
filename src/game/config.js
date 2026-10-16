import { reactive } from 'vue'

/* 常量配置：世界尺寸、方块表、物品表、贴图集规划、顶点布局 —— 迁移自 voxel-craft.html 第 565-1154 行 */

/* ⚠ 这里**不能** import survival.js。
 * 原单文件里「手持物品 id」是个随手可取的全局量，拆成模块后如果直接
 * `import { heldId } from './survival.js'`，就会形成 config → survival 这条边，
 * 于是 survival 及其整棵子树（generate / dims / input / mobs / textures / portal…）
 * 全部要在 config 自身的常量就位之前求值 —— 那些模块的顶层正好要读
 * ATLAS_PX / DIM_N / SUMMON_OF / TP 之类的表，会集体撞上 TDZ
 * （报错形如 "Cannot access 'ATLAS_PX' before initialization"）。
 * 所以改成依赖注入：config 只留一个可替换的读取器，由 survival.js 在
 * 自己的模块体里调 setHeldIdReader() 装上去。state.js 是纯叶模块，可以安全引入。 */
import { selected } from './state.js'

/* 当前手持物品 id。默认按创造模式的固定调色板算（与 survival.js 的
 * activeSlots() 在创造模式下等价）；生存模式由 survival.js 覆盖。 */
export let readHeldId = () => HOTBAR[selected] | 0;
export function setHeldIdReader(fn) { readHeldId = fn; }

/* 生物档案表。定义在 mobs.js（第 6301 行那段），而 mobs.js 的顶层要读本模块的
 * SUMMON_OF / EGG_OF / JUMP_V —— 所以这里同样只能「被注入」，不能反向 import。
 * 只有 itemTip() 会用到它，而 itemTip 是界面渲染时调的，那时引擎早已就绪。 */
let MOB_TYPES = {};
export function setMobTypes(t) { MOB_TYPES = t; }

/* ============================== 常量配置 ============================== */
export const W = 96, H = 64, D = 96;        // 世界尺寸（局部地形）
export const CX = 4, CY = 4, CZ = 4;        // 区块划分 4×4×4
export const CW = W / CX, CH = H / CY, CD = D / CZ;  // 单区块尺寸 24×16×24
export const SEA = 16;                      // 海平面
/* 世界种子。地形是纯函数，所有随机性都由它 + 世界坐标决定。
 * 用 let 而不是 const：generate(seed) 仍可换种子（换完地形立刻整体改变）。 */

export const REACH = 6.5;                   // 交互距离
export const G = 26;                        // 重力加速度
export const JUMP_V = 9.0;                  // 起跳速度
export const EYE = 1.62;                    // 视点高度
export const PW = 0.30;                     // 玩家半径（AABB 半宽）

/* 方块表：id → 属性
 *   tex          : 贴图名；单字符串表示六面同图，或 { top, side, bot } 分别指定。
 *                  贴图本身由 canvas 程序化生成（见「程序化贴图」段），不引任何图片文件。
 *   top/side/bot : 基础色 —— 仅作 UI 回退色，以及羊毛/矿石的着色参数（贴图按它生成）
 *   n            : 物品栏里显示的短名（1 个汉字）
 *   hard         : 生存模式挖掘耗时（秒）；liquid 的方块不可挖
 *   drop         : 掉落物 id（默认掉自己；0 = 不掉落）
 *   dropN        : 掉落数量（默认 1）
 *   bonus        : 额外掉落 { id, p, n } —— 例如树叶掉苹果
 *   ore          : 矿点色 —— 生成矿石贴图时用它画矿点簇
 *   hurt         : 接触伤害（仙人掌）
 *   light        : 自发光（AO 设下限，看起来在发亮）
 *   alpha        : 半透明（玻璃/水/冰）—— 走透明绘制趟，且不遮挡邻面
 *   liquid       : 液体（水/岩浆）—— 不碰撞、可被替换
 *   hot          : 岩浆等高温流体，接触扣血
 *   cutout       : 贴图带镂空（树叶）—— 走 alpha 裁剪而非混合
 * 注意：1~15 的 id 已被地形生成、射线、音效等处的既有逻辑引用，语义不可改。 */
export const BLOCKS = [
  null,
  { name:'草方块', top:[ 96,168, 74], side:[124,150, 78], bot:[134,102, 68], n:'草', hard:.45, drop:2,
    tex:{ top:'grass_top', side:'grass_side', bot:'dirt' } },
  { name:'泥土',   top:[134,102, 68], side:[134,102, 68], bot:[134,102, 68], n:'土', hard:.40, tex:'dirt' },
  { name:'石头',   top:[132,134,138], side:[132,134,138], bot:[132,134,138], n:'石', hard:1.50, drop:4, tex:'stone' },
  { name:'圆石',   top:[110,112,116], side:[110,112,116], bot:[110,112,116], n:'圆', hard:1.40, tex:'cobble' },
  { name:'沙子',   top:[223,209,152], side:[223,209,152], bot:[223,209,152], n:'沙', hard:.40, tex:'sand' },
  { name:'原木',   top:[164,129, 80], side:[ 96, 68, 42], bot:[164,129, 80], n:'木', hard:.90,
    tex:{ top:'log_top', side:'log_side', bot:'log_top' } },
  { name:'树叶',   top:[ 62,140, 62], side:[ 56,128, 56], bot:[ 62,140, 62], n:'叶', hard:.25, drop:0,
    bonus:{ id:200, p:.14 }, tex:'leaves', cutout:true },
  { name:'木板',   top:[176,140, 88], side:[176,140, 88], bot:[176,140, 88], n:'板', hard:.80, tex:'plank' },
  { name:'砖块',   top:[164, 84, 70], side:[164, 84, 70], bot:[164, 84, 70], n:'砖', hard:1.60, tex:'brick' },
  { name:'玻璃',   top:[190,220,240], side:[190,220,240], bot:[190,220,240], n:'玻', alpha:.42, hard:.30, drop:0,
    tex:'glass' },
  { name:'水',     top:[ 56,118,200], side:[ 50,106,186], bot:[ 50,106,186], n:'水', alpha:.72, liquid:true,
    tex:'water' },
  { name:'雪块',   top:[238,243,250], side:[238,243,250], bot:[238,243,250], n:'雪', hard:.25, tex:'snow' },
  { name:'黑曜石', top:[ 34, 28, 48], side:[ 34, 28, 48], bot:[ 34, 28, 48], n:'曜', hard:6.00, tex:'obsidian' },
  { name:'萤石',   top:[252,228,140], side:[248,214,120], bot:[248,214,120], n:'萤', light:1, hard:1.20,
    tex:'glowstone' },
  { name:'南瓜',   top:[226,146, 46], side:[216,132, 40], bot:[226,146, 46], n:'瓜', hard:.70,
    tex:{ top:'pumpkin_top', side:'pumpkin_side', bot:'pumpkin_top' } },

  /* ---------------- 新增方块：建材与地貌 ---------------- */
  { name:'沙岩',   top:[222,208,158], side:[214,199,148], bot:[196,180,132], n:'岩', hard:1.30,
    tex:{ top:'sandstone_top', side:'sandstone_side', bot:'sandstone_top' } },
  { name:'石砖',   top:[126,128,132], side:[126,128,132], bot:[126,128,132], n:'砖', hard:1.50, tex:'stonebrick' },
  { name:'苔石',   top:[100,118, 88], side:[ 92,110, 82], bot:[ 92,110, 82], n:'苔', hard:1.40, tex:'mossy_stone' },
  { name:'粘土',   top:[160,168,178], side:[152,160,172], bot:[152,160,172], n:'粘', hard:.55, tex:'clay' },
  { name:'冰块',   top:[176,214,242], side:[166,206,238], bot:[166,206,238], n:'冰', alpha:.62, hard:.50, tex:'ice' },
  { name:'书架',   top:[176,140, 88], side:[146,112, 66], bot:[176,140, 88], n:'书', hard:.85,
    tex:{ top:'plank', side:'bookshelf', bot:'plank' } },
  { name:'仙人掌', top:[ 78,140, 70], side:[ 62,120, 58], bot:[ 78,140, 70], n:'掌', hard:.45, hurt:1,
    tex:{ top:'cactus_top', side:'cactus_side', bot:'cactus_top' } },
  { name:'南瓜灯', top:[240,166, 62], side:[232,146, 44], bot:[226,146, 46], n:'灯', light:1, hard:.70,
    tex:{ top:'pumpkin_top', side:'jack_side', bot:'pumpkin_top' } },
  { name:'岩浆',   top:[232,118, 36], side:[214, 88, 24], bot:[198, 74, 18], n:'岩', liquid:true, hot:true,
    light:1, alpha:.9, tex:'lava' },
  { name:'羊毛·白', top:[236,238,242], side:[236,238,242], bot:[236,238,242], n:'白', hard:.35, tex:'wool_white' },
  { name:'羊毛·红', top:[196, 62, 62], side:[196, 62, 62], bot:[196, 62, 62], n:'红', hard:.35, tex:'wool_red' },
  { name:'羊毛·蓝', top:[ 62, 92,196], side:[ 62, 92,196], bot:[ 62, 92,196], n:'蓝', hard:.35, tex:'wool_blue' },
  { name:'羊毛·黄', top:[226,198, 66], side:[226,198, 66], bot:[226,198, 66], n:'黄', hard:.35, tex:'wool_yellow' },
  { name:'羊毛·绿', top:[ 84,166, 84], side:[ 84,166, 84], bot:[ 84,166, 84], n:'绿', hard:.35, tex:'wool_green' },
  { name:'羊毛·黑', top:[ 56, 56, 62], side:[ 56, 56, 62], bot:[ 56, 56, 62], n:'黑', hard:.35, tex:'wool_black' },
  { name:'石英块', top:[232,230,226], side:[232,230,226], bot:[232,230,226], n:'英', hard:1.10, tex:'quartz' },
  { name:'深色木板', top:[116, 84, 52], side:[116, 84, 52], bot:[116, 84, 52], n:'深', hard:.80, tex:'dark_plank' },

  /* ---------------- 矿石：石底 + 矿点簇贴图 ---------------- */
  { name:'煤矿石',   top:[132,134,138], side:[132,134,138], bot:[132,134,138], n:'煤', hard:2.2,
    ore:[ 40, 40, 44], tex:'ore_coal' },
  { name:'铁矿石',   top:[132,134,138], side:[132,134,138], bot:[132,134,138], n:'铁', hard:2.6,
    ore:[212,158,120], tex:'ore_iron' },
  { name:'金矿石',   top:[132,134,138], side:[132,134,138], bot:[132,134,138], n:'金', hard:3.0,
    ore:[246,204, 78], tex:'ore_gold' },
  { name:'钻石矿石', top:[132,134,138], side:[132,134,138], bot:[132,134,138], n:'钻', hard:3.4,
    ore:[ 92,226,232], tex:'ore_diamond' },
  { name:'红石矿石', top:[132,134,138], side:[132,134,138], bot:[132,134,138], n:'红', hard:2.8,
    ore:[220, 62, 62], tex:'ore_redstone' },

  /* ---------------- 农作物 ---------------- */
  { name:'胡萝卜丛', top:[106,168, 72], side:[ 96,142, 68], bot:[134,102, 68], n:'萝', hard:.30, drop:201, dropN:2,
    tex:{ top:'carrot', side:'carrot', bot:'dirt' } },

  /* ---------------- 维度方块（id 只许追加，见文件头 id 纪律） ----------------
   * 传送门：8 种，一种对应一个维度的配色。**方块 id 自身就是「这扇门通往哪」
   * 的全部信息** —— 传送时只查 PORTAL_DIM[id]，不需要任何按坐标建的映射表，
   * 存档/重建地形都不会丢。全部标 portal:true：
   *   · SOLID 里判为可穿过（否则走过去被自己的门板挡住）
   *   · 材质走 MAT_PORTAL，贴图不位移、只做发光呼吸（8 种贴图各自一色，
   *     逐格 uv 位移需要 8 个矩形 uniform，得不偿失）
   * hard 给 3.5：生存能拆但要挖一会儿，避免手滑点掉回家的唯一通道。 */
  { name:'传送门·主世界', top:[128, 74,208], side:[128, 74,208], bot:[128, 74,208], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_over' },
  { name:'传送门·熔火',   top:[216, 96, 32], side:[216, 96, 32], bot:[216, 96, 32], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_ember' },
  { name:'传送门·虚空',   top:[176, 72,224], side:[176, 72,224], bot:[176, 72,224], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_void' },
  { name:'传送门·霜寂',   top:[ 96,208,224], side:[ 96,208,224], bot:[ 96,208,224], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_frost' },
  { name:'传送门·晶簇',   top:[152,120,232], side:[152,120,232], bot:[152,120,232], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_crystal' },
  { name:'传送门·腐化',   top:[120,196, 72], side:[120,196, 72], bot:[120,196, 72], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_blight' },
  { name:'传送门·炙沙',   top:[232,196, 84], side:[232,196, 84], bot:[232,196, 84], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_dune' },
  { name:'传送门·花园',   top:[120,208,248], side:[120,208,248], bot:[120,208,248], n:'门', alpha:.62,
    portal:true, hard:3.5, tex:'portal_garden' },

  /* ---------------- 异界地形方块 ---------------- */
  { name:'玄武岩', top:[ 62, 58, 66], side:[ 52, 48, 56], bot:[ 46, 42, 50], n:'玄', hard:1.70, tex:'basalt' },
  { name:'末地石', top:[226,224,180], side:[218,216,172], bot:[210,208,164], n:'末', hard:1.60, tex:'endstone' },
  /* 晶簇岩自发光：晶洞里没有任何光源，靠它自己亮（light 会把 AO 抬到下限） */
  { name:'晶簇岩', top:[168,140,236], side:[150,118,226], bot:[136,106,212], n:'晶', light:1, hard:1.30,
    tex:'crystal' },
  { name:'蘑菇块', top:[196,178,172], side:[186,166,160], bot:[176,156,150], n:'菇', hard:.55, tex:'mushroom' },
  /* 毒沼：液体（不碰撞、可被替换）+ hurt 接触伤害。走的是「接触伤害方块」那条
   * 现成通道（updateSurvival 里扫玩家 AABB 内有没有 B.hurt），不新增机制。
   * ⚠ toxic:true 不是装饰 —— 它决定材质走 MAT_TOXIC 而不是 MAT_WATER。
   * 原因：水的 shader 分支会把 uv 位移**夹回「水」那张贴图自己那格**
   * （uWaterRect），毒沼的 uv 是从 toxic 贴图取样的，一旦被夹进水的矩形，
   * 整片毒沼会渲染成水色。给它单独的 flag，就绕开了那个 clamp。 */
  { name:'毒沼',   top:[104,176, 74], side:[ 88,156, 66], bot:[ 78,138, 58], n:'毒', alpha:.74,
    liquid:true, hurt:1, toxic:true, tex:'toxic' },
];

/* ---------------- 字块：A–Z ----------------
 * 英语拼写与汉语拼音**共用**这一套 26 种方块（ADR-0002）。
 * 拼音和英语各做一份的话是 52 格，共用只要 26 格 —— 贴图集余量有限，
 * 这个差别是决定性的；顺带「拼单词」和「看拼音写词语」也变成同一个交互。
 *
 * ⚠ 字块是**方块**（可放置），汉字是**物品**（不可放置）—— 分属不同 id 段，
 *   不要为了「统一」把它们混在一起（ADR-0002）。
 * ⚠ 声调不是字块的一部分：方块上只有不带调的字母，声调交给 DOM 层显示。
 * ⚠ 一律追加在表尾。往 BLOCKS 中间插方块会顶掉后面所有 id，裸数字会静默串味。 */
const GLYPH_PLATE = [236, 226, 200];         // 象牙白底板，配深色墨字
for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(65 + i);
  BLOCKS.push({
    name: '字块·' + ch, n: ch,
    top: GLYPH_PLATE, side: GLYPH_PLATE, bot: GLYPH_PLATE,
    hard: 0.35, tex: 'glyph_' + ch,
  });
}
/* 字母 ↔ 方块 id 的双向查表。拼写合成（spell.js）只认这两张表，不裸写 id。 */
export const GLYPH_BLOCK = {};
export const GLYPH_LETTER = {};
BLOCKS.forEach((b, i) => {
  if (!b || typeof b.tex !== 'string' || b.tex.indexOf('glyph_') !== 0) return;
  const ch = b.tex.slice(6);
  GLYPH_BLOCK[ch] = i;
  GLYPH_LETTER[i] = ch;
});
export const isGlyphBlock = (id) => GLYPH_LETTER[id] !== undefined;
export const GLYPH_CHARS = Object.keys(GLYPH_BLOCK);

export const SOLID = {};                    // id → 是否实体
/* 传送门不参与碰撞（portal:true）—— 不然玩家会站在自己的门板上，走不进另一个维度 */
BLOCKS.forEach((b, i) => { if (b) SOLID[i] = !b.liquid && !b.portal; });

/* ---------------- 贴图集规划 ----------------
 * 每个方块三类面（顶/侧/底）各需要一个贴图名。这里在**载入期**把用到的名字
 * 按首次出现顺序编号，得到一个「名字 → 格子号」的映射 —— 网格构建只依赖
 * 这个纯数据映射，不碰 canvas，所以无头测试也能验 UV 算得对不对。
 * 真正的像素绘制在「程序化贴图」段，启动时按同一份名单画进贴图集。 */
export const ATLAS_COLS = 16;                       // 贴图集横向格数（16×16 = 256 格）
/* 每格边长（像素）。16 → 32 是分辨率翻倍：图集从 256² 涨到 512²，
 * 格子数不变，但每格多了 4 倍像素可以画细节（木纹、砖缝、矿点高光）。
 *
 * ⚠ 贴图生成器里**不许再出现裸的 16 / 15 / 8 / 4** —— 那些数字以前是
 * 「格子边长」，翻倍后会全部失效（比如 `hash2(x >> 1)` 的降采样步长、
 * `x > 15` 的越界判断）。统一改成本文件派生常量：
 *   TP  = TILE_PX           格子边长
 *   TPM = TILE_PX - 1       最大下标
 *   TPH = TILE_PX >> 1      半格 */
export const TILE_PX = 32;                          // 每格 32×32 像素
export const ATLAS_PX = ATLAS_COLS * TILE_PX;
export const TP = TILE_PX, TPM = TILE_PX - 1, TPH = TILE_PX >> 1;

export function texNameOf(B, face) {
  const t = B.tex;
  if (!t) return null;
  if (typeof t === 'string') return t;
  return face === 'top' ? (t.top || t.side) : face === 'bot' ? (t.bot || t.side) : t.side;
}
/* 材质标志位 —— 每个顶点带一个 float，告诉 shader「这块是什么料」。
 * 顶点格式从 7 个 float 涨到 8 个，多出来的这一位专门用来驱动动画与自发光：
 *   0 普通实体   1 水   2 岩浆   3 植被   4 传送门   5 毒沼
 * ⚠ 数值必须**单调对应 shader 里的分支顺序**（FS 里是一串 `vFlag > 阈值`）。
 *   踩过的坑：给传送门加了 4、却没动 FS 里「树叶」那条 `vFlag > 2.5` ——
 *   4 同样满足 `> 2.5`，于是传送门整片走进树叶分支，门根本不发光。
 * 为什么值得多加一个属性通道：动画必须**逐方块**区分（水面在动、旁边的石头不能动），
 * 而顶点缓冲里除了位置/UV 之外没有任何「这是什么方块」的信息 —— 用 UV 反查格子号
 * 是要在 shader 里做除法和比较的，既慢又脆。多 4 个字节换来一个干净的开关。
 * ⚠ 新增/修改顶点属性时，四个 bind 函数（bindChunk / bindMob / bindHand /
 *   bindStick 用不到）与四处交错写入必须同步改 stride 和偏移，漏一处就是错位采样。 */
export const MAT_PLAIN = 0, MAT_WATER = 1, MAT_LAVA = 2, MAT_FOLIAGE = 3, MAT_PORTAL = 4, MAT_TOXIC = 5;
export function matFlagOf(B) {
  if (!B) return MAT_PLAIN;
  if (B.portal) return MAT_PORTAL;                     // 传送门：发光呼吸，uv 不动
  if (B.liquid) return B.hot ? MAT_LAVA : (B.toxic ? MAT_TOXIC : MAT_WATER);  // 岩浆 hot、毒沼 toxic
  if (B.cutout) return MAT_FOLIAGE;                    // 树叶（带镂空的植被）
  return MAT_PLAIN;
}

export const TILE_NAMES = [];                       // 格子号 → 贴图名
export const TILE_INDEX = {};                       // 贴图名 → 格子号
export const TILE_COLOR = {};                       // 贴图名 → 生成时用的基色
export const TILE_ORE = {};                         // 矿石贴图 → 矿点色
export function registerTile(name, B) {
  if (TILE_INDEX[name] === undefined) {
    TILE_INDEX[name] = TILE_NAMES.length;
    TILE_NAMES.push(name);
  }
  if (B) {
    if (!TILE_COLOR[name]) TILE_COLOR[name] = B.side || B.top;
    if (B.ore && !TILE_ORE[name]) TILE_ORE[name] = B.ore;
  }
  return TILE_INDEX[name];
}
/* ⚠ 必须分两趟注册。
 * TILE_COLOR[name] 是「画这张贴图时用的基色」，它必须来自**真正拥有这张贴图**
 * 的方块。但 registerTile 拿到谁就记谁的颜色，而方块是按 id 顺序遍历的 ——
 * 草方块（id 1）的 tex.bot 是 'dirt'，它先注册就把自己的侧面色（草绿）盖到了
 * TILE_COLOR['dirt'] 上；等泥土（id 2）来注册时 `if (!TILE_COLOR[name])` 已经
 * 拦下来了。结果：泥土贴图整片发绿、草方块侧面糊成一整块绿（本该是草皮+泥土）。
 * 第一趟只认 `tex` 是单张字符串的方块（它们才是贴图的归属者），
 * 第二趟再补草方块/原木这种 top·side·bot 各不相同的多面方块。 */
for (const ownOnly of [true, false]) {
  BLOCKS.forEach((B) => {
    if (!B || (typeof B.tex === 'string') !== ownOnly) return;
    registerTile(texNameOf(B, 'top'), B);
    registerTile(texNameOf(B, 'side'), B);
    registerTile(texNameOf(B, 'bot'), B);
  });
}

/* 取某个方块某一面的贴图格号 */
export function tileIndexOf(id, face) {
  const B = BLOCKS[id];
  if (!B) return 0;
  const n = texNameOf(B, face);
  const t = TILE_INDEX[n];
  return t === undefined ? 0 : t;
}
/* 方块或物品通用 */
export function tileOfId(id, face) {
  if (!id) return 0;
  if (isBlockId(id)) return tileIndexOf(id, face || 'side');
  const it = ITEMS[id];
  if (!it) return 0;
  const t = TILE_INDEX['item_' + it.tex];
  return t === undefined ? 0 : t;
}
/* 面内 (u,v) ∈ [0,1]² → 贴图集 UV。
 * 贴到「纹素中心」而不是格子边界（0.5 与 TILE_PX-1），
 * 否则 NEAREST 采样在格子接缝处会吸到隔壁贴图的边，出现细彩线。 */
export function tileUV(tileIndex, u, v) {
  const col = tileIndex % ATLAS_COLS;
  const row = Math.floor(tileIndex / ATLAS_COLS);
  const k = TILE_PX - 1;
  return [
    (col * TILE_PX + 0.5 + u * k) / ATLAS_PX,
    (row * TILE_PX + 0.5 + v * k) / ATLAS_PX,
  ];
}
/* 一格的 UV 包围盒 [u0, v0, u1, v1]（纹素中心到纹素中心）。
 * 水/岩浆的流动动画会平移 uv，夹在这个矩形里就绝不会采到隔壁贴图。
 * ⚠ 别和「程序化贴图」段里的 tileRect 搞混 —— 那个返回的是**画布像素原点**，
 *   同名不同义，当初差点直接撞上。这里把格子原点自己算一遍，好让本函数
 *   留在常量段内（无头测试的切片正好覆盖这里，覆盖不到贴图段）。 */
export function tileUVRect(tileIndex) {
  const col = tileIndex % ATLAS_COLS;
  const row = Math.floor(tileIndex / ATLAS_COLS);
  const k = TILE_PX - 1;
  return [
    (col * TILE_PX + 0.5) / ATLAS_PX,
    (row * TILE_PX + 0.5) / ATLAS_PX,
    (col * TILE_PX + 0.5 + k) / ATLAS_PX,
    (row * TILE_PX + 0.5 + k) / ATLAS_PX,
  ];
}
/* 水/岩浆流动动画要用的两个常量。放在这里（而不是 WebGL 段）是有意的：
 * 它们是纯数据，无头测试切片正好覆盖这一段，能在没有 GL 的沙箱里直接验。 */
export const TEXEL = 1 / ATLAS_PX;
export const WATER_RECT = tileUVRect(TILE_INDEX['water'] === undefined ? 0 : TILE_INDEX['water']);
export const LAVA_RECT  = tileUVRect(TILE_INDEX['lava']  === undefined ? 0 : TILE_INDEX['lava']);
/* 六面各自的四个角在面内的 (u,v)，与 FACES.v 一一对应。
 *
 * u 从 0 到 1 顺着面走（0,1,1,0）→ 不左右镜像。
 * v 特意**从 1 递减到 0**，也就是「角 0 → 贴图底边」，因为：
 *   · texImage2D 上传画布时没有 UNPACK_FLIP_Y_WEBGL，GL 的 t=0 落在画布的**首行**
 *     （视觉上的顶部）；
 *   · 而 FACES.v 里角 0 在各侧面上的投影正好落在**左下角**。
 * 两者一叠加，原本 (0,0) 的写法会把每张贴图上下颠倒：草方块的草皮长到方块底下、
 * 村民的眼长到嘴下面。只是绝大多数贴图上下近似对称（石头/沙子/木板/原木纹），
 * 一直没人看出来；把 TILE_COLOR['dirt'] 的串色修掉之后，草方块侧面才把它暴露出来。
 * 统一在这里翻 v，比在 4 个绘制点各翻一次可靠。 */
export const UV_QUAD = [[0, 1], [1, 1], [1, 0], [0, 0]];
/* 薄片的几何角（左下起逆时针，y 向上）。刻意与 UV_QUAD 分开：
 * UV_QUAD 是「贴图坐标」，这张是「顶点位置」，混用会让翻 v 顺带把几何也翻掉。 */
export const QUAD_POS = [[0, 0], [1, 0], [1, 1], [0, 1]];

/* ---------------- 顶点交错布局 ----------------
 * 区块 / 生物 / 手持 / 箭四种网格共用同一份布局，所以步长与偏移必须只有一处定义。
 * 放在常量段（而不是 WebGL 段）是有意的：它一半属于网格构建（谁产出这些字段）、
 * 一半属于渲染（谁消费），而且无头测试的切片正好覆盖这里，能直接钉住不变式。
 * 加字段时只需要改 STRIDE 和这张偏移表。 */
export const STRIDE = 8;                        // x, y, z, u, v, lit, alpha, flag
export const OFF_POS = 0, OFF_UV = 12, OFF_LIT = 20, OFF_ALPHA = 24, OFF_FLAG = 28;

/* 方块 id 别名。
 * 逻辑代码一律用 I.XXX 而不是裸数字 —— 往表里插一种新方块会顶掉后面所有
 * id，裸数字会静默串味（本次加方块时就踩到了：19 从「煤」变成「粘土」）。 */
export const ID = {};
BLOCKS.forEach((b, i) => { if (b) ID[b.name] = i; });
export const I = {
  AIR: 0,
  GRASS: ID['草方块'], DIRT: ID['泥土'], STONE: ID['石头'], COBBLE: ID['圆石'], SAND: ID['沙子'],
  LOG: ID['原木'], LEAF: ID['树叶'], PLANK: ID['木板'], BRICK: ID['砖块'], GLASS: ID['玻璃'],
  WATER: ID['水'], SNOW: ID['雪块'], OBSIDIAN: ID['黑曜石'], GLOW: ID['萤石'], PUMPKIN: ID['南瓜'],
  SANDSTONE: ID['沙岩'], STONEBRICK: ID['石砖'], MOSS: ID['苔石'], CLAY: ID['粘土'],
  ICE: ID['冰块'], BOOKSHELF: ID['书架'], CACTUS: ID['仙人掌'], LAMP: ID['南瓜灯'], LAVA: ID['岩浆'],
  COAL: ID['煤矿石'], IRON: ID['铁矿石'], GOLD: ID['金矿石'], DIAMOND: ID['钻石矿石'],
  REDSTONE: ID['红石矿石'], CARROT: ID['胡萝卜丛'],
  /* 建筑结构用材（SANDSTONE / BOOKSHELF 上面已有，不重复登记） */
  DARKPLANK: ID['深色木板'], QUARTZ: ID['石英块'],
  WOOL: ID['羊毛·白'], WOOL_RED: ID['羊毛·红'],
  /* 异界地形方块 */
  BASALT: ID['玄武岩'], ENDSTONE: ID['末地石'], CRYSTAL: ID['晶簇岩'],
  MUSHROOM: ID['蘑菇块'], TOXIC: ID['毒沼'],
};
/* 名字写错会静默拿到 undefined —— 早失败早发现 */
for (const k in I) if (I[k] === undefined) throw new Error('方块别名未定义: ' + k);

/* 传送门方块 ↔ 目标维度。
 * 方块 id 自带目标维度，所以「走进一扇门」= 查这张表，不需要额外映射。
 * 建在常量段是有意的：无头测试切片覆盖这里，能在没有 GL 的沙箱里直接断言
 * 「8 种门各自指向 8 个不同的维度、且每个维度都有门」。
 *
 * DIM_N（维度总数）也放这里而不是 dims.js：它是「8 种门 = 8 个维度」这件事的
 * 同一个数字，而且 generate.js / portal.js / actions.js 都要在**模块顶层**用它
 * 建表。放在 dims.js 会踩上 generate ↔ dims ↔ fluid 那圈循环引用，报
 * "Cannot access 'DIM_N' before initialization"。config.js 是叶模块，最安全。 */
export const DIM_N = 8;
export const PORTAL_BLOCK = [
  ID['传送门·主世界'], ID['传送门·熔火'], ID['传送门·虚空'], ID['传送门·霜寂'],
  ID['传送门·晶簇'], ID['传送门·腐化'], ID['传送门·炙沙'], ID['传送门·花园'],
];
export const PORTAL_DIM = {};
PORTAL_BLOCK.forEach((id, d) => { PORTAL_DIM[id] = d; });
export const isPortalBlock = (id) => PORTAL_DIM[id] !== undefined;

/* 方块 id 的上界：>= ID_ITEM_BASE 的都是物品（不可放置） */
export const ID_ITEM_BASE = 200;
export const isBlockId = (id) => id > 0 && id < ID_ITEM_BASE;

/* --- 物品别名（工具 / 武器 / 弹药）---
 * 和方块别名一样，逻辑代码只准用 I.PICK_IRON 这种写法，不许裸写 218 ——
 * 往 ITEMS 中间插一件东西会顶掉后面所有 id，裸数字会静默串味。 */
Object.assign(I, {
  PICK_WOOD: 210, AXE_WOOD: 211, SHOVEL_WOOD: 212, SWORD_WOOD: 213,
  PICK_STONE: 214, AXE_STONE: 215, SHOVEL_STONE: 216, SWORD_STONE: 217,
  PICK_IRON: 218, AXE_IRON: 219, SHOVEL_IRON: 220, SWORD_IRON: 221,
  PICK_GOLD: 222, AXE_GOLD: 223, SHOVEL_GOLD: 224, SWORD_GOLD: 225,
  PICK_DIAMOND: 226, AXE_DIAMOND: 227, SHOVEL_DIAMOND: 228, SWORD_DIAMOND: 229,
  BOW: 230, ARROW: 231, STICK: 232,
  /* 傀儡核心：右键召唤（见 ITEMS 的 summon 字段） */
  GOLEM_IRON: 233, GOLEM_STONE: 234, GOLEM_SNOW: 235,
  /* 新敌对生物的材料掉落 */
  GUNPOWDER: 206, BONE: 207, SPIDER_EYE: 208, SLIMEBALL: 209,
  /* 食物（刷怪蛋配方的特征材料；苹果/胡萝卜此处不需要别名，故不收） */
  PORKCHOP: 202, MUTTON: 203, RAW_CHICKEN: 204, ROTTEN_FLESH: 205,
  /* 维度核心（右键点火，见 CORE_ITEM / tryIgnitePortal） */
  CORE_OVER: 236, CORE_EMBER: 237, CORE_VOID: 238, CORE_FROST: 239,
  CORE_CRYSTAL: 240, CORE_BLIGHT: 241, CORE_DUNE: 242, CORE_GARDEN: 243,
  /* 刷怪蛋（右键放生物，见 EGG_OF / trySpawnEgg）—— 顺序与 EGG_MOBS 一致 */
  EGG_PIG: 244, EGG_SHEEP: 245, EGG_CHICKEN: 246, EGG_ZOMBIE: 247,
  EGG_VILLAGER: 248, EGG_GOLEM_IRON: 249, EGG_GOLEM_STONE: 250, EGG_GOLEM_SNOW: 251,
  EGG_SPIDER: 252, EGG_CREEPER: 253, EGG_SKELETON: 254, EGG_SLIME_LARGE: 255,
  EGG_SLIME_SMALL: 256,
});

/* 物品表（非方块）：食物等，右键使用。
 * tex 缺省时用 name 当贴图名（item_<name>）。 */
export const ITEMS = {
  200: { name:'苹果',     n:'果', color:[212, 62, 62], food:4, tex:'apple' },
  201: { name:'胡萝卜',   n:'萝', color:[232,132, 42], food:3, tex:'carrot' },
  202: { name:'生猪排',   n:'猪', color:[228,142,138], food:3, tex:'porkchop' },
  203: { name:'生羊肉',   n:'羊', color:[214, 96, 96], food:2, tex:'mutton' },
  204: { name:'生鸡肉',   n:'鸡', color:[236,196,170], food:2, tex:'chicken' },
  205: { name:'腐肉',     n:'腐', color:[126,134, 90], food:2, tex:'rotten' },

  /* ---------------- 新敌对生物的材料掉落 ----------------
   * 蜘蛛 / 苦力怕 / 骷髅 / 史莱姆的战利品。和腐肉一样是「收藏 + 应急口粮」定位：
   * 不进配方（避免为了合成去刷怪，那就成了打工），但每种都有独立图标。 */
  206: { name:'火药',     n:'药', color:[148,150,160], tex:'gunpowder' },
  207: { name:'骨头',     n:'骨', color:[228,226,210], tex:'bone' },
  208: { name:'蛛眼',     n:'眼', color:[198, 88,158], food:2, tex:'spider_eye' },
  209: { name:'粘液球',   n:'球', color:[112,188,116], tex:'slimeball' },

  /* ---------------- 工具与武器 ----------------
   * tool 字段是唯一的元数据来源：kind = pick/axe/shovel/sword，tier = 0..4。
   * 倍率与伤害全部在下面的 TOOL_* 表里查，这里只登记「叫什么、什么颜色、哪张贴图」。
   * color 取的是**头部材质**的颜色（握柄固定画木色），所以同一形状换材质一眼分得出。 */
  210: { name:'木镐',     n:'镐', color:[150,112, 72], tex:'pick_wood',    tool:{ kind:'pick',   tier:0 } },
  211: { name:'木斧',     n:'斧', color:[150,112, 72], tex:'axe_wood',     tool:{ kind:'axe',    tier:0 } },
  212: { name:'木锹',     n:'锹', color:[150,112, 72], tex:'shovel_wood',  tool:{ kind:'shovel', tier:0 } },
  213: { name:'木剑',     n:'剑', color:[150,112, 72], tex:'sword_wood',   tool:{ kind:'sword',  tier:0 } },
  214: { name:'石镐',     n:'镐', color:[132,134,138], tex:'pick_stone',   tool:{ kind:'pick',   tier:1 } },
  215: { name:'石斧',     n:'斧', color:[132,134,138], tex:'axe_stone',    tool:{ kind:'axe',    tier:1 } },
  216: { name:'石锹',     n:'锹', color:[132,134,138], tex:'shovel_stone', tool:{ kind:'shovel', tier:1 } },
  217: { name:'石剑',     n:'剑', color:[132,134,138], tex:'sword_stone',  tool:{ kind:'sword',  tier:1 } },
  218: { name:'铁镐',     n:'镐', color:[214,214,218], tex:'pick_iron',    tool:{ kind:'pick',   tier:2 } },
  219: { name:'铁斧',     n:'斧', color:[214,214,218], tex:'axe_iron',     tool:{ kind:'axe',    tier:2 } },
  220: { name:'铁锹',     n:'锹', color:[214,214,218], tex:'shovel_iron',  tool:{ kind:'shovel', tier:2 } },
  221: { name:'铁剑',     n:'剑', color:[214,214,218], tex:'sword_iron',   tool:{ kind:'sword',  tier:2 } },
  222: { name:'金镐',     n:'镐', color:[246,204, 78], tex:'pick_gold',    tool:{ kind:'pick',   tier:3 } },
  223: { name:'金斧',     n:'斧', color:[246,204, 78], tex:'axe_gold',     tool:{ kind:'axe',    tier:3 } },
  224: { name:'金锹',     n:'锹', color:[246,204, 78], tex:'shovel_gold',  tool:{ kind:'shovel', tier:3 } },
  225: { name:'金剑',     n:'剑', color:[246,204, 78], tex:'sword_gold',   tool:{ kind:'sword',  tier:3 } },
  226: { name:'钻石镐',   n:'镐', color:[ 92,226,232], tex:'pick_diamond', tool:{ kind:'pick',   tier:4 } },
  227: { name:'钻石斧',   n:'斧', color:[ 92,226,232], tex:'axe_diamond',  tool:{ kind:'axe',    tier:4 } },
  228: { name:'钻石锹',   n:'锹', color:[ 92,226,232], tex:'shovel_diamond', tool:{ kind:'shovel', tier:4 } },
  229: { name:'钻石剑',   n:'剑', color:[ 92,226,232], tex:'sword_diamond',  tool:{ kind:'sword',  tier:4 } },

  /* ---------------- 远程武器与弹药 ---------------- */
  230: { name:'弓',       n:'弓', color:[186,142, 84], tex:'bow' },
  231: { name:'箭',       n:'箭', color:[176,176,182], tex:'arrow' },
  232: { name:'木棍',     n:'棍', color:[140,102, 64], tex:'stick' },

  /* ---------------- 傀儡核心 ----------------
   * 右键把它们放到准星指着的方块顶上，就召唤出一只傀儡。
   * summon 字段是唯一的元数据来源（和 tool 一样）：值必须是 MOB_TYPES 里的键。
   * 三枚核心的「本体」是铁 / 圆石 / 雪，配方也就是那三种材料围一圈 + 中间一个南瓜。 */
  233: { name:'铁傀儡核心', n:'傀', color:[198,202,208], summon:'golem_iron',  tex:'golem_iron' },
  234: { name:'石傀儡核心', n:'傀', color:[138,140,145], summon:'golem_stone', tex:'golem_stone' },
  235: { name:'雪傀儡核心', n:'傀', color:[240,244,250], summon:'golem_snow',  tex:'golem_snow' },

  /* ---------------- 维度核心 ----------------
   * 右键一扇用黑曜石搭好的门框，就把门点成「通往 core 维度的传送门」。
   * core 字段是唯一的元数据来源（和 summon 一样）：值就是维度号，0 是主世界。
   * 8 枚核心一一对应 8 种门方块（PORTAL_BLOCK），颜色也和门一致 ——
   * 物品栏里那枚是什么色，点出来的门就是什么色。 */
  236: { name:'世界核心', n:'核', color:[128, 74,208], core:0, tex:'core_over' },
  237: { name:'熔火核心', n:'核', color:[216, 96, 32], core:1, tex:'core_ember' },
  238: { name:'虚空核心', n:'核', color:[176, 72,224], core:2, tex:'core_void' },
  239: { name:'霜寂核心', n:'核', color:[ 96,208,224], core:3, tex:'core_frost' },
  240: { name:'晶簇核心', n:'核', color:[152,120,232], core:4, tex:'core_crystal' },
  241: { name:'腐化核心', n:'核', color:[120,196, 72], core:5, tex:'core_blight' },
  242: { name:'炙沙核心', n:'核', color:[232,196, 84], core:6, tex:'core_dune' },
  243: { name:'花园核心', n:'核', color:[120,208,248], core:7, tex:'core_garden' },

  /* ---------------- 刷怪蛋（右键放出一只生物） ----------------
   * 13 枚，与 MOB_TYPES 的 13 个键一一对应。
   * spawn 字段是唯一元数据来源（和 summon / core 同构）：值必须是 MOB_TYPES 的键。
   * ⚠ 名字与颜色在这里写死，不引 MOB_TYPES —— ITEMS 在常量段（约 880 行），
   * MOB_TYPES 在生物段（约 6000 行），此处引它会触发 TDZ。
   * 「spawn 指向的生物真实存在」这条由生物段末尾的载入期校验兜底（和傀儡核心同款）。
   *
   * 颜色取各生物的**标志色**（猪粉 / 僵尸绿 / 苦力怕绿…），蛋壳上再撒深色斑点。
   * 这些蛋**不受昼夜限制**：夜里刷怪的总闸只拦自动刷新，拦不到玩家手里的蛋。 */
  244: { name:'猪刷怪蛋',     n:'蛋', color:[236,156,156], spawn:'pig',         tex:'egg_pig' },
  245: { name:'羊刷怪蛋',     n:'蛋', color:[230,224,206], spawn:'sheep',       tex:'egg_sheep' },
  246: { name:'鸡刷怪蛋',     n:'蛋', color:[240,216,168], spawn:'chicken',     tex:'egg_chicken' },
  247: { name:'僵尸刷怪蛋',   n:'蛋', color:[ 96,138, 82], spawn:'zombie',      tex:'egg_zombie' },
  248: { name:'村民刷怪蛋',   n:'蛋', color:[176,138,106], spawn:'villager',    tex:'egg_villager' },
  249: { name:'铁傀儡刷怪蛋', n:'蛋', color:[198,202,208], spawn:'golem_iron',  tex:'egg_golem_iron' },
  250: { name:'石傀儡刷怪蛋', n:'蛋', color:[138,140,145], spawn:'golem_stone', tex:'egg_golem_stone' },
  251: { name:'雪傀儡刷怪蛋', n:'蛋', color:[240,244,250], spawn:'golem_snow',  tex:'egg_golem_snow' },
  252: { name:'蜘蛛刷怪蛋',   n:'蛋', color:[ 84, 66, 58], spawn:'spider',      tex:'egg_spider' },
  253: { name:'苦力怕刷怪蛋', n:'蛋', color:[ 92,168, 92], spawn:'creeper',     tex:'egg_creeper' },
  254: { name:'骷髅刷怪蛋',   n:'蛋', color:[212,208,196], spawn:'skeleton',    tex:'egg_skeleton' },
  255: { name:'史莱姆刷怪蛋', n:'蛋', color:[108,188,114], spawn:'slime_large', tex:'egg_slime_large' },
  256: { name:'小史莱姆刷怪蛋', n:'蛋', color:[138,208,144], spawn:'slime_small', tex:'egg_slime_small' },
};
for (const k in ITEMS) ITEMS[k].id = +k;
/* 维度号 → 核心物品 id。建在 ITEMS 之后（要读 core 字段），
 * 传送门逻辑与测试都只认这张表，不裸写 236。 */
export const CORE_ITEM = [];
for (const k in ITEMS) if (ITEMS[k].core !== undefined) CORE_ITEM[ITEMS[k].core] = +k;

/* --- 工具元数据：倍率 / 伤害 ---
 * 倍率是「挖对材质时的时间除数」：2 表示耗时减半。
 * 金是特例 —— 挖得最快、打人最软（12 倍速但只有木级的伤害），是经典取舍。 */
export const ITEM_TIER_NAME = ['木', '石', '铁', '金', '钻石'];
export const TIER_SPEED = [2, 4, 6, 12, 8];
export const TIER_DMG   = [1, 2, 3, 1, 4];
export const KIND_DMG   = { sword: 3, axe: 2, pick: 1, shovel: 1 };
export const KIND_NAME  = { pick: '镐', axe: '斧', shovel: '锹', sword: '剑' };
export const FIST_DMG   = 2;                 // 空手：猪 10 血要打 5 下

/* id → { kind, tier }，只收带 tool 字段的物品 */
export const TOOL_OF = {};
for (const k in ITEMS) if (ITEMS[k].tool) TOOL_OF[k] = ITEMS[k].tool;
/* id → 傀儡类型，只收带 summon 字段的物品（右键召唤的入口就查这张表） */
export const SUMMON_OF = {};
for (const k in ITEMS) if (ITEMS[k].summon) SUMMON_OF[k] = ITEMS[k].summon;
/* id → 生物类型，只收带 spawn 字段的物品（刷怪蛋的入口查这张表）。
 * 和 SUMMON_OF 分开：核心只召唤傀儡，蛋对任何生物都成立。 */
export const EGG_OF = {};
for (const k in ITEMS) if (ITEMS[k].spawn) EGG_OF[k] = ITEMS[k].spawn;
/* 物品贴图也要占贴图集的格子 */
for (const k in ITEMS) registerTile('item_' + ITEMS[k].tex, null);
/* 生物贴图（不挂在方块上，单独登记并指定基色） */
export const MOB_TILE_COLORS = {
  mob_pig: [236, 156, 156], mob_pig_snout: [206, 118, 118],
  mob_sheep_wool: [232, 232, 226], mob_sheep_face: [204, 178, 158],
  mob_chicken: [242, 240, 232], mob_chicken_beak: [232, 168, 52],
  mob_zombie_skin: [96, 138, 82], mob_zombie_shirt: [74, 104, 148],
  mob_zombie_pants: [58, 62, 92], mob_eye: [24, 20, 22], mob_leg: [96, 76, 58],
  mob_villager_robe: [126, 88, 62], mob_villager_face: [186, 146, 116],
  /* 傀儡：三种材质（铁板 / 石砖 / 雪）各自一底一脸，
   * 再共用一张青苔与一张树枝 —— 一共 8 格，三种傀儡一眼分得开。 */
  mob_iron_plate: [198, 202, 208], mob_iron_face: [208, 212, 218],
  mob_stone_plate: [138, 140, 145], mob_stone_face: [148, 150, 156],
  mob_snowman: [240, 244, 250], mob_snow_face: [246, 249, 253],
  mob_golem_vine: [ 78, 116, 62], mob_wood_arm: [124, 90, 54],
  /* 新敌对生物：蜘蛛（深褐体 + 红眼点）、苦力怕（苔绿 + 经典黑脸）、
   * 骷髅（白骨 + 空洞脸）、史莱姆（果冻绿 + 豆豆眼）—— 每种两格：
   * 一格身体、一格脸，和傀儡的「一底一脸」同构。 */
  mob_spider: [ 56, 44, 38], mob_spider_eye: [ 46, 36, 31],
  mob_creeper: [ 92, 168, 92], mob_creeper_face: [100, 176, 100],
  mob_skeleton: [212, 208, 196], mob_skeleton_face: [204, 200, 188],
  mob_slime: [108, 188, 114], mob_slime_face: [118, 198, 124],
  /* AI 玩家：肤色 / 上衣 / 裤子 / 头发各一张中性贴图，靠 uTint 逐实例染色，
   * 所以纹理本身只画「明暗结构」，色相一律交给 tint —— 8~10 个 AI 玩家共用
   * 这一套网格，靠 tint 组合出各自的样子（换色不重建 GPU 缓冲）。 */
  bot_skin: [226, 190, 156], bot_shirt: [ 72, 128, 196],
  bot_pants: [ 62,  66, 88], bot_hair: [ 74,  54,  40],
  /* ⚠ bot_eye 必须是**接近白**的底色，深浅交给 tint。
   * 反过来写（贴图深 + tint 深）会被 FS 里的 `t.rgb * a * uTint` 连乘两次：
   * 38/255 × 0.16 ≈ 0.024 —— 纯黑，而且在深棕头发 / 深肤色的头上完全分不出来。
   * 「白底 × 深 tint」才等于想要的那个深色。 */
  bot_eye: [236, 236, 240],
};
for (const n in MOB_TILE_COLORS) {
  registerTile(n, null);
  TILE_COLOR[n] = MOB_TILE_COLORS[n];
}
if (TILE_NAMES.length > ATLAS_COLS * ATLAS_COLS)
  throw new Error(`贴图格数不足：需要 ${TILE_NAMES.length}，贴图集只有 ${ATLAS_COLS * ATLAS_COLS}`);

/* 取定义（方块或物品通用） */
export const defOf = (id) => (id > 0 ? (isBlockId(id) ? BLOCKS[id] : ITEMS[id]) : null);
/* 用于 UI 展示的颜色 */
export function defColor(id) {
  const d = defOf(id);
  if (!d) return [70, 76, 90];
  return d.side || d.color;
}
export const defName = (id) => { const d = defOf(id); return d ? d.name : '空格'; };
export const defShort = (id) => { const d = defOf(id); return d ? d.n : ''; };

/* --- 方块材质分类：决定「哪一类工具算对口」 ---
 * 只登记「用对工具能显著加速」的那些。没登记的一律按原速（1 倍）。
 * 只用 I.* 别名填表，所以往 BLOCKS 中间插方块不会把分类串味。 */
export const BLOCK_MAT = {};
{
  const put = (mat, ids) => { for (const id of ids) if (id) BLOCK_MAT[id] = mat; };
  put('stone', [I.STONE, I.COBBLE, I.STONEBRICK, I.MOSS, I.OBSIDIAN, I.QUARTZ, I.BRICK,
                I.SANDSTONE, I.GLASS, I.ICE,
                I.COAL, I.IRON, I.GOLD, I.DIAMOND, I.REDSTONE]);
  put('wood',  [I.LOG, I.PLANK, I.DARKPLANK, I.BOOKSHELF, I.LEAF, I.PUMPKIN, I.LAMP]);
  put('dirt',  [I.GRASS, I.DIRT, I.SAND, I.SNOW, I.CLAY, I.CARROT]);
}
/* 反查：工具类别 → 它对口的材质。剑不在表里 —— 剑不加速挖掘。 */
export const TOOL_GOOD = { pick: 'stone', axe: 'wood', shovel: 'dirt' };

/* 手持工具挖某个方块的倍率。1 = 不加速（空手 / 剑 / 用错工具）。 */
export function toolSpeedOn(id) {
  const t = TOOL_OF[readHeldId()];
  if (!t) return 1;
  return BLOCK_MAT[id] === TOOL_GOOD[t.kind] ? TIER_SPEED[t.tier] : 1;
}
/* 当前手持物的攻击伤害 */
export function attackDamage() {
  const t = TOOL_OF[readHeldId()];
  return t ? TIER_DMG[t.tier] + KIND_DMG[t.kind] : FIST_DMG;
}
/* 物品栏提示文案：工具显示「挖掘倍率 / 伤害」，食物显示回复量 */
export function itemTip(id) {
  const d = ITEMS[id];
  if (!d) return '';
  if (d.tool) {
    const good = TIER_SPEED[d.tool.tier];
    return `（${KIND_NAME[d.tool.kind]} · 对口材质 ×${good} · 伤害 ${TIER_DMG[d.tool.tier] + KIND_DMG[d.tool.kind]}）`;
  }
  if (d.food) return `（食物，右键吃，+${d.food} 饥饿）`;
  if (id === I.BOW) return '（按住右键蓄力，松手射出）';
  if (id === I.ARROW) return '（弓的弹药）';
  if (d.summon) return `（右键召唤${MOB_TYPES[d.summon].name} · 会主动攻击敌对生物）`;
  if (d.spawn) return `（右键在准星处放出一只${MOB_TYPES[d.spawn].name} · 白天黑夜都能用）`;
  return '';
}

/* 挖掘耗时：液体不可挖（返回 Infinity），未标注的用默认值。
 * boost 缺省时按「当前手持工具」现算 —— 所以调用方不用自己传。 */
export function breakTime(id, boost) {
  const B = BLOCKS[id];
  if (!B || B.liquid) return Infinity;
  const base = B.hard === undefined ? 0.6 : B.hard;
  return base / (boost === undefined ? toolSpeedOn(id) : boost);
}
/* 掉落物：草→泥土、石头→圆石，其余掉自己 */
export function dropOf(id) {
  const B = BLOCKS[id];
  if (!B) return 0;
  return B.drop === undefined ? id : B.drop;
}
export const dropCountOf = (id) => BLOCKS[id] && BLOCKS[id].dropN ? BLOCKS[id].dropN : 1;

/* 创造模式默认物品栏（9 格），生存模式会换成玩家自己的背包 */
export const HOTBAR = reactive([I.GRASS, I.STONE, I.COBBLE, I.PLANK, I.STONEBRICK, I.BRICK, I.GLASS, I.PUMPKIN, I.LAMP]);
