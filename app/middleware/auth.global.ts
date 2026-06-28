// app/middleware/auth.global.ts
import { can, type Permission } from '~/lib/permissions'

export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore()
  const isPublic = to.meta.public === true

  if (!auth.isAuthenticated) {
    return isPublic ? undefined : navigateTo('/login')
  }

  // Authenticated users shouldn't sit on the login page.
  if (to.path === '/login') return navigateTo('/')

  // Optional per-page permission gate.
  const required = to.meta.requiredPermission as Permission | undefined
  if (required && auth.user && !can(auth.user.role, required)) {
    return navigateTo('/')
  }
})
