// nuxt.config.ts
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-06-01',
  ssr: false, // SPA — internal tool talking to a separate REST API
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@pinia/nuxt', '@vueuse/nuxt'],
  css: ['~/assets/css/main.css'],

  // Light mode only — disabling the color-mode integration keeps everything light.
  ui: { colorMode: false },

  runtimeConfig: {
    public: {
      // Flip to 'http' once the backend is ready. This is the ONLY switch.
      dataSource: 'mock', // 'mock' | 'http'
      apiBaseUrl: '/api',
    },
  },

  typescript: { strict: true, typeCheck: false },
})
