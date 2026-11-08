import { useMemo } from "react";

/** 纯 CSS 生成的像素风封面。
 *
 * 铁锈战争本身是像素游戏，用细网格色块拼一张「地平线剪影」比灰底占位图
 * 更贴合气质，也省掉了封面图托管与加载（列表滚动时零网络请求）。 */

const COLUMNS = 16;
const ROWS = 9;

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成 16×9 的地形剪影：上方夜空、中间地平线、下方地面。 */
function buildCells(seed: string): string[] {
  const random = mulberry32(hashSeed(seed));
  const hue = Math.floor(random() * 360);
  const groundHue = (hue + 28) % 360;

  const skyDark = `hsl(${hue} 30% 9%)`;
  const skyMid = `hsl(${hue} 32% 14%)`;
  const skyHigh = `hsl(${hue} 38% 20%)`;
  const groundDark = `hsl(${groundHue} 24% 8%)`;
  const groundMid = `hsl(${groundHue} 28% 12%)`;
  const groundLit = `hsl(${groundHue} 32% 17%)`;
  // 星点用半透明，太实会像坏像素
  const star = "rgba(61, 220, 151, 0.55)";

  // 地平线在 3–5 行之间浮动，让不同封面有各自的「天空比例」
  const horizon = 3 + Math.floor(random() * 3);
  const cells: string[] = [];

  for (let row = 0; row < ROWS; row += 1) {
    // 越靠下越亮一点点，模拟远景压暗
    for (let column = 0; column < COLUMNS; column += 1) {
      const roll = random();
      if (row < horizon) {
        const depth = horizon - row;
        if (depth >= 3) cells.push(roll > 0.7 ? skyMid : skyDark);
        else cells.push(roll > 0.55 ? skyHigh : skyMid);
      } else if (row === horizon) {
        cells.push(roll > 0.6 ? groundLit : groundMid);
      } else {
        cells.push(roll > 0.85 ? groundMid : groundDark);
      }
    }
  }

  // 地平线上的一两颗星，用品牌色点缀，别用随机色相
  const stars = 1 + Math.floor(random() * 2);
  for (let index = 0; index < stars; index += 1) {
    const row = Math.floor(random() * Math.max(horizon - 1, 1));
    const column = Math.floor(random() * COLUMNS);
    cells[row * COLUMNS + column] = star;
  }

  return cells;
}

interface PixelCoverProps {
  seed: string;
}

export function PixelCover({ seed }: PixelCoverProps) {
  const cells = useMemo(() => buildCells(seed), [seed]);
  return (
    <div className="pixel-cover" aria-hidden="true">
      {cells.map((color, index) => (
        <span key={index} style={{ background: color }} />
      ))}
    </div>
  );
}
