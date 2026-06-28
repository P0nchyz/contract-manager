<!-- SETUP.md -->
# Contract Manager — frontend setup

Nuxt 4 (SPA) + Nuxt UI v4 + Pinia + Zod + VueUse. The app talks to the backend
only through `app/data` (the boundary layer); everything else depends on the
repository interfaces, never on the API shape.

## First-time setup (needs network)

These files assume a standard Nuxt 4 project. From an empty folder:

```bash
# 1. scaffold a Nuxt app (creates package.json, tsconfig, .nuxt, etc.)
npx nuxi@latest init .

# 2. install runtime deps
npm install @nuxt/ui @pinia/nuxt pinia @vueuse/nuxt @vueuse/core zod chart.js vue-chartjs

# 3. copy the provided files into place, overwriting where needed:
#    - nuxt.config.ts, package.json        -> project root
#    - app/                                 -> app/ (data, lib, utils, stores,
#                                              plugins, composables, middleware,
#                                              layouts, pages, config, constants,
#                                              types, assets, app.vue, app.config.ts)

# 4. run
npm run dev
```

`nuxi init` may pin different dependency versions — that's fine; the provided
`package.json` lists indicative ranges. Run the install command to resolve the
current compatible versions.

## The data-source switch

`nuxt.config.ts` -> `runtimeConfig.public.dataSource`:

- `'mock'` (default): the app runs entirely on `app/data/mock/seed.ts`. Log in
  with any password using one of the seed usernames:
  `admin`, `rresidente`, `ssuper`, `ssupervisor`, `ffinanzas`.
- `'http'`: uses the real REST client. Set `apiBaseUrl` and fill in the mappers
  (see `app/data/repositories/http/` TODOs).

Override at runtime without editing the file:

```bash
NUXT_PUBLIC_DATA_SOURCE=http NUXT_PUBLIC_API_BASE_URL=https://api.example.mx npm run dev
```

## What's in the shell

- **Auth**: `app/stores/auth.ts` (token in memory + persisted for reload),
  `app/plugins/auth.ts` (hydrate), `app/middleware/auth.global.ts` (guard).
- **Repositories**: `app/plugins/repositories.ts` provides `$repos`; use
  `useRepositories()` in components.
- **Permissions**: `app/lib/permissions.ts` (matrix) + `usePermissions()` +
  per-page `definePageMeta({ requiredPermission })`.
- **Layout**: `app/layouts/default.vue` (Nuxt UI dashboard sidebar shell),
  `app/layouts/auth.vue` (centered, for login).
- **Spanish/format**: `app/constants/strings.ts`, `app/utils/format.ts`
  (es-MX, MXN from integer cents, status/role display).
