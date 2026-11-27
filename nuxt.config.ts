// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',
  css: ["~/assets/style/main.css"],
  devtools: { enabled: false },
  ssr: true,
  // Серверные секреты: значения берутся из переменных окружения NUXT_ANTHROPIC_API_KEY и NUXT_AGENT_MODEL
  runtimeConfig: {
    anthropicApiKey: '',
    agentModel: 'claude-sonnet-5-5',
  },
  app: {
    head: {
      link: [
        {
          rel: "icon",
          type: "image/x-icon",
          href: "/UI/logo.svg",
        },
      ],
    },
  },
})
