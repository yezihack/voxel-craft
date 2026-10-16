import re, io, os, json

G = r"G:/AIDevlop/agent-vibercoding/voxel-craft/src/game"
files = [f for f in os.listdir(G) if f.endswith('.js')]

EXPORT_RE = [
    re.compile(r'^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)', re.M),
    re.compile(r'^export\s+function\s+([A-Za-z_$][\w$]*)', re.M),
    re.compile(r'^export\s*\{\s*([^}]*)\s*\}', re.M),
]
MULTI = re.compile(r'^export\s+(?:const|let|var)\s+(.+)$', re.M)

def exports_of(path):
    s = io.open(path, encoding='utf-8').read()
    # 去掉字符串 / 注释，避免把 GLSL 或模板里的东西算进来（粗略即可）
    names = set()
    for rx in EXPORT_RE:
        for m in rx.finditer(s):
            part = m.group(1)
            for x in part.split(','):
                x = x.strip().split(' as ')[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', x):
                    names.add(x)
    # 多声明符：const a = 1, b = 2
    for m in MULTI.finditer(s):
        for part in m.group(1).split(','):
            nm = part.split('=')[0].strip()
            if re.match(r'^[A-Za-z_$][\w$]*$', nm):
                names.add(nm)
    return names

exp = {f: exports_of(os.path.join(G, f)) for f in files}

IMP = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./([\w.]+)'", re.M)
problems = []
for f in files:
    s = io.open(os.path.join(G, f), encoding='utf-8').read()
    for m in IMP.finditer(s):
        mod = m.group(2)
        if not mod.endswith('.js'): mod += '.js'
        if mod not in exp:
            problems.append('%s: 找不到模块 %s' % (f, mod)); continue
        for name in [x.strip() for x in m.group(1).split(',') if x.strip()]:
            if name not in exp[mod]:
                problems.append('%s: 从 %s 导入的 %s 未导出' % (f, mod, name))

# 检查未定义标识符（粗筛：使用了但没人导出、也不是本文件声明的）
print('=== 导入问题 ===')
if problems:
    for p in sorted(set(problems)): print('  ' + p)
else:
    print('  无')

print('\n=== 各文件导出数 ===')
for f in sorted(files): print('  %-14s %d' % (f, len(exp[f])))
