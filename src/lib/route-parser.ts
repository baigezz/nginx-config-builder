import type { LocationModifier, PathMode, ProxyRoute } from '../types/nginx'

function routeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizePath(value: string, modifier: LocationModifier = 'prefix') {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  if (modifier === 'exact' || withLeadingSlash === '/' || withLeadingSlash.endsWith('/')) {
    return withLeadingSlash
  }

  return `${withLeadingSlash}/`
}

export function createRoute(
  values: Partial<Omit<ProxyRoute, 'id'>> & Pick<ProxyRoute, 'path' | 'upstream'>,
): ProxyRoute {
  const modifier = values.locationModifier ?? 'prefix'

  return {
    id: routeId(),
    path: normalizePath(values.path, modifier),
    upstream: values.upstream.trim(),
    pathMode: values.pathMode ?? 'preserve',
    locationModifier: modifier,
    websocket: values.websocket ?? false,
    connectTimeout: values.connectTimeout ?? '',
    readTimeout: values.readTimeout ?? '',
    sendTimeout: values.sendTimeout ?? '',
    clientMaxBodySize: values.clientMaxBodySize ?? '',
    disableCache: values.disableCache ?? false,
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
    const [path, upstream, mode, websocket] = row.split(',').map((cell) => cell.trim())
    return createRoute({
      path,
      upstream: upstream || defaultUpstream,
      pathMode: mode === 'strip' || mode === 'strip-prefix' ? 'strip' : defaultMode,
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

    return createRoute({
      path: record.path,
      upstream: typeof record.upstream === 'string' ? record.upstream : defaultUpstream,
      pathMode:
        record.pathMode === 'strip' || record.pathMode === 'strip-prefix'
          ? 'strip'
          : defaultMode,
      locationModifier,
      websocket: record.websocket === true,
      connectTimeout: typeof record.connectTimeout === 'string' ? record.connectTimeout : '',
      readTimeout: typeof record.readTimeout === 'string' ? record.readTimeout : '',
      sendTimeout: typeof record.sendTimeout === 'string' ? record.sendTimeout : '',
      clientMaxBodySize:
        typeof record.clientMaxBodySize === 'string' ? record.clientMaxBodySize : '',
      disableCache: record.disableCache === true,
    })
  })
}
