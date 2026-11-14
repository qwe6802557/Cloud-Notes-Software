const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 查找表（用于生成标准 PNG 块校验）
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const stride = width * 4;
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (stride + 1);
        raw[rowStart] = 0; // filter None
        rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
    }

    const compressed = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([
        signature,
        makePngChunk('IHDR', ihdr),
        makePngChunk('IDAT', compressed),
        makePngChunk('IEND', Buffer.alloc(0))
    ]);
}

function encodeIco(entries) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2); // ICON
    header.writeUInt16LE(entries.length, 4);

    let offset = 6 + entries.length * 16;
    const dirBuffers = [];
    const dataBuffers = [];

    for (const { size, png } of entries) {
        const entry = Buffer.alloc(16);
        entry[0] = size >= 256 ? 0 : size;
        entry[1] = size >= 256 ? 0 : size;
        entry[2] = 0;
        entry[3] = 0;
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(png.length, 8);
        entry.writeUInt32LE(offset, 12);
        dirBuffers.push(entry);
        dataBuffers.push(png);
        offset += png.length;
    }

    return Buffer.concat([header, ...dirBuffers, ...dataBuffers]);
}

function encodeBmp24(width, height, rgbTopDown) {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixelDataSize = rowSize * height;
    const fileSize = 54 + pixelDataSize;

    const fileHeader = Buffer.alloc(14);
    fileHeader.write('BM', 0, 'ascii');
    fileHeader.writeUInt32LE(fileSize, 2);
    fileHeader.writeUInt32LE(0, 6);
    fileHeader.writeUInt32LE(54, 10);

    const dibHeader = Buffer.alloc(40);
    dibHeader.writeUInt32LE(40, 0);
    dibHeader.writeInt32LE(width, 4);
    dibHeader.writeInt32LE(height, 8);
    dibHeader.writeUInt16LE(1, 12);
    dibHeader.writeUInt16LE(24, 14);
    dibHeader.writeUInt32LE(0, 16);
    dibHeader.writeUInt32LE(pixelDataSize, 20);
    dibHeader.writeInt32LE(2835, 24);
    dibHeader.writeInt32LE(2835, 28);
    dibHeader.writeUInt32LE(0, 32);
    dibHeader.writeUInt32LE(0, 36);

    const pixelData = Buffer.alloc(pixelDataSize);
    for (let y = 0; y < height; y += 1) {
        const srcRow = height - 1 - y; // BMP 为自底向上扫描行
        const dstOffset = y * rowSize;
        for (let x = 0; x < width; x += 1) {
            const srcIdx = (srcRow * width + x) * 3;
            const dstIdx = dstOffset + x * 3;
            pixelData[dstIdx] = rgbTopDown[srcIdx + 2];     // B
            pixelData[dstIdx + 1] = rgbTopDown[srcIdx + 1]; // G
            pixelData[dstIdx + 2] = rgbTopDown[srcIdx];     // R
        }
    }

    return Buffer.concat([fileHeader, dibHeader, pixelData]);
}

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16)
    ];
}

function blendPixel(buf, idx, r, g, b, alpha) {
    if (alpha <= 0) return;
    const a = Math.min(1, alpha);
    const dstA = buf[idx + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    buf[idx] = Math.round((r * a + buf[idx] * dstA * (1 - a)) / outA);
    buf[idx + 1] = Math.round((g * a + buf[idx + 1] * dstA * (1 - a)) / outA);
    buf[idx + 2] = Math.round((b * a + buf[idx + 2] * dstA * (1 - a)) / outA);
    buf[idx + 3] = Math.round(outA * 255);
}

function sdRoundedBox(px, py, cx, cy, hw, hh, radius) {
    const qx = Math.abs(px - cx) - hw + radius;
    const qy = Math.abs(py - cy) - hh + radius;
    const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const inDist = Math.min(Math.max(qx, qy), 0);
    return outDist + inDist - radius;
}

function distSegment(px, py, ax, ay, bx, by) {
    const pax = px - ax;
    const pay = py - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const lenSq = bax * bax + bay * bay || 1;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / lenSq));
    return Math.hypot(pax - bax * h, pay - bay * h);
}

/**
 * 在归一化 [0..1] 坐标系中绘制品牌书本图标到指定 RGBA 画布矩形区域内
 */
function paintBrandIconRegion(rgba, imgW, rx, ry, rSize, withOuterSquircle = true) {
    const slate900 = hexToRgb('#0F172A');
    const slate700 = hexToRgb('#334155');
    const slate100 = hexToRgb('#F8FAFC');
    const sky400 = hexToRgb('#38BDF8');

    const startX = Math.max(0, Math.floor(rx));
    const endX = Math.min(imgW, Math.ceil(rx + rSize));
    const startY = Math.max(0, Math.floor(ry));
    const endY = Math.min(rgba.length / (imgW * 4), Math.ceil(ry + rSize));
    const aa = 1.25 / rSize;

    for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
            const nx = (x + 0.5 - rx) / rSize;
            const ny = (y + 0.5 - ry) / rSize;
            const idx = (y * imgW + x) * 4;

            if (withOuterSquircle) {
                // 主体圆角方形底板（Deep Slate #0F172A + 细边框 #334155）
                const bgDist = sdRoundedBox(nx, ny, 0.5, 0.5, 0.44, 0.44, 0.12);
                const bgAlpha = Math.max(0, Math.min(1, 0.5 - bgDist / aa));
                if (bgAlpha <= 0) continue;
                blendPixel(rgba, idx, slate900[0], slate900[1], slate900[2], bgAlpha);

                const borderBand = Math.abs(bgDist + 0.015) - 0.014;
                const borderAlpha = Math.max(0, Math.min(1, 0.5 - borderBand / aa)) * bgAlpha;
                blendPixel(rgba, idx, slate700[0], slate700[1], slate700[2], borderAlpha);
            }

            // 品牌书本外框（对应 DesktopTitleBar SVG 线条书本比例）
            const strokeW = Math.max(0.032, 1.4 / rSize);
            const bookDist = sdRoundedBox(nx, ny, 0.5, 0.5, 0.22, 0.25, 0.05);
            const bookStroke = Math.abs(bookDist) - strokeW;
            const bookAlpha = Math.max(0, Math.min(1, 0.5 - bookStroke / aa));
            blendPixel(rgba, idx, slate100[0], slate100[1], slate100[2], bookAlpha);

            // 书脊中轴装订竖线
            const spineDist = distSegment(nx, ny, 0.35, 0.27, 0.35, 0.73) - strokeW * 0.85;
            const spineAlpha = Math.max(0, Math.min(1, 0.5 - spineDist / aa));
            blendPixel(rgba, idx, slate100[0], slate100[1], slate100[2], spineAlpha);

            // 页内两条极简文本标线 + Sky #38BDF8 书签条
            const line1 = distSegment(nx, ny, 0.44, 0.42, 0.62, 0.42) - strokeW * 0.65;
            const line2 = distSegment(nx, ny, 0.44, 0.54, 0.58, 0.54) - strokeW * 0.65;
            const linesAlpha = Math.max(
                Math.max(0, Math.min(1, 0.5 - line1 / aa)),
                Math.max(0, Math.min(1, 0.5 - line2 / aa))
            );
            blendPixel(rgba, idx, slate100[0], slate100[1], slate100[2], linesAlpha * 0.88);

            const bookmark = sdRoundedBox(nx, ny, 0.61, 0.33, 0.036, 0.095, 0.012);
            const bmAlpha = Math.max(0, Math.min(1, 0.5 - bookmark / aa));
            blendPixel(rgba, idx, sky400[0], sky400[1], sky400[2], bmAlpha);
        }
    }
}

function renderIconPng(size) {
    const rgba = Buffer.alloc(size * size * 4);
    paintBrandIconRegion(rgba, size, 0, 0, size, true);
    return encodePng(size, size, rgba);
}

function rgbaToRgb(rgba, bgHex) {
    const bg = hexToRgb(bgHex);
    const total = rgba.length / 4;
    const rgb = Buffer.alloc(total * 3);
    for (let i = 0; i < total; i += 1) {
        const a = rgba[i * 4 + 3] / 255;
        rgb[i * 3] = Math.round(rgba[i * 4] * a + bg[0] * (1 - a));
        rgb[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a + bg[1] * (1 - a));
        rgb[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a + bg[2] * (1 - a));
    }
    return rgb;
}

/**
 * 绘制 Stitch 极简架构感侧边栏（164x314）
 */
function renderSidebarBmp(mode) {
    const w = 164;
    const h = 314;
    const rgba = Buffer.alloc(w * h * 4);
    const isInstall = mode === 'install';

    const bgColor = hexToRgb(isInstall ? '#0F172A' : '#F8FAFC');
    const gridColor = hexToRgb(isInstall ? '#1E293B' : '#E2E8F0');
    const accentColor = hexToRgb(isInstall ? '#38BDF8' : '#64748B');
    const dividerColor = hexToRgb(isInstall ? '#334155' : '#CBD5E1');

    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const idx = (y * w + x) * 4;
            rgba[idx] = bgColor[0];
            rgba[idx + 1] = bgColor[1];
            rgba[idx + 2] = bgColor[2];
            rgba[idx + 3] = 255;

            // 精致 architectural 网格线
            if ((x % 24 === 20 || y % 24 === 20) && x > 6 && x < w - 6 && y > 12 && y < h - 12) {
                blendPixel(rgba, idx, gridColor[0], gridColor[1], gridColor[2], 0.45);
            }

            // 右边缘分割线
            if (x === w - 1) {
                blendPixel(rgba, idx, dividerColor[0], dividerColor[1], dividerColor[2], 1);
            }

            // 左侧强调竖条
            if (x >= 18 && x <= 21 && y >= 36 && y <= 84) {
                blendPixel(rgba, idx, accentColor[0], accentColor[1], accentColor[2], 1);
            }

            // 底部装饰等宽尺度线（非文字，纯粹工程网格节奏）
            if (y === 268 && x >= 18 && x <= 116) {
                blendPixel(rgba, idx, dividerColor[0], dividerColor[1], dividerColor[2], 0.9);
            }
            if (y === 278 && x >= 18 && x <= 78) {
                blendPixel(rgba, idx, accentColor[0], accentColor[1], accentColor[2], 0.65);
            }
        }
    }

    // 上部居中偏左绘制清晰品牌徽标
    paintBrandIconRegion(rgba, w, 46, 108, 72, true);
    return encodeBmp24(w, h, rgbaToRgb(rgba, isInstall ? '#0F172A' : '#F8FAFC'));
}

/**
 * 绘制 Stitch NSIS 顶部横幅（150x57）
 */
function renderHeaderBmp() {
    const w = 150;
    const h = 57;
    const rgba = Buffer.alloc(w * h * 4);
    const bgColor = hexToRgb('#F8FAFC');
    const borderColor = hexToRgb('#E2E8F0');
    const accentColor = hexToRgb('#38BDF8');

    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const idx = (y * w + x) * 4;
            rgba[idx] = bgColor[0];
            rgba[idx + 1] = bgColor[1];
            rgba[idx + 2] = bgColor[2];
            rgba[idx + 3] = 255;

            if (y === h - 1) {
                blendPixel(rgba, idx, borderColor[0], borderColor[1], borderColor[2], 1);
            }
            if (y === h - 2 && x >= 102 && x <= 140) {
                blendPixel(rgba, idx, accentColor[0], accentColor[1], accentColor[2], 0.85);
            }
        }
    }

    paintBrandIconRegion(rgba, w, 104, 10, 36, true);
    return encodeBmp24(w, h, rgbaToRgb(rgba, '#F8FAFC'));
}

function verifyOutputs(icoPath, bmpSpecs) {
    const icoBuf = fs.readFileSync(icoPath);
    if (icoBuf.readUInt16LE(0) !== 0 || icoBuf.readUInt16LE(2) !== 1) {
        throw new Error('icon.ico ICO header invalid');
    }
    const count = icoBuf.readUInt16LE(4);
    const expectedSizes = [16, 24, 32, 48, 64, 128, 256];
    if (count !== expectedSizes.length) {
        throw new Error(`icon.ico layer count mismatch: ${count}`);
    }
    for (let i = 0; i < count; i += 1) {
        const base = 6 + i * 16;
        const w = icoBuf[base] === 0 ? 256 : icoBuf[base];
        const h = icoBuf[base + 1] === 0 ? 256 : icoBuf[base + 1];
        const size = icoBuf.readUInt32LE(base + 8);
        const offset = icoBuf.readUInt32LE(base + 12);
        const pngHeader = icoBuf.subarray(offset, offset + 8);
        if (!pngHeader.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
            throw new Error(`icon.ico layer ${w}x${h} is not valid PNG`);
        }
        const ihdrW = icoBuf.readUInt32BE(offset + 16);
        const ihdrH = icoBuf.readUInt32BE(offset + 20);
        if (ihdrW !== expectedSizes[i] || ihdrH !== expectedSizes[i] || size <= 0) {
            throw new Error(`icon.ico layer dimensions mismatch: ${ihdrW}x${ihdrH}`);
        }
    }

    for (const spec of bmpSpecs) {
        const bmp = fs.readFileSync(spec.file);
        if (bmp.toString('ascii', 0, 2) !== 'BM') {
            throw new Error(`${spec.file} invalid BM signature`);
        }
        const bw = bmp.readInt32LE(18);
        const bh = bmp.readInt32LE(22);
        const bpp = bmp.readUInt16LE(28);
        if (bw !== spec.width || bh !== spec.height || bpp !== 24) {
            throw new Error(`${spec.file} metadata mismatch: ${bw}x${bh}@${bpp}`);
        }
        // 核验无纯黑 #000000 像素
        const rowSize = Math.ceil((bw * 3) / 4) * 4;
        for (let y = 0; y < bh; y += 1) {
            const rowOffset = 54 + y * rowSize;
            for (let x = 0; x < bw; x += 1) {
                const p = rowOffset + x * 3;
                if (bmp[p] === 0 && bmp[p + 1] === 0 && bmp[p + 2] === 0) {
                    throw new Error(`${spec.file} contains pure black pixel at (${x},${y})`);
                }
            }
        }
    }
}

function main() {
    const assetsDir = path.resolve(__dirname, '../assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const icoEntries = sizes.map(size => ({ size, png: renderIconPng(size) }));
    const icoPath = path.join(assetsDir, 'icon.ico');
    fs.writeFileSync(icoPath, encodeIco(icoEntries));

    const installerSidebarPath = path.join(assetsDir, 'installerSidebar.bmp');
    const uninstallerSidebarPath = path.join(assetsDir, 'uninstallerSidebar.bmp');
    const installerHeaderPath = path.join(assetsDir, 'installerHeader.bmp');

    fs.writeFileSync(installerSidebarPath, renderSidebarBmp('install'));
    fs.writeFileSync(uninstallerSidebarPath, renderSidebarBmp('uninstall'));
    fs.writeFileSync(installerHeaderPath, renderHeaderBmp());

    verifyOutputs(icoPath, [
        { file: installerSidebarPath, width: 164, height: 314 },
        { file: uninstallerSidebarPath, width: 164, height: 314 },
        { file: installerHeaderPath, width: 150, height: 57 }
    ]);

    console.log('ASSETS_GENERATED_AND_VERIFIED:', {
        icoPath,
        layers: sizes,
        installerSidebarPath,
        uninstallerSidebarPath,
        installerHeaderPath
    });
}

if (require.main === module) {
    main();
}

module.exports = { main, encodePng, encodeIco, encodeBmp24 };
