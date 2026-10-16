import re, io, json

SRC = r"G:/AIDevlop/agent-vibercoding/voxel-craft/voxel-craft.html"
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
    ("input",    8260, 8473), ("actions",  8474, 8648), ("ui",       8649, 9075),
    ("loop",     9076, 9406), ("boot",     9407, 9572),
]
def owner_of(gline):
    for n, a, b in SECTIONS:
        if a <= gline <= b: return n
    return None

decl_pat = re.compile(r'^(?:const|let|var)\s+([A-Za-z_$][\w$]*)')
owner = {}
kind = {}
for n, a, b in SECTIONS:
    for g in range(a, b + 1):
        m = decl_pat.match(lines[g - 1])
        if m and m.group(1) not in owner:
            owner[m.group(1)] = n
            kind[m.group(1)] = lines[g - 1].split()[0]

# find simple assignments  IDENT = (not ==, =>, >=, <=, !=)
asg = re.compile(r'(?<![=!<>+\-*/%&|^])\b([A-Za-z_$][\w$]*)\s*=(?!=)')
strip = lambda t: re.sub(r'//[^\n]*', ' ', t)
res = {}
for g in range(SCRIPT_START, SCRIPT_END + 1):
    l = strip(lines[g - 1])
    if l.lstrip().startswith('*') or l.lstrip().startswith('/*'): continue
    for m in asg.finditer(l):
        name = m.group(1)
        o = owner.get(name)
        if not o: continue
        cur = owner_of(g)
        if cur and cur != o:
            res.setdefault(name, {"owner": o, "kind": kind[name], "assigned_in": set()})
            res[name]["assigned_in"].add(cur)

for k in sorted(res, key=lambda x: (res[x]["owner"], x)):
    v = res[k]
    print("%-22s owner=%-9s %-5s  assigned_in=%s" % (k, v["owner"], v["kind"], sorted(v["assigned_in"])))
