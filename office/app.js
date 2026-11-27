'use strict'
// AI-офис: пиксельный офис, в котором у каждой команды бота свой сотрудник.
// Когда сотрудник занят, он сидит за компьютером. Свободный гуляет по офису.
// Внизу командный пункт: сюда приходят все результаты, отсюда отдаются команды.

// ---- Размер мира ------------------------------------------------------------
// Два вида комнаты: «wide» для компьютера (широкий офис сверху, командный пункт снизу) и «tall» для телефона.
// S — во сколько пикселей экрана превращается один «пиксель мира»; подбирается под размер экрана, чтобы картинка была чёткой.
let W = 120
let H = 120
let S = 3
let MODE = 'tall'

const cv = document.getElementById('c')
const ctx = cv.getContext('2d')
ctx.imageSmoothingEnabled = false
const F = n => Math.round((n * S) / 3) // размер шрифта в пикселях холста

const params = new URLSearchParams(location.search)
const API = params.get('api') || ''
let demo = params.has('demo') || location.protocol === 'file:'
let key = ''
try { key = localStorage.getItem('officeKey') || '' } catch (e) { /* хранилище недоступно */ }

// ---- Сотрудники -----------------------------------------------------------
const AGENTS = [
  { id: 'tenders', name: 'Поиск тендеров', color: '#4da3ff', hair: '#3b2a1a', desk: 0, look: 'hunter',
    hint: 'Ищет закупки на zakup.sk.kz и goszakup.gov.kz: товар, запрос ценовых предложений, от 1,5 млн тг.',
    cmds: [['Найти тендеры', '/tenders']] },
  { id: 'specs', name: 'Спецификации', color: '#a77bff', hair: '#2a2230', desk: 1, look: 'scholar',
    hint: 'Читает карточку и PDF-спецификацию, определяет точный товар. Любой PDF можно загрузить кнопкой 📎: он скажет, какой товар нужен, какие требования, и найдёт цены.',
    cmds: [['Разобрать закупку', '/tender ']] },
  { id: 'prices', name: 'Цены и маржа', color: '#38c172', hair: '#b0561f', desk: 2, look: 'trader',
    hint: 'Ищет цены на Satu.kz и считает маржу. Формат: /price товар | цена заказчика',
    cmds: [['Цены на товар', '/price ']] },
  { id: 'assistant', name: 'ИИ-помощник', color: '#ffb340', hair: '#5a3b1c', desk: 3, look: 'robot',
    hint: 'Отвечает на вопросы свободным текстом (нужен ключ Anthropic).', cmds: [] },
  { id: 'video', name: 'Видеомонтаж', color: '#ff5e7a', hair: '#15151c', desk: 4, look: 'creator',
    hint: 'Монтирует рилс из вашего видео: режет паузы в речи, вертикальный кадр 9:16, резкая цветокоррекция, заголовок. Нажмите 📎, выберите видео. В строке ввода можно написать заголовок и «стиль: кино» (тёплый, чб, резкий), «без субтитров», «без нарезки».',
    cmds: [['Как монтировать', '/help']] },
]
const byId = Object.fromEntries(AGENTS.map(a => [a.id, a]))

// Столы: [x, y] верхнего левого угла. Проход (LANE_Y) идёт ниже столов, по нему сотрудники ходят к своим местам.
let DESKS = []
let LANE_Y = 86
const LAYOUT = {
  tall: { W: 120, H: 120, lane: 88, desks: [[6, 32], [46, 32], [86, 32], [26, 62], [66, 62]] },
  wide: { W: 280, H: 108, lane: 68, desks: [[20, 34], [72, 34], [124, 34], [176, 34], [228, 34]] },
}

function setupLayout(mode) {
  MODE = mode
  const L = LAYOUT[mode]
  W = L.W; H = L.H; LANE_Y = L.lane; DESKS = L.desks
  for (const a of AGENTS) {
    const [dx, dy] = DESKS[a.desk]
    a.chair = [dx + 10, dy + 11] // место за столом
    // после смены вида ставим всех в проход, дальше они сами идут по делам
    a.x = Math.min(W - 16, 14 + a.desk * Math.floor((W - 40) / 5))
    a.y = LANE_Y + 4 + (a.desk % 2) * 6
    a.path = []
    a.pose = 'stand'
    a.face = 'down'
    a.wait = 20 + Math.random() * 120
    a.seated = false
  }
}
for (const a of AGENTS) { a.status = 'idle'; a.task = '' } // реальный статус приходит с сервера

// Подбор вида и масштаба под экран.
function fit() {
  const mode = window.innerWidth >= 900 ? 'wide' : 'tall'
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssW = mode === 'wide' ? Math.min(window.innerWidth, 1800) : Math.min(window.innerWidth, 500)
  const target = Math.max(3, Math.min(8, Math.round((cssW * dpr) / LAYOUT[mode].W)))
  if (mode !== MODE || cv.width !== LAYOUT[mode].W * target) {
    if (mode !== MODE) setupLayout(mode)
    S = target
    cv.width = W * S
    cv.height = H * S
    ctx.imageSmoothingEnabled = false
    document.documentElement.style.setProperty('--ar', String(W / H))
  }
}
setupLayout('tall')
fit()
let resizeTimer = null
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 150) })

// ---- Рисование ------------------------------------------------------------
function px(x, y, w, h, c) {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x) * S, Math.round(y) * S, w * S, h * S)
}

function plant(x, y) { // x, y: верх горшка
  px(x, y, 6, 6, '#a0522d'); px(x, y, 6, 1, '#b8693c')
  px(x - 2, y - 10, 10, 10, '#2e8b57'); px(x, y - 14, 6, 6, '#3cb371'); px(x + 3, y - 7, 2, 7, '#256b45')
}

function drawOffice(t) {
  const wide = MODE === 'wide'
  // стена
  px(0, 0, W, 26, '#2a3a5c')
  px(0, 24, W, 2, '#1c2842')
  px(0, 0, W, 1, '#223052')
  // окна
  const windows = wide ? [14, 44, 74, 190, 220, 250] : [8, 52, 96]
  for (const wx of windows) {
    px(wx, 5, 16, 14, '#14203a')
    px(wx + 1, 6, 14, 12, '#6fb7ff')
    px(wx + 1, 6, 14, 4, '#9bd0ff')
    px(wx + 7, 6, 1, 12, '#14203a')
    px(wx + 1, 11, 14, 1, '#14203a')
    px(wx - 1, 19, 18, 1, '#e8eefc') // подоконник
  }
  // вывеска
  const sx = Math.round(W / 2) - 24
  px(sx, 3, 48, 10, '#0a0f18'); px(sx + 1, 4, 46, 8, '#16233d')
  ctx.fillStyle = '#7fe3ff'; ctx.font = `bold ${F(10)}px "SF Mono", Menlo, Consolas, monospace`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
  ctx.fillText('AI-ОФИС', (sx + 24) * S, 8.5 * S); ctx.textAlign = 'left'
  // пол: паркет
  for (let y = 26; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      const odd = ((x / 8) + ((y - 26) / 8)) % 2 === 0
      px(x, y, 8, 8, odd ? '#8a6a46' : '#7f6040')
      px(x, y, 8, 1, 'rgba(0,0,0,.12)')
    }
  }
  if (wide) {
    // ковёр, диван с журнальным столиком, кулер, принтер, растения
    px(100, 72, 80, 22, '#3d4f78'); px(101, 73, 78, 20, '#465c8c'); px(104, 76, 72, 14, '#3d4f78')
    px(8, 80, 26, 12, '#7b3f3f'); px(8, 80, 26, 4, '#9a5252'); px(10, 84, 22, 6, '#8a4747'); px(8, 84, 3, 8, '#6b3535'); px(31, 84, 3, 8, '#6b3535')
    px(40, 84, 14, 6, '#c99560'); px(40, 84, 14, 1, '#dcae7c'); px(43, 90, 2, 3, '#6f4a26'); px(50, 90, 2, 3, '#6f4a26')
    px(262, 78, 8, 14, '#cfd8e8'); px(263, 74, 6, 5, '#8fd0ff'); px(263, 74, 6, 1, '#bfe6ff'); px(264, 84, 4, 2, '#556')
    px(210, 80, 16, 8, '#dfe6f3'); px(212, 77, 12, 4, '#b8c4d8'); px(213, 83, 10, 2, '#556'); px(214, 78, 8, 1, '#fff')
    plant(272, 30); plant(2, 30)
  } else {
    px(30, 94, 60, 20, '#3d4f78'); px(31, 95, 58, 18, '#465c8c')
    px(3, 104, 22, 12, '#7b3f3f'); px(3, 104, 22, 4, '#9a5252'); px(5, 108, 18, 6, '#8a4747'); px(3, 108, 3, 8, '#6b3535'); px(22, 108, 3, 8, '#6b3535')
    px(104, 98, 8, 14, '#cfd8e8'); px(105, 94, 6, 5, '#8fd0ff'); px(105, 94, 6, 1, '#bfe6ff'); px(106, 104, 4, 2, '#556')
    plant(112, 28); plant(2, 28)
  }
}

function drawDesk(a, t) {
  const [x, y] = DESKS[a.desk]
  px(x, y, 28, 10, '#b27d45'); px(x, y, 28, 2, '#c99560'); px(x, y + 10, 28, 1, '#6f4a26')
  px(x + 1, y + 11, 2, 4, '#6f4a26'); px(x + 25, y + 11, 2, 4, '#6f4a26')
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
  px(x + 9, y + 5, 10, 3, '#dfe6f3')
  px(x + 23, y + 3, 3, 3, a.color) // кружка
}

// ---- Персонажи ------------------------------------------------------------------
// Размер спрайта 10×16. Образы: охотник за тендерами (шляпа, плащ, лупа), учёный (очки, халат, планшет),
// трейдер (костюм, галстук, портфель), робот (антенна, светящиеся глаза), видеограф (шапка, наушники, камера).
const LOOKS = {
  hunter: { skin: '#f2c28b', top: '#b8925a', top2: '#8f6f3f', pants: '#3a3f52', hat: '#6b4a2a' },
  scholar: { skin: '#f0c39a', top: '#f2f4f8', top2: '#a77bff', pants: '#44506b', hair: '#2a2230' },
  trader: { skin: '#f3c7a1', top: '#2f7d4f', top2: '#ffffff', pants: '#264d3a', hair: '#b0561f' },
  robot: { skin: '#c9d6e3', top: '#9fb4c9', top2: '#ffb340', pants: '#6f8399', hair: '#7d93aa' },
  creator: { skin: '#e8b88a', top: '#ff5e7a', top2: '#ffb3c1', pants: '#2c2c3a', hair: '#2a2a38' },
}

function drawPerson(a, t) {
  const L = LOOKS[a.look]
  const x = Math.round(a.x)
  const y = Math.round(a.y)
  const R = (dx, dy, w, h, c) => px(x + dx, y + dy, w, h, c)
  const f = Math.floor(t / 8) % 2
  const bob = a.pose === 'stand' && Math.floor(t / 40) % 2 === 0 ? 1 : 0 // лёгкое покачивание в покое
  const blink = Math.floor(t / 25) % 2 === 0
  const sit = a.pose === 'sit'
  const sleeping = a.pose === 'sleep'
  const robot = a.look === 'robot'
  if (!(sit || sleeping)) R(1, 15, 8, 1, 'rgba(0,0,0,.28)')

  // --- вид сзади: сидит за компьютером или спит ---
  if (sit || sleeping) {
    const hy = sleeping ? 3 : 0
    // тело
    R(1, 9, 8, 5, L.top)
    if (a.look === 'scholar') R(4, 9, 2, 5, L.top2)
    if (a.look === 'trader') R(4, 9, 2, 5, '#1f5a38')
    if (a.look === 'robot') { R(3, 10, 4, 3, L.top2); R(4, 11, 2, 1, blink ? '#fff4c2' : '#c98a2a') }
    // голова сзади
    if (robot) {
      R(1, 2 + hy, 8, 7, '#b0c2d4'); R(1, 2 + hy, 8, 1, '#8ea3b8'); R(3, 5 + hy, 4, 2, '#8ea3b8')
      R(4, -1 + hy, 2, 3, '#7d93aa'); R(4, -2 + hy, 2, 2, blink ? '#ff5e7a' : '#7a2f3d')
    } else {
      R(2, 3 + hy, 6, 6, L.hair || '#3b2a1a')
      R(3, 9 + hy, 4, 1, L.skin)
      if (a.look === 'hunter') { R(1, 2 + hy, 8, 2, L.hat); R(2, 0 + hy, 6, 3, L.hat); R(2, 2 + hy, 6, 1, '#3a2a14') }
      if (a.look === 'creator') { R(2, 1 + hy, 6, 3, '#2a2a38'); R(4, 0 + hy, 2, 1, '#ff5e7a'); R(1, 4 + hy, 1, 4, '#222'); R(8, 4 + hy, 1, 4, '#222'); R(1, 5 + hy, 1, 3, '#ff9bb0'); R(8, 5 + hy, 1, 3, '#ff9bb0') }
      if (a.look === 'scholar') { R(3, 2 + hy, 3, 1, L.hair); R(7, 3 + hy, 1, 2, L.hair) }
    }
    if (sleeping) return
    // руки печатают
    R(0, 9, 1, 4, L.top); R(9, 9, 1, 4, L.top)
    R(1 + f, 12, 2, 1, L.skin); R(7 - f, 12, 2, 1, L.skin)
    return
  }

  // --- вид спереди: стоит или идёт ---
  const sw = a.pose === 'walk' ? f : 0
  const yy = -bob // покачивание: персонаж на пиксель выше
  // ноги
  const legs = robot ? L.pants : L.pants
  R(2, 14 + yy, 2, 2 - sw, legs); R(6, 14 + yy, 2, 1 + sw, legs)
  R(2, 15 - sw + yy, 2, 1, '#15151c'); R(6, 14 + sw + yy, 2, 1, '#15151c')
  // тело
  R(1, 9 + yy, 8, 5, L.top)
  if (a.look === 'hunter') { R(4, 9 + yy, 2, 5, L.top2); R(1, 12 + yy, 8, 1, L.top2) }
  if (a.look === 'scholar') { R(4, 9 + yy, 2, 5, L.top2); R(2, 12 + yy, 1, 2, '#d8dde8') }
  if (a.look === 'trader') { R(4, 9 + yy, 2, 4, L.top2); R(4, 10 + yy, 2, 4, '#d33') }
  if (a.look === 'robot') { R(3, 10 + yy, 4, 3, L.top2); R(4, 11 + yy, 2, 1, blink ? '#fff4c2' : '#c98a2a') }
  if (a.look === 'creator') { R(3, 12 + yy, 4, 2, '#e04a67') }
  // руки
  R(0, 9 + sw + yy, 1, 4, L.top); R(9, 9 + (1 - sw) * (a.pose === 'walk' ? 1 : 0) + yy, 1, 4, L.top)
  R(0, 13 + sw + yy, 1, 1, robot ? '#7d93aa' : L.skin); R(9, 13 + yy, 1, 1, robot ? '#7d93aa' : L.skin)
  // голова
  if (a.face === 'up') {
    if (robot) { R(1, 2 + yy, 8, 7, '#b0c2d4'); R(4, -1 + yy, 2, 3, '#7d93aa'); R(4, -2 + yy, 2, 2, blink ? '#ff5e7a' : '#7a2f3d') }
    else R(2, 3 + yy, 6, 6, L.hair || '#3b2a1a')
  } else if (robot) {
    R(1, 2 + yy, 8, 7, '#c9d6e3'); R(1, 2 + yy, 8, 1, '#a8b8c8'); R(1, 8 + yy, 8, 1, '#a8b8c8')
    R(2, 4 + yy, 2, 2, '#38e8ff'); R(6, 4 + yy, 2, 2, '#38e8ff'); R(3, 7 + yy, 4, 1, '#7d93aa')
    R(4, -1 + yy, 2, 3, '#7d93aa'); R(4, -2 + yy, 2, 2, blink ? '#ff5e7a' : '#7a2f3d')
  } else {
    R(2, 3 + yy, 6, 6, L.skin)
    const look = Math.floor(t / 90) % 3 - 1 // взгляд по сторонам
    R(3 + (look > 0 ? 1 : 0), 6 + yy, 1, 1, '#222'); R(6 + (look > 0 ? 0 : look < 0 ? -1 : 0) , 6 + yy, 1, 1, '#222')
    R(4, 8 + yy, 2, 1, '#b5655a')
    if (a.look === 'hunter') { R(1, 2 + yy, 8, 2, L.hat); R(2, 0 + yy, 6, 3, L.hat); R(2, 2 + yy, 6, 1, '#3a2a14') }
    if (a.look === 'scholar') {
      R(2, 3 + yy, 6, 2, L.hair); R(3, 2 + yy, 3, 1, L.hair); R(2, 5 + yy, 1, 2, L.hair)
      R(2, 5 + yy, 3, 3, '#1a1a1a'); R(5, 5 + yy, 3, 3, '#1a1a1a'); R(3, 6 + yy, 1, 1, '#bfe8ff'); R(6, 6 + yy, 1, 1, '#bfe8ff')
    }
    if (a.look === 'trader') { R(2, 3 + yy, 6, 2, L.hair); R(2, 5 + yy, 1, 1, L.hair); R(6, 3 + yy, 2, 1, '#c96d2a') }
    if (a.look === 'creator') {
      R(2, 2 + yy, 6, 3, '#2a2a38'); R(4, 1 + yy, 2, 1, '#ff5e7a')
      R(1, 3 + yy, 8, 1, '#222'); R(1, 4 + yy, 1, 4, '#222'); R(8, 4 + yy, 1, 4, '#222'); R(0, 5 + yy, 2, 3, '#ff9bb0'); R(8, 5 + yy, 2, 3, '#ff9bb0')
    }
  }
  // предметы в руках
  if (a.pose !== 'sit') {
    if (a.look === 'hunter') { R(9, 8 + yy, 3, 1, '#8fd8ff'); R(9, 10 + yy, 3, 1, '#8fd8ff'); R(9, 9 + yy, 1, 1, '#8fd8ff'); R(11, 9 + yy, 1, 1, '#8fd8ff'); R(8, 11 + yy, 1, 2, '#6b4a2a') }
    if (a.look === 'scholar') { R(-3, 10 + yy, 4, 5, '#b8863b'); R(-2, 11 + yy, 2, 3, '#ffffff'); R(-2, 11 + yy, 2, 1, '#c9d6e3') }
    if (a.look === 'trader') { R(8, 13 + yy, 4, 3, '#6b4a2a'); R(9, 12 + yy, 2, 1, '#3b2a14'); R(10, 14 + yy, 1, 1, '#ffd34d') }
    if (a.look === 'creator') { R(8, 9 + yy, 4, 3, '#1b1b24'); R(11, 10 + yy, 1, 1, '#8fd8ff'); if (blink) R(8, 9 + yy, 1, 1, '#ff3b3b') }
  }
}

function drawBubble(a, t) {
  const text = a.task ? a.task : '…'
  const label = text.length > 16 ? text.slice(0, 15) + '…' : text
  ctx.font = `${F(10)}px "SF Mono", Menlo, Consolas, monospace`
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
  ctx.font = `bold ${F(10)}px sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('z', (a.x + 10) * S, (a.y + 2 - k * 2) * S)
  ctx.fillText('Z', (a.x + 13) * S, (a.y - 3 - k * 2) * S)
}

// ---- Поведение ------------------------------------------------------------
function pathToChair(a) {
  const pts = []
  if (a.y < LANE_Y - 4) pts.push([a.x, LANE_Y]) // сначала вниз в проход
  pts.push([a.chair[0], LANE_Y])
  pts.push([a.chair[0], a.chair[1]])
  return pts
}

function wanderPoint() {
  const top = LANE_Y + 2
  return [8 + Math.random() * (W - 28), top + Math.random() * Math.max(2, H - 17 - top)]
}

function step(a, dt) {
  const working = a.status === 'working'
  const offline = a.status === 'offline'
  const atChair = Math.abs(a.x - a.chair[0]) < 0.6 && Math.abs(a.y - a.chair[1]) < 0.6

  if (working || offline) {
    if (!atChair && !a.path.length) a.path = pathToChair(a)
  } else if (a.seated) {
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

const STATUS_LABEL = { idle: 'свободен', working: 'работает', offline: 'не подключён (нет ffmpeg)' }

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
    if (m.file && /\.mp4$/i.test(m.file.url)) {
      const src = m.file.url + (key ? (m.file.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : '')
      const v = document.createElement('video')
      v.src = src; v.controls = true; v.playsInline = true; v.preload = 'metadata'
      d.appendChild(v)
    }
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
let needLogin = false // пока окно входа открыто, сервер не опрашиваем

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
  if (demo || polling || document.hidden || needLogin || !key) return
  polling = true
  try {
    applyState(await api('/api/state?since=' + lastId))
    failures = 0
    setConn('● на связи', 'ok')
  } catch (e) {
    if (e.auth) { try { localStorage.removeItem('officeKey') } catch (x) { /* ничего */ } key = ''; showLogin('Ключ не подошёл, введите его снова'); return }
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

// ---- Загрузка видео на монтаж (кнопка 📎) ------------------------------------------------
const fileInp = $('file')
$('attach').addEventListener('click', () => fileInp.click())
fileInp.addEventListener('change', () => {
  const f = fileInp.files && fileInp.files[0]
  fileInp.value = ''
  if (!f) return
  const caption = inp.value.trim()
  inp.value = ''
  if (demo) return demoVideo(f, caption)
  const note = document.createElement('div')
  note.className = 'msg'
  note.style.borderLeftColor = byId.video.color
  note.innerHTML = '<span class="who"></span><span class="t"></span><span class="bar"><i></i></span>'
  note.querySelector('.who').style.color = byId.video.color
  note.querySelector('.who').textContent = byId.video.name
  note.querySelector('.t').textContent = `Загружаю «${f.name}» (${(f.size / 1048576).toFixed(1)} МБ)…`
  if (/\.pdf$/i.test(f.name)) { note.querySelector('.who').textContent = byId.specs.name; note.style.borderLeftColor = byId.specs.color; note.querySelector('.who').style.color = byId.specs.color }
  const empty = feedEl.querySelector('.empty'); if (empty) empty.remove()
  feedEl.appendChild(note); feedEl.scrollTop = feedEl.scrollHeight
  const xhr = new XMLHttpRequest()
  xhr.open('POST', API + `/api/upload?name=${encodeURIComponent(f.name)}&caption=${encodeURIComponent(caption)}`)
  xhr.setRequestHeader('x-app-key', encodeURIComponent(key))
  xhr.upload.onprogress = e => { if (e.lengthComputable) note.querySelector('.bar i').style.width = Math.round((e.loaded / e.total) * 100) + '%' }
  xhr.onload = () => {
    note.remove()
    if (xhr.status === 401) return showLogin('Неверный ключ доступа')
    if (xhr.status !== 200) {
      let msg = 'ошибка ' + xhr.status
      try { msg = JSON.parse(xhr.responseText).error || msg } catch (e) { /* ничего */ }
      return addMsg({ agent: 'system', text: 'Видео не загружено: ' + msg })
    }
    poll()
  }
  xhr.onerror = () => { note.remove(); addMsg({ agent: 'system', text: 'Видео не загружено: нет связи с сервером.' }) }
  xhr.send(f)
})

// ---- Вход ---------------------------------------------------------------------
function showLogin(err) {
  needLogin = true
  $('login').classList.remove('hidden')
  $('loginErr').textContent = err || ''
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault()
  key = $('keyInp').value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  try {
    applyState(await api('/api/state?since=0'))
    try { localStorage.setItem('officeKey', key) } catch (x) { /* ничего */ }
    needLogin = false
    $('login').classList.add('hidden')
    setConn('● на связи', 'ok')
  } catch (x) {
    $('loginErr').textContent = x.auth ? 'Неверный ключ доступа' : x.message === 'HTTP 429' ? 'Слишком много попыток входа. Подождите 10 минут или перезапустите бота на сервере.' : `Не удалось подключиться (${x.message || 'ошибка'}). Проверьте адрес http://… и ключ.`
  }
})
$('demoBtn').addEventListener('click', () => { demo = true; needLogin = false; $('login').classList.add('hidden'); startDemo() })

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
function demoVideo(f, caption) {
  addMsg({ agent: 'user', text: `🎬 Видео на монтаж: ${f.name}${caption ? '\n' + caption : ''}` })
  addMsg({ agent: 'video', text: 'Принял видео. Монтирую (демо)…' })
  demoWork('video', 'Монтирую рилс', 6000, () => addMsg({ agent: 'video', text: '✅ Рилс готов (демо): паузы вырезаны, 9:16, резкая цветокоррекция. В настоящем режиме здесь будет плеер с роликом.' }))
}
function startDemo() {
  setConn('● демо', '')
  addMsg({ agent: 'system', text: 'Демо-режим: данные не настоящие. Попробуйте команду «Найти тендеры» или нажмите на персонажа.' })
  const loop = () => {
    const idle = AGENTS.filter(a => a.status === 'idle')
    if (idle.length && Math.random() < 0.6) {
      const a = idle[Math.floor(Math.random() * idle.length)]
      const tasks = { tenders: 'Ищу закупки…', specs: 'Читаю PDF', prices: 'Сверяю цены', assistant: 'Думаю…', video: 'Монтирую рилс' }
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
