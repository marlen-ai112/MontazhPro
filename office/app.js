'use strict'
// AI-офис: пиксельный офис, в котором у каждой команды бота свой сотрудник.
// Когда сотрудник занят, он сидит за компьютером. Свободный гуляет по офису.
// Внизу командный пункт: сюда приходят все результаты, отсюда отдаются команды.

const W = 120 // логическая ширина (пиксельная сетка)
const H = 108
const S = 3 // масштаб: 1 логический пиксель = 3 пикселя холста

const cv = document.getElementById('c')
const ctx = cv.getContext('2d')
ctx.imageSmoothingEnabled = false

const params = new URLSearchParams(location.search)
const API = params.get('api') || ''
let demo = params.has('demo') || location.protocol === 'file:'
let key = ''
try { key = localStorage.getItem('officeKey') || '' } catch (e) { /* хранилище недоступно */ }

// ---- Сотрудники -----------------------------------------------------------
const AGENTS = [
  { id: 'tenders', name: 'Поиск тендеров', color: '#4da3ff', hair: '#3b2a1a', desk: 0,
    hint: 'Ищет закупки на zakup.sk.kz: товар, запрос ценовых предложений, 1,5–5 млн тг.',
    cmds: [['Найти тендеры', '/tenders']] },
  { id: 'specs', name: 'Спецификации', color: '#a77bff', hair: '#1f1f2b', desk: 1,
    hint: 'Читает карточку и PDF-спецификацию, определяет точный товар.',
    cmds: [['Разобрать закупку', '/tender ']] },
  { id: 'prices', name: 'Цены и маржа', color: '#38c172', hair: '#b0561f', desk: 2,
    hint: 'Ищет цены на Satu.kz и считает маржу. Формат: /price товар | цена заказчика',
    cmds: [['Цены на товар', '/price ']] },
  { id: 'assistant', name: 'ИИ-помощник', color: '#ffb340', hair: '#5a3b1c', desk: 3,
    hint: 'Отвечает на вопросы свободным текстом (нужен ключ Anthropic).', cmds: [] },
  { id: 'video', name: 'Видеомонтаж', color: '#ff5e7a', hair: '#15151c', desk: 4,
    hint: 'Монтаж видео работает отдельным ботом (папка video-bot), в офис пока не подключён.', cmds: [] },
]

// Столы: [x, y] верхнего левого угла стола. Ряд 1 у стены, ряд 2 ниже.
const DESKS = [[6, 32], [46, 32], [86, 32], [26, 62], [66, 62]]
const LANE_Y = 86 // проход внизу, по нему сотрудники ходят к столам

for (const a of AGENTS) {
  const [dx, dy] = DESKS[a.desk]
  a.chair = [dx + 10, dy + 11] // место за столом
  a.x = 14 + a.desk * 20
  a.y = 90 + (a.desk % 2) * 6
  a.status = a.id === 'video' ? 'offline' : 'idle'
  a.task = ''
  a.path = []
  a.pose = 'stand'
  a.face = 'down'
  a.wait = 20 + Math.random() * 120
  a.seated = false
}
const byId = Object.fromEntries(AGENTS.map(a => [a.id, a]))

// ---- Рисование ------------------------------------------------------------
function px(x, y, w, h, c) {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x) * S, Math.round(y) * S, w * S, h * S)
}

function drawOffice(t) {
  // стена
  px(0, 0, W, 26, '#2a3a5c')
  px(0, 24, W, 2, '#1c2842')
  // окна
  for (const wx of [8, 52, 96]) {
    px(wx, 5, 16, 14, '#14203a')
    px(wx + 1, 6, 14, 12, '#6fb7ff')
    px(wx + 1, 6, 14, 4, '#9bd0ff')
    px(wx + 7, 6, 1, 12, '#14203a')
    px(wx + 1, 11, 14, 1, '#14203a')
  }
  // вывеска
  px(36, 3, 48, 10, '#0a0f18'); px(37, 4, 46, 8, '#16233d')
  ctx.fillStyle = '#7fe3ff'; ctx.font = 'bold 10px "SF Mono", Menlo, Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
  ctx.fillText('AI-ОФИС', 60 * S, 8.5 * S); ctx.textAlign = 'left'
  // пол: паркет
  for (let y = 26; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      const odd = ((x / 8) + ((y - 26) / 8)) % 2 === 0
      px(x, y, 8, 8, odd ? '#8a6a46' : '#7f6040')
      px(x, y, 8, 1, 'rgba(0,0,0,.12)')
    }
  }
  // ковёр в проходе
  px(30, 84, 60, 18, '#3d4f78')
  px(31, 85, 58, 16, '#465c8c')
  // диван
  px(3, 94, 22, 12, '#7b3f3f'); px(3, 94, 22, 4, '#9a5252'); px(5, 98, 18, 6, '#8a4747'); px(3, 98, 3, 8, '#6b3535'); px(22, 98, 3, 8, '#6b3535')
  // кулер
  px(104, 88, 8, 14, '#cfd8e8'); px(105, 84, 6, 5, '#8fd0ff'); px(105, 84, 6, 1, '#bfe6ff'); px(106, 94, 4, 2, '#556')
  // растение
  px(112, 28, 6, 6, '#a0522d'); px(110, 18, 10, 10, '#2e8b57'); px(112, 14, 6, 6, '#3cb371')
  px(2, 28, 6, 6, '#a0522d'); px(0, 18, 10, 10, '#2e8b57'); px(2, 14, 6, 6, '#3cb371')
}

function drawDesk(a, t) {
  const [x, y] = DESKS[a.desk]
  // стол
  px(x, y, 28, 10, '#b27d45'); px(x, y, 28, 2, '#c99560'); px(x, y + 10, 28, 1, '#6f4a26')
  px(x + 1, y + 11, 2, 4, '#6f4a26'); px(x + 25, y + 11, 2, 4, '#6f4a26')
  // монитор
  px(x + 7, y - 8, 14, 10, '#161c28')
  const on = a.status === 'working'
  px(x + 8, y - 7, 12, 8, a.status === 'offline' ? '#0c0f16' : on ? '#0f2036' : '#1d2740')
  if (on) {
    for (let i = 0; i < 4; i++) {
      const w = 3 + ((Math.floor(t / 10) * 7 + i * 5) % 8)
      px(x + 9, y - 6 + i * 2, Math.min(w, 10), 1, a.color)
    }
  } else if (a.status === 'idle') {
    px(x + 12, y - 5, 4, 3, '#33415e')
  }
  px(x + 12, y + 2, 4, 2, '#161c28')
  // клавиатура
  px(x + 9, y + 5, 10, 3, '#dfe6f3')
  // кружка
  px(x + 23, y + 3, 3, 3, a.color)
}

const SKIN = '#f2c28b'
function drawPerson(a, t) {
  const x = Math.round(a.x)
  const y = Math.round(a.y)
  const shirt = a.color
  const hair = a.hair
  const pants = '#2b3a55'
  const f = Math.floor(t / 8) % 2
  const sit = a.pose === 'sit'
  if (!sit) px(x + 1, y + 11, 6, 1, 'rgba(0,0,0,.28)')

  if (sit || a.pose === 'sleep') {
    const sleeping = a.pose === 'sleep'
    const hy = sleeping ? 2 : 0
    px(x + 1, y + 5, 6, 5, shirt) // спина
    px(x + 2, y + hy, 4, 5, hair) // затылок
    px(x + 2, y + 4 + hy, 4, 1, SKIN)
    if (sleeping) {
      px(x + 1, y + 5, 6, 1, shirt)
    } else {
      // руки печатают
      px(x, y + 5, 1, 3, shirt); px(x + 7, y + 5, 1, 3, shirt)
      px(x + 1 + f, y + 3, 1, 2, SKIN); px(x + 6 - f, y + 3, 1, 2, SKIN)
    }
    return
  }
  // ноги
  const l = a.pose === 'walk' ? f : 0
  px(x + 2, y + 9, 2, 3 - l, pants); px(x + 4, y + 9, 2, 2 + l, pants)
  px(x + 2, y + 11 - l, 2, 1, '#111'); px(x + 4, y + 11 - (1 - l) - (0), 2, 1, '#111')
  // тело и руки
  px(x + 1, y + 5, 6, 4, shirt)
  const sw = a.pose === 'walk' ? f : 0
  px(x, y + 5 + sw, 1, 3, shirt); px(x + 7, y + 6 - sw, 1, 3, shirt)
  px(x, y + 8 + sw, 1, 1, SKIN); px(x + 7, y + 9 - sw, 1, 1, SKIN)
  // голова
  if (a.face === 'up') {
    px(x + 2, y, 4, 5, hair)
  } else {
    px(x + 2, y + 1, 4, 4, SKIN)
    px(x + 2, y, 4, 2, hair)
    px(x + 3, y + 2, 1, 1, '#222'); px(x + 5, y + 2, 1, 1, '#222')
  }
}

function drawBubble(a, t) {
  const text = a.task ? a.task : '…'
  const label = text.length > 16 ? text.slice(0, 15) + '…' : text
  ctx.font = '10px "SF Mono", Menlo, Consolas, monospace'
  const w = Math.max(24, Math.ceil(ctx.measureText(label).width / S) + 5)
  const [dx, dy] = DESKS[a.desk]
  let bx = Math.round(dx + 14 - w / 2)
  bx = Math.max(1, Math.min(W - w - 1, bx))
  const by = dy - 21
  px(bx, by, w, 10, '#ffffff'); px(bx + 1, by + 10, w - 2, 1, '#ffffff')
  px(dx + 13, by + 11, 2, 1, '#ffffff')
  ctx.fillStyle = '#10213d'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, (bx + 2) * S, (by + 5.5) * S)
}

function drawZ(a, t) {
  const k = Math.floor(t / 30) % 3
  ctx.fillStyle = '#cfe3ff'
  ctx.font = 'bold 10px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('z', (a.x + 8) * S, (a.y + 2 - k * 2) * S)
  ctx.fillText('Z', (a.x + 11) * S, (a.y - 3 - k * 2) * S)
}

// ---- Поведение ------------------------------------------------------------
function pathToChair(a) {
  const pts = []
  if (a.y < 80) pts.push([a.x, LANE_Y]) // сначала вниз в проход
  pts.push([a.chair[0], LANE_Y])
  pts.push([a.chair[0], a.chair[1]])
  return pts
}

function wanderPoint() {
  return [6 + Math.random() * 104, 84 + Math.random() * 12]
}

function step(a, dt) {
  const working = a.status === 'working'
  const offline = a.status === 'offline'
  const atChair = Math.abs(a.x - a.chair[0]) < 0.6 && Math.abs(a.y - a.chair[1]) < 0.6

  if (working || offline) {
    if (!atChair && !a.path.length) a.path = pathToChair(a)
  } else if (a.seated) {
    // освободился: встаёт и идёт гулять
    a.seated = false
    a.path = [[a.x, LANE_Y], wanderPoint()]
  }

  if (a.path.length) {
    const [tx, ty] = a.path[0]
    const dx = tx - a.x
    const dy = ty - a.y
    const dist = Math.hypot(dx, dy)
    const v = 0.38 * dt
    if (dist <= v) {
      a.x = tx; a.y = ty; a.path.shift()
    } else {
      a.x += (dx / dist) * v
      a.y += (dy / dist) * v
      a.pose = 'walk'
      a.face = Math.abs(dy) > Math.abs(dx) && dy < 0 ? 'up' : 'down'
    }
    return
  }

  if (working || offline) {
    if (atChair) { a.seated = true; a.pose = offline ? 'sleep' : 'sit'; a.face = 'up' }
    return
  }
  // гуляет
  a.pose = 'stand'
  a.face = 'down'
  a.wait -= dt
  if (a.wait <= 0) {
    a.path = [wanderPoint()]
    a.wait = 90 + Math.random() * 260
  }
}

let last = performance.now()
let tick = 0
function frame(now) {
  const dt = Math.min(3, (now - last) / 16.7)
  last = now
  tick += dt
  for (const a of AGENTS) step(a, dt)
  ctx.clearRect(0, 0, cv.width, cv.height)
  drawOffice(tick)
  for (const a of AGENTS) drawDesk(a, tick)
  const order = [...AGENTS].sort((p, q) => p.y - q.y)
  for (const a of order) drawPerson(a, tick)
  for (const a of AGENTS) {
    if (a.status === 'working' && a.seated) drawBubble(a, tick)
    if (a.status === 'offline' && a.seated) drawZ(a, tick)
  }
  requestAnimationFrame(frame)
}

// ---- Интерфейс ---------------------------------------------------------------
const $ = id => document.getElementById(id)
const rosterEl = $('roster')
const feedEl = $('feed')
const chipsEl = $('chips')
const inp = $('inp')
let selected = null

const STATUS_LABEL = { idle: 'свободен', working: 'работает', offline: 'не подключён' }

function renderRoster() {
  rosterEl.innerHTML = ''
  for (const a of AGENTS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'agent' + (selected === a.id ? ' sel' : '')
    b.setAttribute('role', 'listitem')
    b.innerHTML = `<span class="nm"><span class="dot ${a.status}"></span>${a.name}</span><span class="tk"></span>`
    b.querySelector('.tk').textContent = a.status === 'working' ? a.task || 'работает…' : STATUS_LABEL[a.status]
    b.addEventListener('click', () => select(a.id))
    rosterEl.appendChild(b)
  }
}

const GLOBAL_CHIPS = [['Найти тендеры', '/tenders'], ['Тендер №…', '/tender '], ['Цены на товар', '/price '], ['Помощь', '/help']]

function renderChips() {
  chipsEl.innerHTML = ''
  const a = selected ? byId[selected] : null
  const list = a ? (a.cmds.length ? a.cmds : []) : GLOBAL_CHIPS
  for (const [label, text] of list) {
    const c = document.createElement('button')
    c.type = 'button'; c.className = 'chip'; c.textContent = label
    c.addEventListener('click', () => {
      if (text.endsWith(' ')) { inp.value = text; inp.focus() } else send(text)
    })
    chipsEl.appendChild(c)
  }
}

function select(id) {
  selected = selected === id ? null : id
  renderRoster(); renderChips()
  if (selected) addLocal(byId[selected], `${STATUS_LABEL[byId[selected].status]}. ${byId[selected].hint}`)
}

cv.addEventListener('click', e => {
  const r = cv.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * W
  const y = ((e.clientY - r.top) / r.height) * H
  let best = null, bd = 14
  for (const a of AGENTS) {
    const d = Math.hypot(a.x + 4 - x, a.y + 6 - y)
    if (d < bd) { bd = d; best = a }
  }
  if (best) select(best.id)
})

function linkify(el, text) {
  const re = /(https?:\/\/[^\s)]+)/g
  let i = 0, m
  while ((m = re.exec(text))) {
    el.append(text.slice(i, m.index))
    const a = document.createElement('a')
    a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m[1]
    el.append(a)
    i = m.index + m[1].length
  }
  el.append(text.slice(i))
}

function addMsg(m) {
  const empty = feedEl.querySelector('.empty')
  if (empty) empty.remove()
  const near = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80
  const d = document.createElement('div')
  if (m.agent === 'user') {
    d.className = 'msg user'
    d.textContent = m.text
  } else {
    d.className = 'msg'
    const ag = byId[m.agent]
    if (ag) d.style.borderLeftColor = ag.color
    const who = document.createElement('span')
    who.className = 'who'
    who.style.color = ag ? ag.color : '#8a97b3'
    who.textContent = ag ? ag.name : 'Система'
    d.appendChild(who)
    const body = document.createElement('span')
    linkify(body, m.text || '')
    d.appendChild(body)
    if (m.file) {
      const f = document.createElement('a')
      f.className = 'file'
      f.href = m.file.url + (key ? (m.file.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : '')
      f.target = '_blank'; f.rel = 'noopener'
      f.textContent = '📎 ' + (m.file.name || 'файл')
      d.appendChild(document.createElement('br'))
      d.appendChild(f)
    }
  }
  feedEl.appendChild(d)
  while (feedEl.children.length > 150) feedEl.firstChild.remove()
  if (near || m.agent === 'user') feedEl.scrollTop = feedEl.scrollHeight
}

function addLocal(agent, text) { addMsg({ agent: agent.id, text }) }

function setConn(text, cls) {
  const c = $('conn'); c.textContent = text; c.className = 'conn ' + (cls || '')
}

function emptyHint() {
  const d = document.createElement('div')
  d.className = 'empty'
  d.textContent = 'Здесь появятся результаты работы сотрудников. Нажмите на персонажа или на кнопку ниже.'
  feedEl.appendChild(d)
}

// ---- Связь с сервером ---------------------------------------------------------
let lastId = 0
let polling = false
let failures = 0

function applyState(st) {
  let changed = false
  for (const [id, s] of Object.entries(st.agents || {})) {
    const a = byId[id]
    if (!a) continue
    if (a.status !== s.status || a.task !== (s.task || '')) { a.status = s.status; a.task = s.task || ''; changed = true }
  }
  if (changed) renderRoster()
  for (const m of st.feed || []) { addMsg(m); lastId = Math.max(lastId, m.id) }
  if (typeof st.lastId === 'number') lastId = Math.max(lastId, st.lastId)
}

async function api(path, opts) {
  const res = await fetch(API + path, { ...opts, headers: { 'x-app-key': encodeURIComponent(key), 'content-type': 'application/json' } })
  if (res.status === 401) throw Object.assign(new Error('auth'), { auth: true })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

async function poll() {
  if (demo || polling || document.hidden) return
  polling = true
  try {
    applyState(await api('/api/state?since=' + lastId))
    failures = 0
    setConn('● на связи', 'ok')
  } catch (e) {
    if (e.auth) { showLogin('Неверный ключ доступа'); return }
    failures++
    setConn(failures > 1 ? '● нет связи' : '…', 'bad')
  } finally {
    polling = false
  }
}

async function send(text) {
  text = String(text || '').trim()
  if (!text) return
  if (demo) return demoCommand(text)
  // Команду в ленту добавит сервер (придёт при ближайшем опросе), чтобы она не задваивалась.
  try {
    await api('/api/command', { method: 'POST', body: JSON.stringify({ text }) })
    poll()
  } catch (e) {
    if (e.auth) return showLogin('Неверный ключ доступа')
    addMsg({ agent: 'system', text: 'Не удалось отправить команду: нет связи с сервером.' })
  }
}

$('form').addEventListener('submit', e => {
  e.preventDefault()
  const t = inp.value
  inp.value = ''
  send(t)
})

// ---- Вход ---------------------------------------------------------------------
function showLogin(err) {
  $('login').classList.remove('hidden')
  $('loginErr').textContent = err || ''
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault()
  key = $('keyInp').value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  try {
    applyState(await api('/api/state?since=0'))
    try { localStorage.setItem('officeKey', key) } catch (x) { /* ничего */ }
    $('login').classList.add('hidden')
    setConn('● на связи', 'ok')
  } catch (x) {
    $('loginErr').textContent = x.auth ? 'Неверный ключ доступа' : `Не удалось подключиться (${x.message || 'ошибка'}). Проверьте адрес http://… и ключ.`
  }
})
$('demoBtn').addEventListener('click', () => { demo = true; $('login').classList.add('hidden'); startDemo() })

// ---- Демо (без сервера) ---------------------------------------------------------
function setStatus(id, status, task) {
  const a = byId[id]
  a.status = status; a.task = task || ''
  renderRoster()
}
function demoWork(id, task, ms, then) {
  setStatus(id, 'working', task)
  setTimeout(() => { setStatus(id, 'idle'); then && then() }, ms)
}
function demoCommand(text) {
  addMsg({ agent: 'user', text })
  const reply = (agent, t) => addMsg({ agent, text: t })
  if (text.startsWith('/tenders') || /тендер/i.test(text) && !/\d{5}/.test(text)) {
    demoWork('tenders', 'Ищу закупки…', 5000, () =>
      reply('tenders', 'Найдено закупок: 3 (демо)\n1. Насосы 2065\n№1275177 · 260 445 тг\n2. Кабель силовой\n№1274647 · 4 457 900 тг'))
  } else if (text.startsWith('/tender')) {
    demoWork('specs', 'Читаю №1275177', 4500, () => {
      reply('specs', '📦 №1275177 · Насосы 2065\nТОЧНЫЙ ТОВАР: Насос ручной гидравлический 2л\nКоличество: 1 шт. · 129 752 тг')
      demoWork('prices', 'Ищу цены', 4000, () =>
        reply('prices', '💰 Цены Satu.kz: мин 90 635 · медиана 118 145 тг\n📊 Маржа по минимуму: +27% (демо)'))
    })
  } else if (text.startsWith('/price')) {
    demoWork('prices', 'Ищу цены', 4500, () => reply('prices', '💰 Цены Satu.kz (демо): мин 56 340 · медиана 153 192 тг'))
  } else if (text.startsWith('/help')) {
    reply('assistant', 'Команды: /tenders, /tender 1275177, /price товар | цена заказчика (демо)')
  } else {
    demoWork('assistant', 'Думаю…', 3000, () => reply('assistant', 'Это демо: настоящий ответ придёт, когда приложение подключено к серверу.'))
  }
}
function startDemo() {
  setConn('● демо', '')
  addMsg({ agent: 'system', text: 'Демо-режим: данные не настоящие. Попробуйте команду «Найти тендеры» или нажмите на персонажа.' })
  const loop = () => {
    const idle = AGENTS.filter(a => a.status === 'idle')
    if (idle.length && Math.random() < 0.6) {
      const a = idle[Math.floor(Math.random() * idle.length)]
      const tasks = { tenders: 'Ищу закупки…', specs: 'Читаю PDF', prices: 'Сверяю цены', assistant: 'Думаю…' }
      if (tasks[a.id]) demoWork(a.id, tasks[a.id], 5000 + Math.random() * 5000)
    }
    setTimeout(loop, 7000 + Math.random() * 5000)
  }
  setTimeout(loop, 1500)
}

// ---- Запуск -------------------------------------------------------------------
function clock() {
  const d = new Date()
  $('clock').textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
clock(); setInterval(clock, 30000)

renderRoster(); renderChips(); emptyHint()
requestAnimationFrame(frame)

if (demo) {
  startDemo()
} else if (!key) {
  showLogin('')
} else {
  poll()
}
setInterval(poll, 2500)
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll() })
