/**
 * Lightweight ANSI escape code to HTML converter.
 * Supports SGR (Select Graphic Rendition) sequences for colors and basic styling.
 */

const ANSI_COLORS: Record<number, string> = {
  30: "#4d4d4d", // black
  31: "#ff4d4f", // red
  32: "#52c41a", // green
  33: "#faad14", // yellow
  34: "#1677ff", // blue
  35: "#b37feb", // magenta
  36: "#13c2c2", // cyan
  37: "#d9d9d9", // white
  90: "#8c8c8c", // bright black
  91: "#ff7875", // bright red
  92: "#95de64", // bright green
  93: "#ffd666", // bright yellow
  94: "#69b1ff", // bright blue
  95: "#d3adf7", // bright magenta
  96: "#5cdbd3", // bright cyan
  97: "#ffffff", // bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "#4d4d4d",
  41: "#ff4d4f",
  42: "#52c41a",
  43: "#faad14",
  44: "#1677ff",
  45: "#b37feb",
  46: "#13c2c2",
  47: "#d9d9d9",
  100: "#8c8c8c",
  101: "#ff7875",
  102: "#95de64",
  103: "#ffd666",
  104: "#69b1ff",
  105: "#d3adf7",
  106: "#5cdbd3",
  107: "#ffffff",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Convert text with ANSI escape codes to HTML with colored spans. */
export function ansiToHtml(text: string): string {
  // Match ANSI CSI SGR sequences: ESC[ ... m
  const re = /\x1b\[([0-9;]*)m/g;
  let result = "";
  let lastIndex = 0;
  let openSpans = 0;

  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;

  const buildSpan = () => {
    const styles: string[] = [];
    if (fg) styles.push(`color:${fg}`);
    if (bg) styles.push(`background:${bg}`);
    if (bold) styles.push("font-weight:bold");
    if (dim) styles.push("opacity:0.6");
    if (italic) styles.push("font-style:italic");
    if (underline) styles.push("text-decoration:underline");
    return styles.length > 0 ? `<span style="${styles.join(";")}">`  : null;
  };

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    // Append text before this escape sequence (HTML-escaped)
    if (match.index > lastIndex) {
      result += esc(text.slice(lastIndex, match.index));
    }
    lastIndex = re.lastIndex;

    // Close existing span if any
    if (openSpans > 0) {
      result += "</span>";
      openSpans--;
    }

    // Parse SGR parameters
    const params = match[1] ? match[1].split(";").map(Number) : [0];
    let i = 0;
    while (i < params.length) {
      const p = params[i];
      if (p === 0) {
        fg = null; bg = null; bold = false; dim = false; italic = false; underline = false;
      } else if (p === 1) {
        bold = true;
      } else if (p === 2) {
        dim = true;
      } else if (p === 3) {
        italic = true;
      } else if (p === 4) {
        underline = true;
      } else if (p === 22) {
        bold = false; dim = false;
      } else if (p === 23) {
        italic = false;
      } else if (p === 24) {
        underline = false;
      } else if (p === 39) {
        fg = null;
      } else if (p === 49) {
        bg = null;
      } else if (p >= 30 && p <= 37 || p >= 90 && p <= 97) {
        fg = ANSI_COLORS[p] ?? null;
      } else if (p >= 40 && p <= 47 || p >= 100 && p <= 107) {
        bg = ANSI_BG_COLORS[p] ?? null;
      } else if (p === 38 && i + 1 < params.length) {
        // 256-color or true-color foreground
        if (params[i + 1] === 5 && i + 2 < params.length) {
          fg = color256(params[i + 2]);
          i += 2;
        } else if (params[i + 1] === 2 && i + 4 < params.length) {
          fg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
          i += 4;
        }
      } else if (p === 48 && i + 1 < params.length) {
        // 256-color or true-color background
        if (params[i + 1] === 5 && i + 2 < params.length) {
          bg = color256(params[i + 2]);
          i += 2;
        } else if (params[i + 1] === 2 && i + 4 < params.length) {
          bg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
          i += 4;
        }
      }
      i++;
    }

    // Open new span if there are active styles
    const span = buildSpan();
    if (span) {
      result += span;
      openSpans++;
    }
  }

  // Append remaining text
  if (lastIndex < text.length) {
    result += esc(text.slice(lastIndex));
  }

  // Close any remaining open spans
  while (openSpans > 0) {
    result += "</span>";
    openSpans--;
  }

  return result;
}

/** Strip all ANSI escape codes from text. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Convert a 256-color index to a CSS color string. */
function color256(n: number): string {
  if (n < 8) {
    return Object.values(ANSI_COLORS)[n];
  }
  if (n < 16) {
    return Object.values(ANSI_COLORS)[n - 8 + 8]; // bright colors start at index 8
  }
  if (n < 232) {
    // 6x6x6 color cube
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    return `rgb(${r ? r * 40 + 55 : 0},${g ? g * 40 + 55 : 0},${b ? b * 40 + 55 : 0})`;
  }
  // Grayscale
  const level = (n - 232) * 10 + 8;
  return `rgb(${level},${level},${level})`;
}
