// app/composables/useRepositories.ts
import type { Repositories } from '~/data/repositories'

/** Typed accessor for the provided repository set. */
export function useRepositories(): Repositories {
  return useNuxtApp().$repos
}
