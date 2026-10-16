"""找出「模块顶层语句引用了 import 进来的名字」—— ESM 循环引用下的 TDZ 隐患。"""
import re, pathlib

for p in sorted(pathlib.Path('src').rglob('*.js')):
    raw = p.read_text(encoding='utf-8')
    # 收集 import 名
    imports = set()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', raw, re.S):
        for part in m.group(1).split(','):
            a = re.match(r'^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$', part)
            if a:
                imports.add(a.group(2) or a.group(1))
    if not imports:
        continue

    lines = raw.split('\n')
    in_block = False
    in_import = False
    hits = []
    for i, line in enumerate(lines):
        s = line.strip()
        if in_block:
            if '*/' in line:
                in_block = False
            continue
        if line.lstrip().startswith('/*'):
            if '*/' not in line:
                in_block = True
            continue
        if not s or s.startswith('//') or s.startswith('*'):
            continue
        # import 语句（可能多行）
        if in_import:
            if re.search(r"from\s*['\"]", line):
                in_import = False
            continue
        if s.startswith('import'):
            if not re.search(r"from\s*['\"]", line):
                in_import = True
            continue
        # 只看「顶层」语句：行首无缩进
        if line[:1].isspace():
            continue
        if s.startswith('export') and ' from ' in s:
            continue
        if s.startswith('export {'):
            continue
        code = line.split('//')[0]
        used = [n for n in imports if re.search(r'(?<![\w$.])' + re.escape(n) + r'\b', code)]
        if used:
            hits.append((i + 1, line.strip(), used))

    if hits:
        print(f'### {p}')
        for ln, txt, used in hits:
            print(f'   {ln}: [{", ".join(used)}]  {txt[:110]}')
