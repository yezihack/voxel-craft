# 分析录屏帧的「有效画面区域」。
# 思路：Playwright 录屏是把浏览器窗口的实际内容区**等比缩放 + 补灰边**
# 塞进 recordVideo.size。灰边是纯 (128,128,128)。
# 这里从四边往里扫，找到第一行/列不再是纯灰的位置，即内容矩形。
import struct, zlib, sys

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat = 8, b''
    w = h = ct = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        body = d[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h, _bd, ct = struct.unpack('>IIBB', body[:10])
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    nch = {0:1, 2:3, 3:1, 4:2, 6:4}[ct]
    stride = w * nch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for i in range(nch, stride): line[i] = (line[i] + line[i-nch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                b = prev[i]
                c = prev[i-nch] if i >= nch else 0
                pp = a + b - c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, nch, out

def is_grey(t):
    return abs(t[0]-128) <= 6 and abs(t[1]-128) <= 6 and abs(t[2]-128) <= 6

for path in sys.argv[1:]:
    w, h, nch, px = read_png(path)
    def at(x, y):
        i = (y*w + x)*nch
        return (px[i], px[i+1], px[i+2])

    # 从下往上找第一行「不是灰」
    top = h - 1
    while top > 0 and is_grey(at(w//2, top)): top -= 1
    # 从上往下找第一行「不是灰」
    bot = 0
    while bot < h-1 and is_grey(at(w//2, bot)): bot += 1
    # 从右往左找第一列「不是灰」
    left = w - 1
    while left > 0 and is_grey(at(left, h//2)): left -= 1
    right = 0
    while right < w-1 and is_grey(at(right, h//2)): right += 1

    print(f'{path}:')
    print(f'   帧 {w}x{h}   内容 x=[{right}..{left}]  y=[{bot}..{top}]')
    print(f'   内容尺寸 {left-right+1}x{top-bot+1}   比例 {(left-right+1)/(top-bot+1):.4f} (16:9={16/9:.4f})')
    print(f'   灰边 右{left+1} 左{right} 下{h-1-top} 上{bot}')
