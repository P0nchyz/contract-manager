// app/config/navigation.ts
import type { Permission } from '~/lib/permissions'
import { S } from '~/constants/strings'

export interface NavItem {
  label: string
  icon: string
  to: string
}
export interface Navigation {
  global: NavItem[]
  contract: NavItem[]
}

/**
 * Builds the sidebar navigation for the current user. Global items always show;
 * the contract section appears only when a contract is in scope (route param).
 */
export function buildNavigation(opts: {
  can: (p: Permission) => boolean
  contractId?: string
}): Navigation {
  const { can, contractId } = opts

  const global: NavItem[] = []
  if (can('estimate:view') || can('financial:view') || can('contract:manage') || can('contract:create')) {
    global.push({ label: S.nav.myContracts, icon: 'i-lucide-folder-open', to: '/' })
  }
  if (can('admin:users')) {
    global.push({ label: S.nav.users, icon: 'i-lucide-users', to: '/admin/users' })
  }

  const items: NavItem[] = []
  if (contractId) {
    const base = `/contracts/${contractId}`

    items.push({ label: S.nav.dashboard, icon: 'i-lucide-layout-dashboard', to: base })
    if (can('logNote:create')) {
      items.push({ label: S.nav.logbook, icon: 'i-lucide-notebook-pen', to: `${base}/logbook` })
    }

    if (can('estimate:view')) {
      items.push({ label: S.nav.estimates, icon: 'i-lucide-file-spreadsheet', to: `${base}/estimates` })
      items.push({ label: S.nav.progress, icon: 'i-lucide-chart-gantt', to: `${base}/progress` })
    }

    if (can('financial:view')) {
      items.push({ label: S.nav.financial, icon: 'i-lucide-banknote', to: `${base}/financial` })
    }

    if (can('estimate:view')) {
      items.push({ label: S.nav.evidence, icon: 'i-lucide-image', to: `${base}/evidence` })
      items.push({ label: S.nav.files,    icon: 'i-lucide-folder', to: `${base}/files` })
    }

    items.push({ label: S.nav.contract, icon: 'i-lucide-file-text', to: `${base}/contract` })
  }

  return { global, contract: items }
}