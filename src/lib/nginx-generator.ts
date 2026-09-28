import type { ProxyRoute, ServerConfig } from '../types/nginx'

function locationPrefix(route: ProxyRoute) {
  if (route.locationModifier === 'exact') return 'location ='
  if (route.locationModifier === 'prefer-prefix') return 'location ^~'
  return 'location'
}

export function generateLocation(route: ProxyRoute) {
  const upstream = route.upstream.replace(/\/+$/, '')
  const proxyPass = route.pathMode === 'strip' ? `${upstream}/` : upstream
  const advanced: string[] = []

  if (route.websocket) {
    advanced.push(
      '    proxy_http_version 1.1;',
      '    proxy_set_header Upgrade $http_upgrade;',
      '    proxy_set_header Connection "upgrade";',
    )
  }

  if (route.connectTimeout) advanced.push(`    proxy_connect_timeout ${route.connectTimeout};`)
  if (route.readTimeout) advanced.push(`    proxy_read_timeout ${route.readTimeout};`)
  if (route.sendTimeout) advanced.push(`    proxy_send_timeout ${route.sendTimeout};`)
  if (route.clientMaxBodySize) {
    advanced.push(`    client_max_body_size ${route.clientMaxBodySize};`)
  }
  if (route.disableCache) advanced.push('    proxy_cache off;')

  const advancedBlock = advanced.length ? `\n${advanced.join('\n')}` : ''

  return `${locationPrefix(route)} ${route.path} {
    proxy_pass ${proxyPass};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;${advancedBlock}
  }`
}

export function generateNginxConfig(server: ServerConfig, routes: ProxyRoute[]) {
  const locations = routes.map(generateLocation).join('\n\n  ')
  return `server {
  listen ${server.port};
  server_name ${server.domain};

  ${locations}
}`
}

export interface RequestSimulation {
  matchedRoute: ProxyRoute | null
  upstreamUrl: string
}

export function simulateRequest(
  requestPath: string,
  routes: ProxyRoute[],
): RequestSimulation {
  const normalized = requestPath.startsWith('/') ? requestPath : `/${requestPath}`

  const exact = routes.find(
    (route) => route.locationModifier === 'exact' && route.path === normalized,
  )

  const prefixes = routes
    .filter(
      (route) =>
        route.locationModifier !== 'exact' &&
        (normalized === route.path || normalized.startsWith(route.path)),
    )
    .sort((a, b) => b.path.length - a.path.length)

  const matchedRoute = exact ?? prefixes[0] ?? null
  if (!matchedRoute) return { matchedRoute: null, upstreamUrl: '' }

  const upstream = matchedRoute.upstream.replace(/\/+$/, '')
  if (matchedRoute.pathMode === 'preserve') {
    return { matchedRoute, upstreamUrl: `${upstream}${normalized}` }
  }

  const remainder =
    matchedRoute.path === '/'
      ? normalized.replace(/^\//, '')
      : normalized.slice(matchedRoute.path.length).replace(/^\//, '')

  return {
    matchedRoute,
    upstreamUrl: remainder ? `${upstream}/${remainder}` : `${upstream}/`,
  }
}
