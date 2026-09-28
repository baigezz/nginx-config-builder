import type { NginxServer, ProxyRoute } from '../types/nginx'

function locationPrefix(route: ProxyRoute) {
  if (route.locationModifier === 'exact') return 'location ='
  if (route.locationModifier === 'prefer-prefix') return 'location ^~'
  return 'location'
}

function proxyPassValue(route: ProxyRoute) {
  const upstream = route.upstream.replace(/\/+$/, '')
  if (route.proxyPassUri) return `${upstream}${route.proxyPassUri}`
  if (route.pathMode === 'strip') return `${upstream}/`
  return upstream
}

export function generateLocation(route: ProxyRoute) {
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
  route.rawDirectives.forEach((item) => advanced.push(`    ${item.replace(/;?$/, ';')}`))

  const advancedBlock = advanced.length ? `\n${advanced.join('\n')}` : ''

  return `${locationPrefix(route)} ${route.path} {
    proxy_pass ${proxyPassValue(route)};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;${advancedBlock}
  }`
}

export function generateServerBlock(server: NginxServer) {
  const listen = `${server.port}${server.sslEnabled ? ' ssl' : ''}`
  const serverLines = [
    `  listen ${listen};`,
    `  server_name ${server.domain};`,
  ]

  if (server.sslEnabled) {
    if (server.sslCertificate) {
      serverLines.push(`  ssl_certificate ${server.sslCertificate};`)
    }
    if (server.sslCertificateKey) {
      serverLines.push(`  ssl_certificate_key ${server.sslCertificateKey};`)
    }
  }

  server.rawDirectives.forEach((item) => {
    serverLines.push(`  ${item.replace(/;?$/, ';')}`)
  })

  const rawBlocks = server.rawBlocks
    .map((block) =>
      block
        .trim()
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    )
    .join('\n\n')

  const locations = server.routes.map(generateLocation).join('\n\n  ')
  const bodyParts = [rawBlocks, locations].filter(Boolean)
  const body = bodyParts.length ? `\n\n${bodyParts.map((part) => `  ${part.replace(/^  /, '')}`).join('\n\n')}` : ''

  return `server {
${serverLines.join('\n')}${body}
}`
}

export function generateNginxConfig(servers: NginxServer[]) {
  return servers.map(generateServerBlock).join('\n\n')
}

export interface RequestSimulation {
  matchedRoute: ProxyRoute | null
  upstreamUrl: string
}

function joinMappedUri(base: string, remainder: string) {
  if (!remainder) return base
  if (base.endsWith('/') && remainder.startsWith('/')) return `${base}${remainder.slice(1)}`
  if (!base.endsWith('/') && !remainder.startsWith('/')) return `${base}/${remainder}`
  return `${base}${remainder}`
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

  if (matchedRoute.proxyPassUri) {
    const remainder =
      matchedRoute.locationModifier === 'exact'
        ? ''
        : normalized.slice(matchedRoute.path.length)
    return {
      matchedRoute,
      upstreamUrl: `${upstream}${joinMappedUri(matchedRoute.proxyPassUri, remainder)}`,
    }
  }

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
