"""检查模板字符串 ${...} 插值里用到的名字是否已声明 / 导入。

这类引用在按行扫描时会被「模板串整体替换掉」的启发式误伤 —— sky.js 的 PREC
就是这么漏掉的。所以单独扫一遍。"""
import re, pathlib

KW = set('''const let var export import default from as function return if else for while do
of in new case break continue switch typeof instanceof delete void try catch finally throw
class extends super this null true false async await yield static get set'''.split())
GLOBALS = set('''window document console Math JSON Object Array Number String Boolean Map Set
WeakMap WeakSet Promise Symbol Reflect Proxy Date Error TypeError RangeError Infinity NaN
undefined performance setTimeout clearTimeout setInterval clearInterval requestAnimationFrame
cancelAnimationFrame parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent
Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array
ArrayBuffer DataView WebGL2RenderingContext WebGLRenderingContext Image ImageData OffscreenCanvas
devicePixelRatio matchMedia navigator location alert structuredClone TextDecoder TextEncoder URL
URLSearchParams Blob Worker globalThis self AudioContext webkitAudioContext getComputedStyle
innerWidth innerHeight'''.split())


def interpolations(raw):
    """取出所有模板串里的 ${...} 内容。"""
    out = []
    i = 0
    n = len(raw)
    while i < n:
        if raw[i] == '`':
            i += 1
            depth = 0
            while i < n:
                c = raw[i]
                if c == '\\':
                    i += 2
                    continue
                if depth == 0 and c == '`':
                    break
                if c == '$' and i + 1 < n and raw[i + 1] == '{':
                    j = i + 2
                    d = 1
                    while j < n and d:
                        if raw[j] == '{':
                            d += 1
                        elif raw[j] == '}':
                            d -= 1
                        elif raw[j] == '`':
                            # 嵌套模板串，跳到它的结尾
                            j += 1
                            while j < n and raw[j] != '`':
                                if raw[j] == '\\':
                                    j += 1
                                j += 1
                        j += 1
                    out.append(raw[i + 2:j - 1])
                    i = j
                    continue
                i += 1
        i += 1
    return out


for p in sorted(pathlib.Path('src').rglob('*.js')):
    raw = p.read_text(encoding='utf-8')
    imports = set()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', raw, re.S):
        for part in m.group(1).split(','):
            a = re.match(r'^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$', part)
            if a:
                imports.add(a.group(2) or a.group(1))
    imports |= set(re.findall(r'import\s+([A-Za-z_$][\w$]*)\s+from', raw))
    if not imports:
        continue
    for expr in interpolations(raw):
        code = re.sub(r"'(?:[^'\\]|\\.)*'", "''", expr)
        code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)
        used = set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)', code))
        missing = [u for u in sorted(used) if u in imports]
        # 只关心「在别处出现过但这里可能没导入」—— 简化：列出所有插值里引用的导入名
        if missing:
            pass
    # 反过来：找出插值里用到、但既没导入也没在本文件声明的名字
    decls = set()
    for m in re.finditer(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)', raw):
        decls.add(m.group(1))
    decls |= set(re.findall(r'\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)', raw))
    decls |= set(re.findall(r'\bclass\s+([A-Za-z_$][\w$]*)', raw))
    for m in re.finditer(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{', raw):
        decls.add(m.group(1))
        for x in re.split(r'[,\s]+', m.group(2)):
            x = x.strip().split('=')[0].strip()
            if re.match(r'^[A-Za-z_$][\w$]*$', x):
                decls.add(x)
    bad = set()
    for expr in interpolations(raw):
        code = re.sub(r"'(?:[^'\\]|\\.)*'", "''", expr)
        code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)
        for u in re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)', code):
            if u in KW or u in GLOBALS or u in imports or u in decls:
                continue
            bad.add(u)
    if bad:
        print(f'### {p}: {sorted(bad)}')
print('--- 模板串插值扫描结束 ---')
