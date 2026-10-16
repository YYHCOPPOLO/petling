export const APP_NAME = 'AgentPet'
export const UPSTREAM = 'https://github.com/AnkioTomas/qqpet'

// A fork must not offer the upstream's installers as its own upgrades.
// Configure this project's GitHub latest-release endpoint when a repository exists.
export const UPDATE_API = typeof __UPDATE_API__ === 'string' ? __UPDATE_API__ : ''
declare const __UPDATE_API__: string
