// Рисование текста через drawtext (подписи и субтитры).
import fs from "node:fs"
import path from "node:path"

export function defaultFont() {
  if (process.env.FONT) return process.env.FONT
  if (process.platform === 'win32') return 'C:/Windows/Fonts/arialbd.ttf'
  if (process.platform === 'darwin') return '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
}

// Путь внутри фильтра ffmpeg: слэши прямые, двоеточие экранировано.
export const filterPath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:')

export function wrap(text, width) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { lines.push(line); line = w } else line = (line + ' ' + w).trim()
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

// Цепочка drawtext: items = [{text, start, end}]. Возвращает кусок фильтра и последнюю метку.
// pos: 'bottom' (ниже центра), 'top' (сверху), 'subtitle' (самый низ, мельче).
export function textFilters(inLabel, items, dir, prefix, [W, H], pos = 'bottom') {
  const font = defaultFont()
  const base = Math.round((W < H ? W : H) / (W < H ? 17 : 15))
  const size = pos === 'subtitle' ? Math.round(base * 0.8) : base
  const wrapAt = W < H ? 20 : 34
  const y = pos === 'top' ? Math.round(H / 12) : pos === 'subtitle' ? `h-text_h-${Math.round(H / 14)}` : `h-text_h-${Math.round(H / 8)}`
  let filter = ''
  let cur = inLabel
  items.forEach((c, i) => {
    const tf = path.join(dir, `${prefix}${i}.txt`)
    fs.writeFileSync(tf, wrap(c.text, wrapAt), 'utf8')
    filter += `[${cur}]drawtext=fontfile='${filterPath(font)}':textfile='${filterPath(tf)}':fontsize=${size}:` +
      `fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=20:line_spacing=8:x=(w-text_w)/2:y=${y}:` +
      `enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[${prefix}${i}];`
    cur = `${prefix}${i}`
  })
  return { filter, label: cur }
}
