// Анимированный заголовок для рилс через HyperFrames (открытый проект HeyGen: HTML -> видео).
// Рендерит короткое ПРОЗРАЧНОЕ наложение (webm с альфа-каналом), которое bot/reels.js кладёт поверх ролика.
// Нужны: пакет hyperframes (npm install -g hyperframes), Node 22+, ffmpeg и Chrome. Если чего-то нет или рендер не удался,
// монтаж продолжается с обычным заголовком (drawtext).
//   HF_TITLE=0       выключить анимированный заголовок
//   HF_CHROME=...    путь к Chrome (по умолчанию ищется Chrome от Playwright)
//   HF_WORKERS=1     потоков рендера (на слабом сервере 1)
//   HF_TIMEOUT=240   сколько секунд ждать рендер
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const HF_DURATION = 3.4 // секунд (совпадает с шаблоном)

const ACCENT = { sharp: '#FFD400', cinema: '#4FD1C5', warm: '#FFB347', bw: '#FFFFFF' }

function findChrome() {
  const cands = [process.env.HF_CHROME, process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH].filter(Boolean)
  for (const root of ['/ms-playwright', '/opt/pw-browsers', path.join(process.env.HOME || '', '.cache/ms-playwright')]) {
    try {
      for (const d of fs.readdirSync(root).filter(x => /^chromium-\d+$/.test(x))) {
        for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) cands.push(path.join(root, d, sub))
      }
    } catch { /* папки нет */ }
  }
  return cands.find(c => { try { return fs.statSync(c).isFile() } catch { return false } }) || null
}

function findGsap() {
  const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout?.trim()
  if (!root) return null
  const vend = path.join(root, 'hyperframes', 'dist', 'vendor', 'npm')
  try {
    for (const d of fs.readdirSync(vend).filter(x => x.startsWith('gsap@')).sort().reverse()) {
      const f = path.join(vend, d, 'dist', 'gsap.min.js')
      if (fs.existsSync(f)) return f
    }
  } catch { /* нет */ }
  const g = path.join(root, 'gsap', 'dist', 'gsap.min.js')
  return fs.existsSync(g) ? g : null
}

let available
export function hfAvailable() {
  if (process.env.HF_TITLE === '0') return false
  if (available === undefined) {
    const v = spawnSync('hyperframes', ['--version'], { stdio: 'ignore' })
    available = v.status === 0 && Boolean(findChrome()) && Boolean(findGsap())
  }
  return available
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Возвращает путь к прозрачному webm или null (тогда используется обычный заголовок).
export async function renderTitleOverlay(title, { style = 'sharp', dir }) {
  if (!hfAvailable()) return null
  const words = String(title).trim().split(/\s+/).filter(Boolean).slice(0, 10)
  if (!words.length) return null
  const proj = path.join(dir, 'hf-title')
  fs.mkdirSync(proj, { recursive: true })
  const accent = ACCENT[style] || ACCENT.sharp
  // последнее слово заголовка выделяем цветом
  const html = fs.readFileSync(path.join(HERE, 'hf', 'title.html'), 'utf8')
    .replaceAll('__ACCENT__', accent)
    .replace('__WORDS__', words.map((w, i) => `<span class="w${i === words.length - 1 ? ' hot' : ''}">${esc(w)}</span>`).join(''))
  fs.writeFileSync(path.join(proj, 'index.html'), html)
  fs.copyFileSync(findGsap(), path.join(proj, 'gsap.min.js'))
  fs.writeFileSync(path.join(proj, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: false } }))
  fs.writeFileSync(path.join(proj, 'meta.json'), JSON.stringify({ id: 'title', name: 'title' }))

  const out = path.join(proj, 'overlay.webm')
  const env = {
    ...process.env,
    PUPPETEER_EXECUTABLE_PATH: findChrome(),
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    DO_NOT_TRACK: '1',
  }
  const args = ['render', '-c', 'index.html', '-o', out, '--format', 'webm', '--fps', '30', '--quality', 'standard', '--workers', String(process.env.HF_WORKERS || 1), '--quiet']
  const ok = await new Promise(resolve => {
    const p = spawn('hyperframes', args, { cwd: proj, env, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', d => (err += d))
    const timer = setTimeout(() => p.kill(), Number(process.env.HF_TIMEOUT || 240) * 1000)
    p.on('error', () => resolve(false))
    p.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) console.error('[hyperframes]', err.trim().split('\n').slice(-2).join(' ').slice(0, 300))
      resolve(code === 0 && fs.existsSync(out))
    })
  })
  return ok ? out : null
}
