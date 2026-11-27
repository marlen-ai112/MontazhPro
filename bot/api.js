// HTTP-интерфейс для приложения «AI-офис» (папка office/).
// Включается, если задан APP_KEY. Страница приложения открыта всем, а данные и команды требуют ключ.
//   APP_KEY=длинный_секрет   ключ доступа (без него интерфейс выключен)
//   APP_PORT=8787            порт
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getState, pushFeed } from './office.js'

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/icon-180.png': ['icon-180.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest()
const fails = new Map() // ip -> { n, until }

export function startApi({ key, port, officeDir, specsDir, videoOutDir, videoInDir, onCommand, onVideo }) {
  const keyHash = sha(key)

  const authed = (req, url) => {
    let given = req.headers['x-app-key'] || url.searchParams.get('key') || ''
    if (req.headers['x-app-key']) {
      // приложение кодирует ключ (encodeURIComponent), чтобы в заголовок попадали только безопасные символы
      try {
        given = decodeURIComponent(given)
      } catch {
        /* ключ без кодирования */
      }
    }
    return crypto.timingSafeEqual(sha(given), keyHash)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const ip = req.socket.remoteAddress
    const send = (code, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra })
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    }

    // Статика приложения
    const st = req.method === 'GET' && STATIC[url.pathname]
    if (st) {
      try {
        return send(200, fs.readFileSync(path.join(officeDir, st[0])), st[1])
      } catch {
        return send(404, { error: 'not found' })
      }
    }

    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/files/')) return send(404, { error: 'not found' })

    // Защита от подбора ключа: после 10 неудачных попыток IP блокируется на 10 минут.
    const f = fails.get(ip)
    if (f && f.n >= 10 && Date.now() < f.until) return send(429, { error: 'too many attempts' })
    if (!authed(req, url)) {
      // Запросы вообще без ключа (окно входа открыто) не считаем подбором.
      if (!req.headers['x-app-key'] && !url.searchParams.get('key')) return send(401, { error: 'unauthorized' })
      const n = (f && Date.now() < f.until ? f.n : 0) + 1
      fails.set(ip, { n, until: Date.now() + 10 * 60 * 1000 })
      return send(401, { error: 'unauthorized' })
    }
    fails.delete(ip)

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(200, getState(Number(url.searchParams.get('since')) || 0))
    }

    if (req.method === 'POST' && url.pathname === '/api/command') {
      let body = ''
      req.on('data', d => {
        body += d
        if (body.length > 4096) req.destroy()
      })
      req.on('end', () => {
        let text = ''
        try {
          text = String(JSON.parse(body).text || '').trim().slice(0, 500)
        } catch {
          return send(400, { error: 'bad json' })
        }
        if (!text) return send(400, { error: 'empty' })
        pushFeed('user', text)
        Promise.resolve(onCommand(text)).catch(e => {
          console.error('[api] команда:', e.message)
          pushFeed('system', `Ошибка выполнения команды: ${e.message}`)
        })
        send(200, { ok: true })
      })
      return
    }

    // Загрузка видео на монтаж: тело запроса = файл. Имя и подпись (заголовок, стиль) в адресе.
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const maxMb = Number(process.env.VIDEO_MAX_MB || 150)
      if (!onVideo || !videoInDir) return send(404, { error: 'video disabled' })
      const len = Number(req.headers['content-length'] || 0)
      if (len > maxMb * 1024 * 1024) return send(413, { error: `Файл больше ${maxMb} МБ` })
      const ext = (path.extname(url.searchParams.get('name') || '').toLowerCase().match(/^\.(mp4|mov|m4v|webm|mkv|pdf)$/) || ['', '.mp4'])[0] || '.mp4'
      fs.mkdirSync(videoInDir, { recursive: true })
      const file = path.join(videoInDir, `in_${Date.now()}${ext}`)
      const ws = fs.createWriteStream(file)
      let size = 0
      let aborted = false
      req.on('data', d => {
        size += d.length
        if (size > maxMb * 1024 * 1024 && !aborted) { aborted = true; ws.destroy(); req.destroy() }
      })
      req.pipe(ws)
      ws.on('finish', () => {
        if (aborted) return
        const caption = String(url.searchParams.get('caption') || '').slice(0, 300)
        pushFeed('user', `${ext === '.pdf' ? '📄 PDF на разбор' : '🎬 Видео на монтаж'}: ${(size / 1024 / 1024).toFixed(1)} МБ${caption ? `\n${caption}` : ''}`)
        Promise.resolve(onVideo(file, caption)).catch(e => {
          console.error('[api] видео:', e.message)
          pushFeed('video', `Ошибка монтажа: ${e.message}`)
        })
        send(200, { ok: true })
      })
      ws.on('error', () => send(500, { error: 'write failed' }))
      return
    }

    // Готовые ролики (mp4, с поддержкой Range, иначе iPhone не проигрывает): только из папки результатов.
    if (req.method === 'GET' && url.pathname.startsWith('/files/') && url.pathname.endsWith('.mp4')) {
      const name = decodeURIComponent(url.pathname.slice(7))
      if (!/^[\w.\-]+\.mp4$/.test(name) || !videoOutDir) return send(400, { error: 'bad name' })
      const file = path.join(videoOutDir, name)
      let st
      try { st = fs.statSync(file) } catch { return send(404, { error: 'not found' }) }
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      let start = 0
      let end = st.size - 1
      if (range) {
        if (range[1] !== '') start = Number(range[1])
        if (range[2] !== '') end = Math.min(end, Number(range[2]))
        if (range[1] === '' && range[2] !== '') { start = Math.max(0, st.size - Number(range[2])); end = st.size - 1 }
        if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end() }
      }
      res.writeHead(range ? 206 : 200, {
        'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1,
        ...(range ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}), 'cache-control': 'no-store',
      })
      return fs.createReadStream(file, { start, end }).pipe(res)
    }

    // PDF спецификаций: только файлы из папки specs, имя без путей.
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const name = decodeURIComponent(url.pathname.slice(7))
      if (!/^[\w.\-]+\.pdf$/.test(name)) return send(400, { error: 'bad name' })
      try {
        return send(200, fs.readFileSync(path.join(specsDir, name)), 'application/pdf', {
          'content-disposition': `inline; filename="${name}"`,
        })
      } catch {
        return send(404, { error: 'not found' })
      }
    }

    send(404, { error: 'not found' })
  })

  server.listen(port, '0.0.0.0', () => console.log(`[api] AI-офис доступен на порту ${port}`))
  server.on('error', e => console.error('[api]', e.message))
  return server
}
