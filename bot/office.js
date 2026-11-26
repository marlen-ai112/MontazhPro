// Состояние «AI-офиса»: кто из сотрудников чем занят и лента командного пункта.
// Бот сообщает сюда о своей работе, приложение (office/) забирает это через bot/api.js.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FEED_FILE = path.join(ROOT, 'bot', '.state', 'feed.json')
const FEED_MAX = 200

export const agents = {
  tenders: { status: 'idle', task: '' },
  specs: { status: 'idle', task: '' },
  prices: { status: 'idle', task: '' },
  assistant: { status: 'idle', task: '' },
  video: { status: 'offline', task: '' }, // монтаж работает отдельным ботом (video-bot)
}
const busy = {}

let feed = []
let nextId = 1
try {
  feed = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8')).slice(-FEED_MAX)
  nextId = (feed.at(-1)?.id || 0) + 1
} catch {
  /* ленты ещё нет */
}

let saveTimer = null
function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FEED_FILE), { recursive: true })
      fs.writeFileSync(FEED_FILE, JSON.stringify(feed))
    } catch (e) {
      console.error('[office] не удалось сохранить ленту:', e.message)
    }
  }, 1000)
}

export function pushFeed(agent, text, file) {
  const item = { id: nextId++, ts: Date.now(), agent, text: String(text).slice(0, 4000) }
  if (file) item.file = file
  feed.push(item)
  if (feed.length > FEED_MAX) feed = feed.slice(-FEED_MAX)
  saveSoon()
  return item
}

export function getState(since = 0) {
  return {
    agents,
    feed: feed.filter(m => m.id > since),
    lastId: feed.at(-1)?.id || 0,
    now: Date.now(),
  }
}

// Помечает сотрудника занятым, пока выполняется promise. Несколько задач подряд считаются вместе.
export function track(agent, task, promise) {
  const a = agents[agent]
  if (!a) return promise
  busy[agent] = (busy[agent] || 0) + 1
  a.status = 'working'
  a.task = task
  const done = () => {
    busy[agent] = Math.max(0, (busy[agent] || 1) - 1)
    if (!busy[agent]) {
      a.status = 'idle'
      a.task = ''
    }
  }
  Promise.resolve(promise).then(done, done)
  return promise
}
