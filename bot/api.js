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

export function startApi({ key, port, officeDir, specsDir, onCommand }) {
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
