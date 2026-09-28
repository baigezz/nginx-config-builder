import { createRoute, createServer } from './route-parser'
import type {
  LocationModifier,
  NginxServer,
  PathMode,
  ProxyRoute,
} from '../types/nginx'

export interface ParseDiagnostic {
  level: 'warning' | 'info'
  message: string
}

export interface ParsedNginxConfig {
  servers: NginxServer[]
  diagnostics: ParseDiagnostic[]
}

interface BlockMatch {
  header: string
  body: string
  start: number
  end: number
}

interface DirectiveMatch {
  name: string
  value: string
  raw: string
}

function stripComments(source: string) {
  let result = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let inComment = false

  for (const char of source) {
    if (inComment) {
      if (char === '\n') {
        inComment = false
        result += char
      }
      continue
    }

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === '\\') {
      result += char
      escaped = true
      continue
    }

    if (quote) {
      result += char
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      result += char
      continue
    }

    if (char === '#') {
      inComment = true
      continue
    }

    result += char
  }

  return result
}

function findClosingBrace(source: string, openIndex: number) {
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function findBlocks(source: string, keyword: string): BlockMatch[] {
  const blocks: BlockMatch[] = []
  const pattern = new RegExp(`\\b${keyword}\\b\\s*([^{};]*)\\{`, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source))) {
    const openIndex = source.indexOf('{', match.index)
    const closeIndex = findClosingBrace(source, openIndex)
    if (closeIndex < 0) break

    blocks.push({
      header: (match[1] ?? '').trim(),
      body: source.slice(openIndex + 1, closeIndex),
      start: match.index,
      end: closeIndex + 1,
    })

    pattern.lastIndex = closeIndex + 1
  }

  return blocks
}

function removeRanges(source: string, ranges: Array<{ start: number; end: number }>) {
  if (!ranges.length) return source
  const chars = [...source]
  ranges.forEach(({ start, end }) => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== '\n') chars[index] = ' '
    }
  })
  return chars.join('')
}

function extractTopLevelDirectives(source: string): DirectiveMatch[] {
  const result: DirectiveMatch[] = []
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  let buffer = ''

  const flush = () => {
    const raw = buffer.trim()
    buffer = ''
    if (!raw) return

    const match = raw.match(/^([A-Za-z_][\w-]*)\s+([\s\S]+)$/)
    if (!match) return
    result.push({ name: match[1], value: match[2].trim(), raw: `${raw};` })
  }

  for (const char of source) {
    if (escaped) {
      if (depth === 0) buffer += char
      escaped = false
      continue
    }

    if (char === '\\') {
      if (depth === 0) buffer += char
      escaped = true
      continue
    }

    if (quote) {
      if (depth === 0) buffer += char
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      if (depth === 0) buffer += char
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
      if (depth === 1) buffer = ''
      continue
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (depth > 0) continue

    if (char === ';') {
      flush()
      continue
    }

    buffer += char
  }

  return result
}

function firstDirective(directives: DirectiveMatch[], name: string) {
  return directives.find((item) => item.name.toLowerCase() === name.toLowerCase())
}

function parseListen(value: string, diagnostics: ParseDiagnostic[]) {
  if (!value) return '80'
  const port =
    value.match(/(?:^|:)(\d{1,5})(?:\s|$)/)?.[1] ??
    value.match(/^\d{1,5}/)?.[0]

  if (!port) {
    diagnostics.push({
      level: 'warning',
      message: `无法从 listen ${value}; 中提取 TCP 端口，已使用 80。`,
    })
    return '80'
  }
  return port
}

function parseLocationHeader(
  header: string,
  diagnostics: ParseDiagnostic[],
): { path: string; modifier: LocationModifier } | null {
  const tokens = header.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return null

  if (tokens[0] === '~' || tokens[0] === '~*' || tokens[0].startsWith('@')) {
    diagnostics.push({
      level: 'warning',
      message: `暂不结构化导入正则或命名 location：location ${header}。`,
    })
    return null
  }

  if (tokens[0] === '=') {
    return { path: tokens.slice(1).join(' '), modifier: 'exact' }
  }

  if (tokens[0] === '^~') {
    return { path: tokens.slice(1).join(' '), modifier: 'prefer-prefix' }
  }

  return { path: tokens.join(' '), modifier: 'prefix' }
}

function parseProxyPass(
  value: string,
  path: string,
  diagnostics: ParseDiagnostic[],
): { upstream: string; proxyPassUri: string; pathMode: PathMode } | null {
  const match = value.match(/^(https?:\/\/[^/\s]+)(\/[^\s]*)?$/i)
  if (!match) {
    diagnostics.push({
      level: 'warning',
      message: `${path} 的 proxy_pass 暂无法结构化解析：${value}。`,
    })
    return null
  }

  const upstream = match[1]
  const proxyPassUri = match[2] ?? ''

  if (!proxyPassUri) {
    return { upstream, proxyPassUri: '', pathMode: 'preserve' }
  }

  if (proxyPassUri === '/') {
    return { upstream, proxyPassUri: '/', pathMode: 'strip' }
  }

  if (proxyPassUri === path) {
    return { upstream, proxyPassUri, pathMode: 'preserve' }
  }

  return { upstream, proxyPassUri, pathMode: 'custom' }
}

function parseRoute(
  block: BlockMatch,
  diagnostics: ParseDiagnostic[],
): ProxyRoute | null {
  const location = parseLocationHeader(block.header, diagnostics)
  if (!location?.path) return null

  const directives = extractTopLevelDirectives(block.body)
  const proxyPassDirective = firstDirective(directives, 'proxy_pass')
  if (!proxyPassDirective) {
    diagnostics.push({
      level: 'info',
      message: `跳过 ${location.path}：没有检测到 proxy_pass。`,
    })
    return null
  }

  const proxy = parseProxyPass(proxyPassDirective.value, location.path, diagnostics)
  if (!proxy) return null

  const standardHeaders = new Set([
    'host',
    'x-real-ip',
    'x-forwarded-for',
    'x-forwarded-proto',
    'upgrade',
    'connection',
  ])

  const rawDirectives = directives
    .filter((item) => {
      const name = item.name.toLowerCase()
      if (
        [
          'proxy_pass',
          'proxy_http_version',
          'proxy_connect_timeout',
          'proxy_read_timeout',
          'proxy_send_timeout',
          'client_max_body_size',
          'proxy_cache',
        ].includes(name)
      ) {
        return false
      }

      if (name === 'proxy_set_header') {
        const headerName = item.value.split(/\s+/)[0]?.toLowerCase()
        return !standardHeaders.has(headerName)
      }

      return true
    })
    .map((item) => item.raw)

  const websocket =
    /proxy_set_header\s+Upgrade\s+\$http_upgrade\s*;/i.test(block.body) ||
    /proxy_set_header\s+Connection\s+["']?upgrade["']?\s*;/i.test(block.body)

  if (/\b(if|limit_except)\b[^{}]*\{/i.test(block.body)) {
    diagnostics.push({
      level: 'warning',
      message: `${location.path} 含嵌套块（如 if / limit_except），当前不会自动重建该嵌套块，请人工确认。`,
    })
  }

  return createRoute({
    path: location.path,
    upstream: proxy.upstream,
    pathMode: proxy.pathMode,
    proxyPassUri: proxy.proxyPassUri,
    locationModifier: location.modifier,
    websocket,
    connectTimeout: firstDirective(directives, 'proxy_connect_timeout')?.value ?? '',
    readTimeout: firstDirective(directives, 'proxy_read_timeout')?.value ?? '',
    sendTimeout: firstDirective(directives, 'proxy_send_timeout')?.value ?? '',
    clientMaxBodySize: firstDirective(directives, 'client_max_body_size')?.value ?? '',
    disableCache: /^off$/i.test(firstDirective(directives, 'proxy_cache')?.value ?? ''),
    rawDirectives,
  })
}

function parseServerBody(
  serverBody: string,
  diagnostics: ParseDiagnostic[],
  index: number,
): NginxServer {
  const locationBlocks = findBlocks(serverBody, 'location')
  const serverOnlyBody = removeRanges(
    serverBody,
    locationBlocks.map(({ start, end }) => ({ start, end })),
  )
  const directives = extractTopLevelDirectives(serverOnlyBody)

  const listenDirective = firstDirective(directives, 'listen')
  const serverNameDirective = firstDirective(directives, 'server_name')
  const certDirective = firstDirective(directives, 'ssl_certificate')
  const keyDirective = firstDirective(directives, 'ssl_certificate_key')
  const listenValue = listenDirective?.value ?? ''

  const consumed = new Set<DirectiveMatch>(
    [listenDirective, serverNameDirective, certDirective, keyDirective].filter(
      (item): item is DirectiveMatch => Boolean(item),
    ),
  )

  const rawDirectives = directives
    .filter((item) => !consumed.has(item))
    .map((item) => item.raw)

  const routes = locationBlocks
    .map((block) => parseRoute(block, diagnostics))
    .filter((route): route is ProxyRoute => Boolean(route))

  const sslEnabled =
    /(?:^|\s)ssl(?:\s|$)/i.test(listenValue) ||
    Boolean(certDirective) ||
    Boolean(keyDirective)

  const server = createServer(
    {
      domain: serverNameDirective?.value || `server-${index + 1}.example.com`,
      port: parseListen(listenValue, diagnostics),
      sslEnabled,
      sslCertificate: certDirective?.value ?? '',
      sslCertificateKey: keyDirective?.value ?? '',
      rawDirectives,
    },
    routes,
  )

  if (sslEnabled && (!server.sslCertificate || !server.sslCertificateKey)) {
    diagnostics.push({
      level: 'warning',
      message: `${server.domain} 启用了 SSL，但证书或私钥路径不完整。`,
    })
  }

  return server
}

export function parseNginxConfig(source: string): ParsedNginxConfig {
  const cleaned = stripComments(source)
  const diagnostics: ParseDiagnostic[] = []
  const serverBlocks = findBlocks(cleaned, 'server')

  const servers = serverBlocks.length
    ? serverBlocks.map((block, index) => parseServerBody(block.body, diagnostics, index))
    : [parseServerBody(cleaned, diagnostics, 0)]

  if (!serverBlocks.length) {
    diagnostics.push({
      level: 'info',
      message: '未检测到 server 块，已把输入内容作为单个 server/location 片段解析。',
    })
  }

  const routeCount = servers.reduce((sum, server) => sum + server.routes.length, 0)
  if (!routeCount) {
    diagnostics.push({
      level: 'warning',
      message: '没有解析到可导入的反向代理 location。',
    })
  }

  if (serverBlocks.length > 1) {
    diagnostics.push({
      level: 'info',
      message: `已识别 ${serverBlocks.length} 个 server 块，可作为独立站点编辑。`,
    })
  }

  return { servers, diagnostics }
}
