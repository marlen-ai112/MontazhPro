<script setup>
const GREETING = 'Здравствуйте! Я помощник МонтажПро. Расскажу об услугах и помогу оставить заявку.'

const isOpen = ref(false)
const input = ref('')
const loading = ref(false)
const error = ref('')
const messages = ref([{ role: 'assistant', content: GREETING }])
const listEl = ref(null)

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  error.value = ''
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  scrollToBottom()

  try {
    // Отправляем только роли и текст, без служебных полей.
    const history = messages.value
      .filter((m, i) => !(i === 0 && m.role === 'assistant'))
      .map(({ role, content }) => ({ role, content }))
    const data = await $fetch('/api/agent/chat', {
      method: 'POST',
      body: { messages: history },
    })
    messages.value.push({ role: 'assistant', content: data.reply })
  } catch (e) {
    error.value = 'Сервис временно недоступен. Позвоните нам: +7 964 292-02-80'
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="agent">
    <button
      class="agent__toggle"
      type="button"
      :aria-expanded="isOpen"
      aria-label="Открыть чат с помощником"
      @click="isOpen = !isOpen"
    >
      <span v-if="!isOpen">Задать вопрос</span>
      <span v-else>✕</span>
    </button>

    <section v-if="isOpen" class="agent__panel" aria-label="Чат с помощником">
      <header class="agent__header">Помощник МонтажПро</header>

      <div ref="listEl" class="agent__list">
        <div
          v-for="(m, i) in messages"
          :key="i"
          class="agent__msg"
          :class="m.role === 'user' ? 'agent__msg--user' : 'agent__msg--bot'"
        >
          {{ m.content }}
        </div>
        <div v-if="loading" class="agent__msg agent__msg--bot agent__msg--typing">Печатаю…</div>
        <div v-if="error" class="agent__error">{{ error }}</div>
      </div>

      <form class="agent__form" @submit.prevent="send">
        <textarea
          v-model="input"
          class="agent__input"
          rows="1"
          maxlength="2000"
          placeholder="Напишите вопрос…"
          :disabled="loading"
          @keydown="onKeydown"
        />
        <button class="agent__send" type="submit" :disabled="loading || !input.trim()">Отправить</button>
      </form>
    </section>
  </div>
</template>

<style scoped lang="scss">
.agent {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  font-family: inherit;

  &__toggle {
    background: var(--green);
    color: var(--white);
    border: none;
    border-radius: 999px;
    padding: 12px 20px;
    font-size: 16px;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    transition: transform 0.2s ease;

    &:hover {
      transform: scale(1.03);
    }
  }

  &__panel {
    position: absolute;
    right: 0;
    bottom: 60px;
    width: min(360px, calc(100vw - 32px));
    height: min(480px, 70vh);
    display: flex;
    flex-direction: column;
    background: var(--white);
    color: #1a1a1a;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  &__header {
    background: var(--darkGreen);
    color: var(--white);
    padding: 14px 16px;
    font-weight: 700;
  }

  &__list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__msg {
    max-width: 85%;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 15px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;

    &--user {
      align-self: flex-end;
      background: var(--green);
      color: var(--white);
    }

    &--bot {
      align-self: flex-start;
      background: #eef2f0;
    }

    &--typing {
      opacity: 0.6;
    }
  }

  &__error {
    color: #b00020;
    font-size: 14px;
  }

  &__form {
    display: flex;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid #e0e0e0;
  }

  &__input {
    flex: 1;
    resize: none;
    border: 1px solid #ccc;
    border-radius: 10px;
    padding: 8px 10px;
    font: inherit;
    font-size: 15px;
  }

  &__send {
    background: var(--green);
    color: var(--white);
    border: none;
    border-radius: 10px;
    padding: 0 14px;
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
}

@media (max-width: 480px) {
  .agent {
    right: 12px;
    bottom: 12px;
  }
}
</style>
