export type PathMode = 'preserve' | 'strip'

export type LocationModifier = 'prefix' | 'exact' | 'prefer-prefix'

export interface ProxyRoute {
  id: string
  path: string
  upstream: string
  pathMode: PathMode
  locationModifier: LocationModifier
  websocket: boolean
  connectTimeout: string
  readTimeout: string
  sendTimeout: string
  clientMaxBodySize: string
  disableCache: boolean
}

export type RouteSeed = Omit<ProxyRoute, 'id'>

export interface ServerConfig {
  domain: string
  port: string
}

export interface NginxPreset {
  id: string
  name: string
  description: string
  badge: string
  routes: RouteSeed[]
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info'
  message: string
}
