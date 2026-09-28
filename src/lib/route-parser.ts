import type {
  LocationModifier,
  NginxServer,
  PathMode,
  ProxyRoute,
  ServerConfig,
} from '../types/nginx'

export function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export function createRoute(
  values: Partial<Omit<ProxyRoute, 'id'>> & Pick<ProxyRoute, 'path' | 'upstream'>,
): ProxyRoute {
  const pathMode = values.pathMode ?? 'preserve'
  return {
    id: createId('route'),
    path: normalizePath(values.path),
    upstream: values.upstream.trim().replace(/\/+$/, ''),
    pathMode,
    proxyPassUri:
      values.proxyPassUri !== undefined
        ? values.proxyPassUri.trim()
        : pathMode === 'strip'
          ? '/'
          : '',
    locationModifier: values.locationModifier ?? 'prefix',
    websocket: values.websocket ?? false,
    connectTimeout: values.connectTimeout ?? '',
    readTimeout: values.readTimeout ?? '',
    sendTimeout: values.sendTimeout ?? '',
    clientMaxBodySize: values.clientMaxBodySize ?? '',
    disableCache: values.disableCache ?? false,
    rawDirectives: values.rawDirectives ?? [],
  }
}

export function createServer(
  values: Partial<ServerConfig> & Pick<ServerConfig, 'domain' | 'port'>,
  routes: ProxyRoute[] = [],
): NginxServer {
  return {
    id: createId('server'),
    domain: values.domain.trim() || 'example.com',
    port: values.port.trim() || '80',
    sslEnabled: values.sslEnabled ?? false,
    sslCertificate: values.sslCertificate ?? '',
    sslCertificateKey: values.sslCertificateKey ?? '',
    rawDirectives: values.rawDirectives ?? [],
    rawBlocks: values.rawBlocks ?? [],
    routes,
  }
}

export function parseBulkRoutes(
  input: string,
  defaultUpstream: string,
  pathMode: PathMode,
): ProxyRoute[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const matched = line.match(/^(\S+)\s*(?:->|\s)\s*(https?:\/\/\S+)$/)
      return createRoute({
        path: matched?.[1] ?? line,
        upstream: matched?.[2] ?? defaultUpstream,
        pathMode,
      })
    })
}

export function parseCsv(
  text: string,
  defaultUpstream: string,
  defaultMode: PathMode,
): ProxyRoute[] {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!rows.length) return []

  const header = rows[0].toLowerCase()
  const start = header.includes('path') && header.includes('upstream') ? 1 : 0

  return rows.slice(start).map((row) => {
    const [path, upstream, mode, websocket, proxyPassUri] = row
      .split(',')
      .map((cell) => cell.trim())
    const parsedMode: PathMode =
      mode === 'strip' || mode === 'strip-prefix'
        ? 'strip'
        : mode === 'custom'
          ? 'custom'
          : defaultMode

    return createRoute({
      path,
      upstream: upstream || defaultUpstream,
      pathMode: parsedMode,
      proxyPassUri: proxyPassUri || undefined,
      websocket: websocket === 'true',
    })
  })
}

export function parseJson(
  text: string,
  defaultUpstream: string,
  defaultMode: PathMode,
): ProxyRoute[] {
  const value = JSON.parse(text) as unknown
  if (!Array.isArray(value)) throw new Error('JSON 顶层必须是数组')

  return value.map((item) => {
    if (typeof item === 'string') {
      return createRoute({ path: item, upstream: defaultUpstream, pathMode: defaultMode })
    }

    if (!item || typeof item !== 'object') {
      throw new Error('JSON 每一项必须是字符串或对象')
    }

    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || !record.path) {
      throw new Error('JSON 对象缺少 path')
    }

    const locationModifier: LocationModifier =
      record.locationModifier === 'exact' || record.locationModifier === 'prefer-prefix'
        ? record.locationModifier
        : 'prefix'

    const parsedMode: PathMode =
      record.pathMode === 'strip' || record.pathMode === 'strip-prefix'
        ? 'strip'
        : record.pathMode === 'custom'
          ? 'custom'
          : defaultMode

    return createRoute({
      path: record.path,
      upstream: typeof record.upstream === 'string' ? record.upstream : defaultUpstream,
      pathMode: parsedMode,
      proxyPassUri: typeof record.proxyPassUri === 'string' ? record.proxyPassUri : undefined,
      locationModifier,
      websocket: record.websocket === true,
      connectTimeout: typeof record.connectTimeout === 'string' ? record.connectTimeout : '',
      readTimeout: typeof record.readTimeout === 'string' ? record.readTimeout : '',
      sendTimeout: typeof record.sendTimeout === 'string' ? record.sendTimeout : '',
      clientMaxBodySize:
        typeof record.clientMaxBodySize === 'string' ? record.clientMaxBodySize : '',
      disableCache: record.disableCache === true,
      rawDirectives: Array.isArray(record.rawDirectives)
        ? record.rawDirectives.filter((item): item is string => typeof item === 'string')
        : [],
    })
  })
}
