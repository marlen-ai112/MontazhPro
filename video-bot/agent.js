// Мозги монтажёра: Claude составляет структурный план монтажа по клипам, референсу и задаче.
// Общий модуль для Telegram-бота (index.js) и HTTP-сервиса для n8n (server.js).
import fs from 'node:fs'
import { TRANSITIONS, COLORS } from './render.js'

const KEY = () => process.env.ANTHROPIC_API_KEY
const MODEL = () => process.env.AGENT_MODEL || 'claude-sonnet-5-5'
const API = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')

export const PLAN_TOOL = {
  name: 'create_edit_plan',
  description: 'Создаёт план монтажа из загруженных клипов.',
  input_schema: {
    type: 'object',
    properties: {
      orientation: { type: 'string', enum: ['vertical', 'horizontal', 'square'] },
      segments: {
        type: 'array',
        description: 'Фрагменты в порядке показа.',
        items: {
          type: 'object',
          properties: {
            clip: { type: 'integer', description: 'Номер клипа из списка (с нуля)' },
            start: { type: 'number', description: 'Начало фрагмента в клипе, сек (для фото 0)' },
            duration: { type: 'number', description: 'Длительность фрагмента, сек' },
          },
          required: ['clip', 'start', 'duration'],
        },
      },
      transition: { type: 'string', enum: TRANSITIONS },
      transition_duration: { type: 'number', description: 'Длительность перехода, 0.2–1.5 сек' },
      color: { type: 'string', enum: Object.keys(COLORS) },
      audio: { type: 'string', enum: ['keep', 'mute'] },
      subtitles: {
        type: 'boolean',
        description: 'true, если пользователь просит субтитры по речи (бот распознает речь и добавит текст). Требует audio=keep.',
      },
      captions: {
        type: 'array',
        description: 'Подписи; время в итоговом видео.',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
          required: ['text', 'start', 'end'],
        },
      },
      summary: { type: 'string', description: 'Короткое описание монтажа для пользователя, по-русски.' },
    },
    required: ['orientation', 'segments', 'transition', 'color', 'audio', 'captions', 'summary'],
  },
}

const SYSTEM_PROMPT = `Ты видеомонтажёр. По списку клипов, кадрам из них и (если есть) анализу референса составь план монтажа через инструмент create_edit_plan.

Правила:
- Используй только клипы из списка и только внутри их длительности. Не выдумывай клипы.
- Если есть референс, повторяй его темп (длину планов, формат, настроение, стиль подписей и цвет). Если референса нет, ориентируйся на задачу пользователя.
- Формат (orientation) выбирай по референсу или задаче. Для Reels, TikTok, Shorts, Stories это vertical.
- Общая длительность по умолчанию 15–30 секунд, если пользователь не назвал другую. Не больше 60.
- subtitles=true ставь только если пользователь просит субтитры, текст речи или «озвучку текстом». Тогда оставь audio=keep и выбирай фрагменты, где есть речь. Обычные подписи (captions) при этом ставь только если их просили отдельно.
- Подписи короткие (до 6 слов), на русском, время указывай по итоговому видео. Не добавляй подписи, если их не просили и референс без текста.
- Если пользователь просит правку к прошлому монтажу, возьми прошлый план за основу и измени только нужное.
- В summary по-русски в 1–2 предложениях опиши, что сделано.`

// ---- Claude: план монтажа -------------------------------------------------
const b64 = file => fs.readFileSync(file).toString('base64')
const imageBlock = file => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(file) } })

export async function planEdit(session, instruction) {
  const content = []
  content.push({ type: 'text', text: `Задача пользователя: ${instruction}` })

  if (session.reference) {
    content.push({ type: 'text', text: session.reference.text + '\nКадры референса:' })
    for (const f of session.reference.frames) {
      content.push({ type: 'text', text: `Референс, ${f.time.toFixed(1)} с:` }, imageBlock(f.file))
    }
  } else {
    content.push({ type: 'text', text: 'Референса нет.' })
  }

  content.push({ type: 'text', text: 'Загруженные клипы:' })
  for (const [i, c] of session.clips.entries()) {
    const kind = c.type === 'image' ? 'фото' : `видео ${c.duration.toFixed(1)} с, звук: ${c.hasAudio ? 'есть' : 'нет'}`
    content.push({ type: 'text', text: `Клип ${i}: ${kind}, ${c.width}x${c.height}` })
    for (const t of c.thumbs) {
      content.push({ type: 'text', text: c.type === 'image' ? `Клип ${i}:` : `Клип ${i}, ${t.time.toFixed(1)} с:` }, imageBlock(t.file))
    }
  }

  if (session.lastPlan) {
    content.push({ type: 'text', text: `Прошлый план монтажа (для правок):\n${JSON.stringify(session.lastPlan)}` })
  }

  const res = await fetch(`${API()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: PLAN_TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const block = data.content.find(b => b.type === 'tool_use')
  if (!block) throw new Error('Claude не вернул план монтажа')
  return block.input
}
