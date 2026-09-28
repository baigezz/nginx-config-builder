export type PathMode = 'preserve' | 'strip' | 'custom'

export type LocationModifier = 'prefix' | 'exact' | 'prefer-prefix'

export interface ProxyRoute {
  id: string
  path: string
  upstream: string
  pathMode: PathMode
  proxyPassUri: string
  locationModifier: LocationModifier
  websocket: boolean
  connectTimeout: string
  readTimeout: string
  sendTimeout: string
  clientMaxBodySize: string
  disableCache: boolean
  rawDirectives: string[]
}

export type RouteSeed = Omit<ProxyRoute, 'id'>

export interface ServerConfig {
  domain: string
  port: string
  sslEnabled: boolean
  sslCertificate: string
  sslCertificateKey: string
  rawDirectives: string[]
  rawBlocks: string[]
}

export interface NginxServer extends ServerConfig {
  id: string
  routes: ProxyRoute[]
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
