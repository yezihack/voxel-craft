import re, io, os, json

SRC = r"G:/AIDevlop/agent-vibercoding/voxel-craft/voxel-craft.html"
OUT = r"G:/AIDevlop/agent-vibercoding/voxel-craft/src/game"
lines = io.open(SRC, encoding='utf-8').read().split('\n')

SCRIPT_START, SCRIPT_END = 552, 9572
body = lines[SCRIPT_START - 1: SCRIPT_END]

SECTIONS = [
    ("config",    565, 1154), ("math",     1155, 1257), ("world",    1258, 1352),
    ("dims",     1353, 1861), ("generate", 1862, 1951), ("portal",   1952, 2106),
    ("fluid",    2107, 2935), ("mesher",   2936, 3114), ("textures", 3115, 4256),
    ("renderer", 4257, 4470), ("sky",      4471, 4628), ("post",     4629, 5480),
    ("player",   5481, 5652), ("survival", 5653, 5919), ("crafting", 5920, 6283),
    ("mobs",     6284, 7451), ("bots",     7452, 8229), ("audio",    8230, 8259),
    ("input",    8260, 8473), ("actions",  8474, 8648),
    ("loop",     9076, 9406), ("boot",     9407, 9572),
]

# ---------------------------------------------------------------- 扫描器
# 逐行维护「字符串状态 + 括号深度」，只有 depth==0 且不在字符串里的行才算顶层。
# 这样 GLSL 模板字符串里的内容（attribute / uniform / void main）绝不会被误判。
def scan(line, depth, in_str):
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        if in_str:
            if c == '\\':
                i += 2; continue
            if c == in_str:
                in_str = None
            i += 1; continue
        if c == '/' and i + 1 < n and line[i + 1] == '/':
            break                                   # 行注释
        if c == '/' and i + 1 < n and line[i + 1] == '*':
            j = line.find('*/', i + 2)
            i = n if j < 0 else j + 2; continue
        if c in '\'"':
            in_str = c; i += 1; continue
        if c == '`':
            in_str = '`'; i += 1; continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth = max(0, depth - 1)
        i += 1
    return depth, in_str


def split_top(text):
    """按「深度为 0」的逗号切分声明符列表"""
    parts, stack, start, i, n = [], [], 0, 0, len(text)
    in_s = None
    while i < n:
        c = text[i]
        if in_s:
            if c == '\\':
                i += 2; continue
            if c == in_s:
                in_s = None
            i += 1; continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            if j < 0: break
            i = j; continue
        if c in '\'"`':
            in_s = c; i += 1; continue
        if c in '([{':
            stack.append(c)
        elif c in ')]}':
            if stack: stack.pop()
        elif c == ',' and not stack:
            parts.append(text[start:i]); start = i + 1
        i += 1
    parts.append(text[start:])
    return parts


IDENT = re.compile(r'^[A-Za-z_$][\w$]*$')
DECL = re.compile(r'^(const|let|var)\s+')
FUNC = re.compile(r'^(function|class)\s+([A-Za-z_$][\w$]*)')

# ---------------------------------------------------------------- 第一遍：收集声明
declared = {}
for fname, a, b in SECTIONS:
    depth, in_str = 0, None
    ids = []
    g = a
    while g <= b:
        line = lines[g - 1]
        top = (depth == 0 and in_str is None)
        if top:
            m = FUNC.match(line)
            if m:
                ids.append(m.group(2))
            elif DECL.match(line):
                # 只分析这一行：跨行声明的后续逗号都在括号里（深度 > 0），
                # 不会多切出声明符；而这里**绝不能**吞掉后续行去凑闭合，
                # 否则括号状态会对不上，后面整段的声明都会漏掉。
                rest = DECL.sub('', line)
                for part in split_top(rest):
                    p = part.strip()
                    if p.startswith('//'): continue
                    name = p.split('=')[0].strip()
                    if IDENT.match(name):
                        ids.append(name)
        depth, in_str = scan(line, depth, in_str)
        g += 1
    declared[fname] = ids

owner = {}
for f, ids in declared.items():
    for i in ids:
        owner.setdefault(i, f)

# ---------------------------------------------------------------- 第二遍：依赖
ident_pat = re.compile(r'\b([A-Za-z_$][\w$]*)\b')
KW = set('''const let var function class return if else for while do switch case break continue new typeof instanceof
in of void delete this true false null undefined try catch finally throw yield await async import export from as
default extends super get set static with debugger NaN Infinity'''.split())

def strip_text(txt):
    txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.S)
    txt = re.sub(r'//[^\n]*', ' ', txt)
    txt = re.sub(r"'(?:\\.|[^'\\])*'", "''", txt)
    txt = re.sub(r'"(?:\\.|[^"\\])*"', '""', txt)
    txt = re.sub(r'`(?:\\.|[^`\\])*`', '``', txt)
    return txt

deps = {}
for fname, a, b in SECTIONS:
    used = set(ident_pat.findall(strip_text('\n'.join(lines[a - 1:b]))))
    ext = {}
    for u in used:
        if u in KW: continue
        o = owner.get(u)
        if o and o != fname:
            ext.setdefault(o, set()).add(u)
    deps[fname] = {k: sorted(v) for k, v in ext.items()}

# ---------------------------------------------------------------- 第三遍：写文件
HEADER = {
    "config":   "常量配置：世界尺寸、方块表、物品表、贴图集规划、顶点布局",
    "math":     "数学工具：4x4 矩阵、值噪声 / fbm、clamp",
    "world":    "世界数据：地形列缓存、生物群系、地表高度",
    "dims":     "维度档案：8 个维度的地形参数、方块读写、装饰与结构格",
    "generate": "世界生成入口：generate() / getEffective / setBlock / isSolid",
    "portal":   "传送门与维度切换",
    "fluid":    "流体：水与岩浆的扩散模拟、地形装饰（树/矿脉/村庄/遗迹）",
    "mesher":   "网格构建：区块面剔除与顶点生成",
    "textures": "程序化贴图：canvas 现画贴图集、等距图标、平面图标",
    "renderer": "WebGL 渲染：上下文、着色器程序、uniform / attribute 位置",
    "sky":      "天空：渐变天穹、太阳月亮、云",
    "post":     "后处理与绘制：泛光、合成、各几何体的上传与绘制",
    "player":   "玩家：AABB 碰撞、重力 / 跳跃 / 飞行、射线拾取",
    "survival": "生存模式：背包 Map、挖掘计时、饥饿 / 氧气 / 摔落伤害",
    "crafting": "合成：3x3 配方匹配、配方书、自动摆料",
    "mobs":     "生物：被动 / 敌对 AI、刷怪、掉落物",
    "bots":     "AI 玩家：会挖矿盖房打怪的 NPC",
    "audio":    "音效：WebAudio 合成音",
    "input":    "输入：键盘 / 鼠标 / 触屏事件",
    "actions":  "操作：挖掘 / 放置 / 进食 / 召唤 / 点燃传送门",
    "loop":     "主循环：每帧更新与绘制",
    "boot":     "启动流程：世界生成、资源上传、首帧准备",
}

os.makedirs(OUT, exist_ok=True)
report = []
for fname, a, b in SECTIONS:
    code = lines[a - 1:b]
    out, exported = [], []
    depth, in_str = 0, None
    for line in code:
        top = (depth == 0 and in_str is None)
        hit = None
        if top:
            m = FUNC.match(line)
            if m: hit = [m.group(2)]
            elif DECL.match(line):
                rest = DECL.sub('', line)
                hit = []
                for part in split_top(rest):
                    p = part.strip()
                    name = p.split('=')[0].strip()
                    if IDENT.match(name): hit.append(name)
        if hit:
            out.append('export ' + line)
            exported.extend(hit)
        else:
            out.append(line)
        depth, in_str = scan(line, depth, in_str)

    imports = ["import { %s } from './%s.js'" % (', '.join(deps[fname][s]), s)
               for s in sorted(deps[fname])]
    head = ["/* %s —— 迁移自 voxel-craft.html 第 %d-%d 行 */" % (HEADER[fname], a, b)]
    if imports:
        head += [''] + imports + ['']
    io.open(os.path.join(OUT, fname + '.js'), 'w', encoding='utf-8', newline='\n') \
        .write('\n'.join(head + out).rstrip() + '\n')
    report.append({"file": fname + '.js', "lines": b - a + 1,
                   "exports": sorted(set(exported)), "imports": deps[fname]})

io.open(r"G:/AIDevlop/agent-vibercoding/voxel-craft/.workbuddy-ai/split-report.json", 'w',
        encoding='utf-8').write(json.dumps(report, ensure_ascii=False, indent=2))
print("生成 %d 个文件" % len(report))
for r in report:
    print("  %-13s %5d 行  export %3d  import %s" % (r["file"], r["lines"], len(r["exports"]), list(r["imports"])))
