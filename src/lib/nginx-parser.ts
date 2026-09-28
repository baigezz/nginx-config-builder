import { createRoute } from './route-parser'
import type { LocationModifier, ProxyRoute, ServerConfig } from '../types/nginx'

export interface ParseDiagnostic {
  level: 'warning' | 'info'
  message: string
}

export interface ParsedNginxConfig {
  server: ServerConfig
  routes: ProxyRoute[]
  diagnostics: ParseDiagnostic[]
}

interface BlockMatch {
  header: string
  body: string
  start: number
  end: number
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

function directive(body: string, name: string) {
  const match = body.match(new RegExp(`\\b${name}\\s+([^;]+);`, 'i'))
  return match?.[1]?.trim() ?? ''
}

function parseListen(value: string, diagnostics: ParseDiagnostic[]) {
  if (!value) return '80'
  const port = value.match(/(?:^|:)(\d{1,5})(?:\s|$)/)?.[1] ?? value.match(/^\d{1,5}/)?.[0]
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
      message: `暂不导入正则或命名 location：location ${header}。`,
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
): { upstream: string; pathMode: 'preserve' | 'strip' } | null {
  const match = value.match(/^(https?:\/\/[^/\s]+)(\/[^\s]*)?$/i)
  if (!match) {
    diagnostics.push({
      level: 'warning',
      message: `${path} 的 proxy_pass 无法安全映射：${value}。`,
    })
    return null
  }

  const origin = match[1]
  const uri = match[2] ?? ''

  if (!uri) return { upstream: origin, pathMode: 'preserve' }
  if (uri === '/') return { upstream: origin, pathMode: 'strip' }

  diagnostics.push({
    level: 'warning',
    message: `${path} 的 proxy_pass 包含自定义 URI「${uri}」，当前编辑器暂不自动转换该路由。`,
  })
  return null
}

function riskyDirectives(body: string) {
  const names = ['rewrite', 'try_files', 'return', 'fastcgi_pass', 'uwsgi_pass', 'grpc_pass']
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(body))
}

export function parseNginxConfig(source: string): ParsedNginxConfig {
  const cleaned = stripComments(source)
  const diagnostics: ParseDiagnostic[] = []
  const serverBlocks = findBlocks(cleaned, 'server')

  if (serverBlocks.length > 1) {
    diagnostics.push({
      level: 'info',
      message: `检测到 ${serverBlocks.length} 个 server 块，本次先导入第一个。`,
    })
  }

  const serverBody = serverBlocks[0]?.body ?? cleaned
  if (!serverBlocks.length) {
    diagnostics.push({
      level: 'info',
      message: '未检测到 server 块，将输入内容按 server/location 片段尝试解析。',
    })
  }

  const locationBlocks = findBlocks(serverBody, 'location')
  const serverOnlyBody = removeRanges(
    serverBody,
    locationBlocks.map(({ start, end }) => ({ start, end })),
  )

  const serverName = directive(serverOnlyBody, 'server_name') || 'example.com'
  const listenValue = directive(serverOnlyBody, 'listen')
  const listen = parseListen(listenValue, diagnostics)

  const unsupportedServerDirectives = [
    'ssl_certificate',
    'ssl_certificate_key',
    'root',
    'index',
    'return',
    'rewrite',
    'include',
    'access_log',
    'error_log',
  ].filter((name) => new RegExp(`\\b${name}\\b`).test(serverOnlyBody))

  if (/\\bssl\\b/i.test(listenValue) || unsupportedServerDirectives.some((name) => name.startsWith('ssl_'))) {
    diagnostics.push({
      level: 'warning',
      message: '检测到 HTTPS/TLS 配置。当前阶段只导入 server_name、端口和反向代理路由，证书与 SSL 参数不会自动保留。',
    })
  }

  const otherServerDirectives = unsupportedServerDirectives.filter((name) => !name.startsWith('ssl_'))
  if (otherServerDirectives.length) {
    diagnostics.push({
      level: 'warning',
      message: `检测到尚未结构化支持的 Server 指令：${otherServerDirectives.join('、')}。重新生成前请人工确认。`,
    })
  }

  const routes: ProxyRoute[] = []

  locationBlocks.forEach((block) => {
    const location = parseLocationHeader(block.header, diagnostics)
    if (!location?.path) return

    const proxyPass = directive(block.body, 'proxy_pass')
    if (!proxyPass) {
      diagnostics.push({
        level: 'info',
        message: `跳过 ${location.path}：没有检测到 proxy_pass。`,
      })
      return
    }

    const proxy = parseProxyPass(proxyPass, location.path, diagnostics)
    if (!proxy) return

    const risky = riskyDirectives(block.body)
    if (risky.length) {
      diagnostics.push({
        level: 'warning',
        message: `${location.path} 还包含 ${risky.join(' / ')}，这些指令不会进入结构化表单，请导入后人工确认。`,
      })
    }

    const websocket =
      /proxy_set_header\s+Upgrade\s+\$http_upgrade\s*;/i.test(block.body) ||
      /proxy_set_header\s+Connection\s+["']?upgrade["']?\s*;/i.test(block.body)

    routes.push(
      createRoute({
        path: location.path,
        upstream: proxy.upstream,
        pathMode: proxy.pathMode,
        locationModifier: location.modifier,
        websocket,
        connectTimeout: directive(block.body, 'proxy_connect_timeout'),
        readTimeout: directive(block.body, 'proxy_read_timeout'),
        sendTimeout: directive(block.body, 'proxy_send_timeout'),
        clientMaxBodySize: directive(block.body, 'client_max_body_size'),
        disableCache: /^off$/i.test(directive(block.body, 'proxy_cache')),
      }),
    )
  })

  if (!routes.length) {
    diagnostics.push({
      level: 'warning',
      message: '没有解析到可导入的反向代理 location。',
    })
  }

  return {
    server: { domain: serverName, port: listen },
    routes,
    diagnostics,
  }
}
