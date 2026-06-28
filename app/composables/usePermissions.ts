// app/composables/usePermissions.ts
import { can as canRole, type Permission } from '~/lib/permissions'

/** UI permission checks for the current user. Backend stays authoritative. */
export function usePermissions() {
  const auth = useAuthStore()
  const can = (permission: Permission): boolean =>
    auth.user ? canRole(auth.user.role, permission) : false
  const role = computed(() => auth.user?.role ?? null)
  return { can, role }
}
