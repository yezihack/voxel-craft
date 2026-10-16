import re, json, io

SRC = r"G:/AIDevlop/agent-vibercoding/voxel-craft/voxel-craft.html"
lines = io.open(SRC, encoding='utf-8').read().split('\n')
# script starts at line 551 (1-based) -> index 550 ; <script> tag itself
script_start = 551  # 1-based line of "<script>"
script_end = 9573   # 1-based line of "</script>"
body = lines[script_start:script_end-1]   # 0-based slice: lines 552..9572 (1-based)

# find section markers (1-based global line no -> offset)
marks = []
pat = re.compile(r'^/\* =+ (.+?) =+')
for i, l in enumerate(body):
    m = pat.match(l)
    if m:
        marks.append((i, m.group(1).strip()))
marks.append((len(body), 'EOF'))

sections = []
for idx, (start, name) in enumerate(marks[:-1]):
    end = marks[idx+1][0]
    sections.append((name, start, end))

# top-level declared identifiers per section
decl_pat = re.compile(r'^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)')
# destructuring const {a,b} = ... / const [a,b] = ...
destr_pat = re.compile(r'^(?:const|let|var)\s*[{[]([^}\]]+)[}\]]')

declared = {}
for name, s, e in sections:
    ids = set()
    for l in body[s:e]:
        m = decl_pat.match(l)
        if m:
            ids.add(m.group(1))
            continue
        m = destr_pat.match(l)
        if m:
            for part in m.group(1).split(','):
                p = part.strip().split(':')[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', p):
                    ids.add(p)
    declared[name] = ids

all_decl = {}
for name, ids in declared.items():
    for i in ids:
        all_decl.setdefault(i, name)

# identifier usage per section
ident_pat = re.compile(r'\b([A-Za-z_$][\w$]*)\b')
KW = set('''const let var function class return if else for while do switch case break continue new typeof instanceof
in of void delete this true false null undefined try catch finally throw yield await async import export from as
default extends super get set static with debugger NaN Infinity'''.split())

deps = {}
for name, s, e in sections:
    txt = '\n'.join(body[s:e])
    # strip strings & comments roughly
    txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.S)
    txt = re.sub(r'//[^\n]*', ' ', txt)
    txt = re.sub(r"'(?:\\.|[^'\\])*'", "''", txt)
    txt = re.sub(r'"(?:\\.|[^"\\])*"', '""', txt)
    txt = re.sub(r'`(?:\\.|[^`\\])*`', '``', txt)
    used = set(ident_pat.findall(txt))
    ext = {}
    for u in used:
        if u in KW: continue
        owner = all_decl.get(u)
        if owner and owner != name:
            ext.setdefault(owner, set()).add(u)
    deps[name] = ext

out = []
for name, s, e in sections:
    d = deps[name]
    out.append(f"### {name}  (lines {script_start+1+s}-{script_start+e}, {e-s} 行)  声明 {len(declared[name])} 个")
    for owner in sorted(d, key=lambda k: -len(d[k])):
        out.append(f"    -> {owner}: {sorted(d[owner])}")
    if not d:
        out.append("    -> (无跨段依赖)")

io.open(r"G:/AIDevlop/agent-vibercoding/voxel-craft/.workbuddy-ai/deps.txt", 'w', encoding='utf-8').write('\n'.join(out))
print('\n'.join(out))
