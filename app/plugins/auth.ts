// app/plugins/auth.ts
// Restore the persisted session before the first route guard runs.
export default defineNuxtPlugin({
  name: 'auth-hydrate',
  enforce: 'pre',
  setup(nuxtApp) {
		nuxtApp.hook('app:created', () => {
			useAuthStore().hydrate();
		})
  },
})
