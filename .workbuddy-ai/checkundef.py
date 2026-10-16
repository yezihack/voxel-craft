import re, io, os

G = r"G:/AIDevlop/agent-vibercoding/voxel-craft/src/game"
files = sorted(f for f in os.listdir(G) if f.endswith('.js'))

# 所有模块里「顶层声明过」的名字
all_decl = set()
DECL1 = re.compile(r'^export\s+(?:const|let|var|class)\s+(.+)$', re.M)
DECL2 = re.compile(r'^export\s+function\s+([A-Za-z_$][\w$]*)', re.M)
DECL3 = re.compile(r'^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)', re.M)
MULTI = re.compile(r'^export\s+(?:const|let|var)\s+(.+)$', re.M)
for f in files:
    s = io.open(os.path.join(G, f), encoding='utf-8').read()
    for m in DECL2.finditer(s):
        all_decl.add(m.group(1))
    for m in MULTI.finditer(s):
        for part in m.group(1).split(','):
            nm = part.split('=')[0].strip()
            if re.match(r'^[A-Za-z_$][\w$]*$', nm): all_decl.add(nm)
    for m in DECL3.finditer(s):
        all_decl.add(m.group(1))

GLOBALS = set('''window document console Math Object Array Map Set JSON Number String Boolean Date
Float32Array Float64Array Uint8Array Uint16Array Uint32Array Int32Array Uint8ClampedArray
performance requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval
matchMedia Image WeakMap WeakSet Symbol Promise Error TypeError isNaN parseInt parseFloat undefined NaN Infinity
innerWidth innerHeight devicePixelRatio fetch localStorage location navigator history screen
WebGL2RenderingContext TextEncoder TextDecoder structuredClone queueMicrotask alert confirm prompt
import export const let var function class return if else for while do switch case break continue new typeof
instanceof in of void delete this true false null try catch finally throw yield await async from as default
extends super get set static with debugger arguments eval'''.split())

IMP = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'[./\w]+'", re.M)
IDENT = re.compile(r'\b([A-Za-z_$][\w$]*)\b')

def strip(t):
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    t = re.sub(r'//[^\n]*', ' ', t)
    t = re.sub(r"'(?:\\.|[^'\\])*'", "''", t)
    t = re.sub(r'"(?:\\.|[^"\\])*"', '""', t)
    t = re.sub(r'`(?:\\.|[^`\\])*`', '``', t)
    return t

report = []
for f in files:
    s = io.open(os.path.join(G, f), encoding='utf-8').read()
    imported = set()
    for m in IMP.finditer(s):
        for x in m.group(1).split(','):
            x = x.strip()
            if x: imported.add(x)
    # 本文件里所有声明（含块级）
    local = set()
    for m in re.finditer(r'\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)', s):
        local.add(m.group(1))
    for m in re.finditer(r'\(([^)]*)\)\s*=>', s):          # 箭头函数参数
        for x in m.group(1).split(','):
            x = x.strip().split('=')[0].strip()
            if re.match(r'^[A-Za-z_$][\w$]*$', x): local.add(x)
    for m in re.finditer(r'\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)', s):
        for x in m.group(1).split(','):
            x = x.strip().split('=')[0].strip()
            if re.match(r'^[A-Za-z_$][\w$]*$', x): local.add(x)
    for m in re.finditer(r'\bfor\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)', s):
        local.add(m.group(1))
    for m in re.finditer(r'\bcatch\s*\(\s*([A-Za-z_$][\w$]*)', s):
        local.add(m.group(1))
    # 属性访问 / 对象字面量的键不算
    txt = strip(s)
    txt = re.sub(r'\.\s*([A-Za-z_$][\w$]*)', ' ', txt)      # .foo
    txt = re.sub(r'([A-Za-z_$][\w$]*)\s*:', ' ', txt)       # key:
    used = set(IDENT.findall(txt))
    miss = sorted(u for u in used
                  if u not in imported and u not in local and u not in GLOBALS and u not in all_decl)
    if miss:
        report.append((f, miss))

for f, miss in report:
    print('%s -> %s' % (f, miss))
if not report: print('未发现可疑的未定义标识符')
