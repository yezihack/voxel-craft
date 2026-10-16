import re, io, os, sys

G = r"G:/AIDevlop/agent-vibercoding/voxel-craft/src/game"
def rd(f): return io.open(os.path.join(G, f), encoding='utf-8').read()
def wr(f, s): io.open(os.path.join(G, f), 'w', encoding='utf-8', newline='\n').write(s)

FILES = ['config.js', 'math.js', 'world.js', 'dims.js', 'generate.js', 'portal.js', 'fluid.js',
         'mesher.js', 'textures.js', 'renderer.js', 'sky.js', 'post.js', 'player.js',
         'survival.js', 'crafting.js', 'mobs.js', 'bots.js', 'audio.js', 'input.js',
         'actions.js', 'loop.js']

# ---------------------------------------------------------------- 1. 集中到 state.js 的变量
RELOC = {
    'SEED': 'state', 'dim': 'state', 'structShapeCache': 'state', 'colCache': 'state',
    'colCacheSeed': 'state', 'edits': 'state', 'portalCd': 'state', 'spectate': 'state',
    'bowCharge': 'state', 'swingT': 'state', 'handSwing': 'state', 'mode': 'state',
    'selected': 'state', 'onHurt': 'state', 'onDeath': 'state', 'targetBlock': 'state',
    'running': 'state', 'paused': 'state', 'breakHeld': 'state', 'placeHeld': 'state',
    'placeRepeat': 'state', 'lastAction': 'state', 'MODE': 'state',
    'stickVec': 'state', 'lookVec': 'state',
}
SETTER = {
    'SEED': 'setSEED', 'dim': 'setDim', 'structShapeCache': 'setStructShapeCache',
    'colCache': 'setColCache', 'colCacheSeed': 'setColCacheSeed', 'edits': 'setEdits',
    'portalCd': 'setPortalCd', 'spectate': 'setSpectate', 'bowCharge': 'setBowCharge',
    'swingT': 'setSwingT', 'handSwing': 'setHandSwing', 'mode': 'setModeState',
    'selected': 'setSelected', 'onHurt': 'setOnHurt', 'onDeath': 'setOnDeath',
    'targetBlock': 'setTargetBlock', 'running': 'setRunning', 'paused': 'setPaused',
    'breakHeld': 'setBreakHeld', 'placeHeld': 'setPlaceHeld', 'placeRepeat': 'setPlaceRepeat',
    'lastAction': 'setLastAction',
}

src = {f: rd(f) for f in FILES}

# --- 1a. 删掉原来那句声明 ---
def drop_decl(text, name):
    pat = re.compile(r'^export\s+(?:const|let|var)\s+' + re.escape(name) + r'\b.*$', re.M)
    new, n = pat.subn('', text)
    return new, n

for f in FILES:
    for name in RELOC:
        src[f], n = drop_decl(src[f], name)
        if n > 1:
            print('!! %s 里 %s 被删了 %d 次' % (f, name, n))

# --- 1b. 改写 import：这些名字统一从 ./state.js 来 ---
IMP = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./(\w+)\.js'\s*$", re.M)
def rewrite_imports(text, add_state=None):
    moved = []
    def one(m):
        names = [x.strip() for x in m.group(1).split(',') if x.strip()]
        mod = m.group(2)
        keep = [x for x in names if x not in RELOC]
        for x in names:
            if x in RELOC: moved.append(x)
        if keep:
            return "import { %s } from './%s.js'" % (', '.join(sorted(set(keep))), mod)
        return None
    lines = text.split('\n')
    out = []
    for l in lines:
        m = IMP.match(l)
        if m:
            r = one(m)
            if r: out.append(r)
        else:
            out.append(l)
    text = '\n'.join(out)
    if moved:
        names = sorted(set(moved) | set(add_state or []))
        # 插到第一条 import 之前
        ins = "import { %s } from './state.js'" % ', '.join(names)
        idx = text.find("import ")
        if idx < 0:
            idx = 0
        text = text[:idx] + ins + '\n' + text[idx:]
    return text

for f in FILES:
    src[f] = rewrite_imports(src[f])

# --- 1c. 赋值 → setter ---
CHAINED = [
    ('breakHeld = placeHeld = placeRepeat = false;',
     'setBreakHeld(false); setPlaceHeld(false); setPlaceRepeat(false);'),
]
ASG = re.compile(r'(?<![.\w$=!<>+\-*/%&|^~?])(' + '|'.join(sorted(SETTER, key=len, reverse=True)) +
                 r')\s*=\s*([^;]+);')
def to_setter(text):
    for a, b in CHAINED:
        text = text.replace(a, b)
    text = ASG.sub(lambda m: '%s(%s);' % (SETTER[m.group(1)], m.group(2)), text)
    return text

for f in FILES:
    src[f] = to_setter(src[f])

# ---------------------------------------------------------------- 2. invDirty 整体移除
for f in FILES:
    src[f] = re.sub(r'^\s*invDirty = true;\s*\n', '', src[f], flags=re.M)
    src[f] = re.sub(r'^export let invDirty = false;.*\n', '', src[f], flags=re.M)

# ---------------------------------------------------------------- 3. 响应式容器
def make_reactive(text, pat, rep):
    new, n = re.subn(pat, rep, text, count=1, flags=re.M)
    if n == 0: print('!! 没匹配到：' + pat)
    return new

src['config.js'] = make_reactive(src['config.js'],
    r'^export const HOTBAR = \[', 'export const HOTBAR = reactive([')
src['config.js'] = src['config.js'].replace(
    "/* 常量配置：世界尺寸", "import { reactive } from 'vue'\n\n/* 常量配置：世界尺寸", 1)

src['survival.js'] = make_reactive(src['survival.js'],
    r'^export const inv = new Map\(\);', 'export const inv = reactive(new Map());')
src['survival.js'] = make_reactive(src['survival.js'],
    r'^export const invSlots = new Array\(SLOT_N\)\.fill\(0\);',
    'export const invSlots = reactive(new Array(SLOT_N).fill(0));')
src['survival.js'] = src['survival.js'].replace(
    "/* 生存模式：背包 Map", "import { reactive } from 'vue'\n\n/* 生存模式：背包 Map", 1)

src['crafting.js'] = make_reactive(src['crafting.js'],
    r'^export const craftSlots = new Array\(CRAFT_N\)\.fill\(0\);',
    'export const craftSlots = reactive(new Array(CRAFT_N).fill(0));')
src['crafting.js'] = src['crafting.js'].replace(
    "/* 合成：3x3 配方匹配", "import { reactive } from 'vue'\n\n/* 合成：3x3 配方匹配", 1)

# ---------------------------------------------------------------- 4. DOM → 响应式
# renderer.js：画布由 Vue 提供
src['renderer.js'] = src['renderer.js'].replace(
    "export const canvas = document.getElementById('gl');",
    "import { canvasEl } from './canvasHost.js'\nimport { setFatal } from './uiState.js'\n\nexport const canvas = canvasEl;", 1)
src['renderer.js'] = src['renderer.js'].replace(
    """if (!gl) {
  document.body.innerHTML = '<div style="color:#fff;font:16px sans-serif;padding:40px">' +
    '你的浏览器/显卡不支持 WebGL，无法运行这个 3D 游戏 😢</div>';
  throw new Error('no webgl');
}""",
    """if (!gl) {
  setFatal('你的浏览器/显卡不支持 WebGL，无法运行这个 3D 游戏 😢');
  throw new Error('no webgl');
}""", 1)

# input.js
src['input.js'] = src['input.js'].replace(
    "$('flyTag').textContent = player.fly ? '(开)' : '(关)';",
    "ui.flyTag = player.fly ? '(开)' : '(关)';")
src['input.js'] = src['input.js'].replace("if (bagOpen) closeBag();", "if (ui.bagOpen) closeBag();")
src['input.js'] = re.sub(r"^import \{ bagOpen, closeBag, toggleBag \} from './boot.js'\n", '',
                         src['input.js'], flags=re.M)
src['input.js'] = re.sub(r"^import \{ closeBag, toggleBag \} from './boot.js'\n", '',
                         src['input.js'], flags=re.M)
src['input.js'] = src['input.js'].replace(
    "import { toast }", "import { toast }")  # noop
# 删掉整个触屏摇杆 / 按钮绑定块（改由 Vue 的 TouchControls 负责）
start = src['input.js'].find('/* --------------------------- 触屏双摇杆 --------------------------- */')
end = src['input.js'].find("  // 触屏：按住 = 挖掘")
if start < 0 or end < 0:
    print('!! input.js 触屏块定位失败', start, end)
else:
    src['input.js'] = src['input.js'][:start] + src['input.js'][end:]
# 补 import
src['input.js'] = src['input.js'].replace(
    "import { canvas } from './renderer.js'",
    "import { closeBag, selectSlot, setMode, toggleBag } from './uiActions.js'\n"
    "import { canvas } from './renderer.js'", 1)
if "from './uiActions.js'" not in src['input.js']:
    src['input.js'] = src['input.js'].replace(
        "import { canvas } from './renderer.js'",
        "import { closeBag, selectSlot, setMode, toggleBag } from './uiActions.js'\nimport { canvas } from './renderer.js'", 1)
if "from './uiState.js'" not in src['input.js']:
    src['input.js'] = src['input.js'].replace(
        "import { canvas } from './renderer.js'",
        "import { toast, ui } from './uiState.js'\nimport { canvas } from './renderer.js'", 1)

# loop.js
src['loop.js'] = src['loop.js'].replace(
    """  const cross = $('cross');
  cross.classList.toggle('hit', !!targetBlock);""",
    """  ui.crossHit = !!targetBlock;""", 1)
src['loop.js'] = src['loop.js'].replace(
    """  $('digring').classList.toggle('on', dp > 0);
  if (dp > 0) $('digring').style.setProperty('--p', (dp * 100).toFixed(1));""",
    """  ui.digOn = dp > 0;
  if (dp > 0) ui.digPct = +(dp * 100).toFixed(1);""", 1)
src['loop.js'] = src['loop.js'].replace(
    """  $('bowbar').classList.toggle('on', bowCharge > 0);
  if (bowCharge > 0) $('bowbar').style.setProperty('--p', (bowCharge * 100).toFixed(1));""",
    """  ui.bowOn = bowCharge > 0;
  if (bowCharge > 0) ui.bowPct = +(bowCharge * 100).toFixed(1);""", 1)
src['loop.js'] = src['loop.js'].replace(
    """  if (frames % 6 === 0) {
    if (mode === MODE.SURVIVAL) renderVitals();
    syncHurt();
  }""",
    """  if (frames % 6 === 0) { syncVitals(); syncHurt(); }""", 1)
src['loop.js'] = src['loop.js'].replace(
    "    $('stat').textContent = bits.join(' · ');",
    "    ui.stat = bits.join(' · ');\n    syncHud(fps, drawn, chunks.length, tris);", 1)
src['loop.js'] = src['loop.js'].replace(
    "import { bagOpen } from './boot.js'\n", "", 1)
if "from './uiSync.js'" not in src['loop.js']:
    src['loop.js'] = src['loop.js'].replace(
        "import { P } from './textures.js'",
        "import { P } from './textures.js'\nimport { syncHud, syncHurt, syncVitals } from './uiSync.js'\nimport { updateNameTags } from './nametags.js'\nimport { ui } from './uiState.js'", 1)

# portal.js / actions.js：补 toast
for f in ('portal.js', 'actions.js'):
    if "from './uiState.js'" not in src[f]:
        idx = src[f].find("import ")
        src[f] = src[f][:idx] + "import { toast } from './uiState.js'\n" + src[f][idx:]

# post.js：断开与 sky.js 的顶层循环依赖
src['post.js'] = src['post.js'].replace(
    "export const POST_VS = SKY_VS;          // 同一套「全屏三角形」顶点着色器",
    """/* 与 SKY_VS 内容一致的「全屏三角形」顶点着色器。
 * 这里**内联一份**而不是 import SKY_VS：post 与 sky 互相引用，
 * 而 POST_VS 是顶层常量，一旦求值顺序反过来就会撞上 TDZ。 */
export const POST_VS = `
${PREC}
attribute vec2 aP;
varying vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 1.0, 1.0); }`;""", 1)
src['post.js'] = re.sub(r"^import \{ SKY_VS, skyQuad \} from './sky.js'$",
                        "import { skyQuad } from './sky.js'", src['post.js'], flags=re.M)
if 'PREC' not in re.findall(r"^import \{([^}]*)\} from './renderer.js'", src['post.js'], re.M)[0]:
    src['post.js'] = re.sub(r"^import \{ ([^}]*) \} from './renderer.js'$",
                            lambda m: "import { %s } from './renderer.js'" % ', '.join(
                                sorted(set([x.strip() for x in m.group(1).split(',')] + ['PREC']))),
                            src['post.js'], flags=re.M)

# ---------------------------------------------------------------- 5. 写回
for f in FILES:
    wr(f, src[f])
print('补丁应用完成')
