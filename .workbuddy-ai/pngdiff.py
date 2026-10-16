import zlib, struct, sys


def load(path):
    d = open(path, 'rb').read()
    i = 8
    w = h = bitd = ctype = None
    idat = b''
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        data = d[i + 8:i + 8 + ln]
        if typ == b'IHDR':
            w, h, bitd, ctype = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        i += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        if f == 1:
            for x in range(ch, stride):
                line[x] = (line[x] + line[x - ch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, out


w, h, ch, a = load(sys.argv[1])
w2, h2, ch2, b = load(sys.argv[2])
assert (w, h, ch) == (w2, h2, ch2), 'size mismatch'
stride = w * ch
tot = 0
diff = 0
maxd = 0
rows = {}
for y in range(h):
    for x in range(w):
        o = y * stride + x * ch
        d = max(abs(a[o] - b[o]), abs(a[o + 1] - b[o + 1]), abs(a[o + 2] - b[o + 2]))
        tot += 1
        if d > 8:
            diff += 1
            rows[y] = rows.get(y, 0) + 1
        if d > maxd:
            maxd = d
print(f'尺寸 {w}x{h}  像素总数 {tot}')
print(f'明显不同(>8)的像素 {diff}  占比 {diff / tot * 100:.3f}%  最大通道差 {maxd}')
if rows:
    ys = sorted(rows)
    print(f'差异行范围: {ys[0]} ~ {ys[-1]}（共 {len(ys)} 行）')
    top = sorted(rows.items(), key=lambda kv: -kv[1])[:6]
    print('差异最多的行:', top)
