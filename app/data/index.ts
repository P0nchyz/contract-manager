// app/data/index.ts
// Public entry point for the data/boundary layer.
export * from './models'
export * from './errors'
export { createRepositories } from './repositories'
export type { Repositories, CreateRepositoriesOptions } from './repositories'
export type { HttpClient } from './http/client'
export { buildLineItem, buildSummary, DEFAULT_RATES } from './calc/estimate'
export type { EstimateRates, EstimateLineInput } from './calc/estimate'
