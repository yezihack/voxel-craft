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
innerWidth innerHeight outerWidth outerHeight screenX screenY scrollX scrollY'''.split())


def strip(txt):
    txt = re.sub(r'`(?:[^`\\]|\\.)*`', '``', txt, flags=re.S)
    txt = re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", txt)
    txt = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', txt)
    txt = re.sub(r'/\*.*?\*/', '', txt, flags=re.S)
    txt = re.sub(r'(?<![\w)\]])/(?![/*])(?:[^/\\\n\[]|\\.|\[[^\]]*\])+/[gimsuy]*', 'RE', txt)
    txt = re.sub(r'//[^\n]*', '', txt)
    return txt


def names_from_seg(seg):
    out = set()
    for part in re.split(r',(?![^\[\]{}()]*[\]\}\)])', seg):
        part = part.strip()
        if part.startswith('{') or part.startswith('['):
            inner = part[1:].split('}')[0].split(']')[0]
            for f in inner.split(','):
                f = f.strip().split(':')[-1].split('=')[0].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', f):
                    out.add(f)
            continue
        mm = re.match(r'^([A-Za-z_$][\w$]*)', part)
        if mm:
            out.add(mm.group(1))
    return out


def collect(txt):
    n = set()
    for m in re.finditer(r'\b(?:const|let|var)\s+([^\n;]*)', txt):
        n |= names_from_seg(m.group(1))
    n |= set(re.findall(r'\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)', txt))
    n |= set(re.findall(r'\bclass\s+([A-Za-z_$][\w$]*)', txt))
    for m in re.finditer(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{', txt):
        n.add(m.group(1))
        for p in m.group(2).split(','):
            p = p.strip().split('=')[0].strip().strip('{}[]')
            for f in re.split(r'[,\s]+', p):
                f = f.split(':')[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', f):
                    n.add(f)
    for m in re.finditer(r'\bfunction\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)', txt):
        for p in m.group(1).split(','):
            p = p.strip().split('=')[0].strip().strip('{}[]')
            for f in re.split(r'[,\s]+', p):
                f = f.split(':')[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', f):
                    n.add(f)
    for m in re.finditer(r'\(([^()]*)\)\s*=>', txt):
        for p in m.group(1).split(','):
            p = p.strip().split('=')[0].strip().strip('{}[]')
            for f in re.split(r'[,\s]+', p):
                f = f.split(':')[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', f):
                    n.add(f)
    n |= set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>', txt))
    n |= set(re.findall(r'\bcatch\s*\(\s*([A-Za-z_$][\w$]*)', txt))
    n |= set(re.findall(r'\bfor\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s+(?:of|in)\b', txt))
    return n


for p in sorted(pathlib.Path('src').rglob('*.js')):
    txt = strip(p.read_text(encoding='utf-8'))
    imports = set()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', txt, re.S):
        for part in m.group(1).split(','):
            a = re.match(r'^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$', part)
            if a:
                imports.add(a.group(2) or a.group(1))
    imports |= set(re.findall(r'import\s+([A-Za-z_$][\w$]*)\s+from', txt))
    known = imports | collect(txt) | GLOBALS | KW
    body = re.sub(r'^\s*(?:import|export)\b.*$', '', txt, flags=re.M)
    body = re.sub(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*:(?!:)', ' ', body)
    used = set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)', body))
    miss = sorted(u for u in used if u not in known)
    if miss:
        print(f'### {p}: {miss}')
print('--- scan done ---')
