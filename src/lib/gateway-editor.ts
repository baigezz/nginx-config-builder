export type GatewayScope = 'root' | 'children' | 'both'
export type GatewayAuth = 'required' | 'skip'

export interface GatewayRouteInput {
  path: string
  scope: GatewayScope
  auth: GatewayAuth
}

export interface GatewayInfo {
  domain: string
  port: string
  upstream: string
  locationCount: number
}

export interface GatewayPlan {
  info: GatewayInfo
  output: string
  added: number
  skipped: number
}

interface LocationBlock {
  modifier: string
  path: string
  body: string
  start: number
}

const locationPattern = /^[ \t]*location\s+(?:(=|\^~|~\*?)\s+)?(\S+)\s*\{/gm
const proxyPattern = /^\s*proxy_pass\s+(\S+)\s*;/gm

function closingBrace(source: string, opening: number) {
  let depth = 0
  let quote = ''
  let comment = false
  let escaped = false

  for (let index = opening; index < source.length; index += 1) {
    const char = source[index]
    if (comment) {
      if (char === '\n') comment = false
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') comment = true
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  throw new Error('配置中的花括号不完整')
}

function getLocations(source: string): LocationBlock[] {
  const found = [...source.matchAll(locationPattern)].map((match) => {
    const start = match.index ?? 0
    const end = closingBrace(source, start + match[0].lastIndexOf('{'))
    return {
      modifier: match[1] ?? '',
      path: match[2],
      body: source.slice(start + match[0].length, end - 1),
      start,
    }
  })
  if (found.length !== [...source.matchAll(/^\s*location\b/gm)].length) {
    throw new Error('存在无法识别的 location 写法，停止生成')
  }
  if (found.some((item) => item.modifier.startsWith('~') || item.path.startsWith('@'))) {
    throw new Error('目标文件含正则或命名 location，需人工核对匹配优先级')
  }
  return found
}

function proxyOrigin(value: string) {
  const match = value.match(/^(https?:\/\/[^/\s;]+)(?:\/[^\s;]*)?$/i)
  if (!match || value.includes('$')) throw new Error(`无法安全识别上游：${value}`)
  return match[1]
}

export function inspectGatewaySource(source: string): GatewayInfo {
  const servers = [...source.matchAll(/^\s*server\s*\{/gm)]
  if (servers.length !== 1) throw new Error('请导入只包含一个 server 的业务端口 .conf 文件')
  const listens = [...source.matchAll(/^\s*listen\s+(\d+)\s+ssl\s*;/gm)]
  if (listens.length !== 1) throw new Error('需要唯一的 listen <端口> ssl；默认拒绝或预留文件不能在此编辑')
  const domain = source.match(/^\s*server_name\s+([^;]+);/m)?.[1].trim() ?? ''
  if (!domain || domain === '_') throw new Error('无法确定业务 server_name')
  if (!/^\s*access_by_lua_file\s+\S+\s*;/m.test(source)) {
    throw new Error('未找到 server 层 access_by_lua_file，无法确定鉴权继承')
  }
  const origins = new Set([...source.matchAll(proxyPattern)].map((match) => proxyOrigin(match[1])))
  if (origins.size !== 1) throw new Error('当前文件没有唯一上游，不能自动生成代理规则')
  const locations = getLocations(source)
  const fallback = locations.filter((item) => item.modifier === '' && item.path === '/')
  if (fallback.length !== 1 || !/\breturn\s+404\s*;/.test(fallback[0].body)) {
    throw new Error('未找到唯一的 location / { return 404; } 兜底规则')
  }
  return {
    domain,
    port: listens[0][1],
    upstream: [...origins][0],
    locationCount: locations.length,
  }
}

function requestedLocations(input: GatewayRouteInput): Array<[string, string, GatewayAuth]> {
  let path = input.path.trim()
  if (!path.startsWith('/') || path === '/' || /[\s?#;"'$\\]/.test(path)) {
    throw new Error(`路径格式无效：${input.path || '空路径'}`)
  }
  if (path.includes('//') || path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`路径含空段或点段：${path}`)
  }
  if (/[{}]/.test(path)) {
    const remaining = path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')
    if (/[{}]/.test(remaining)) throw new Error(`动态参数格式无效：${path}`)
    const parameter = path.match(/\/\{[A-Za-z_][A-Za-z0-9_]*\}(?=\/|$)/)
    if (!parameter || input.scope !== 'children') {
      throw new Error(`${path} 含动态参数，匹配范围须选“仅子路径”`)
    }
    path = path.slice(0, (parameter.index ?? 0) + 1)
    if (path === '/') throw new Error(`${input.path} 的参数前没有可用的固定前缀`)
  } else if (input.scope === 'both' && path.endsWith('/')) {
    throw new Error(`${path} 选择“根路径和子路径”时请去掉末尾 /`)
  }

  const result: Array<[string, string, GatewayAuth]> = []
  if (input.scope === 'root' || input.scope === 'both') result.push(['=', path, input.auth])
  if (input.scope === 'children' || input.scope === 'both') {
    result.push(['', path.endsWith('/') ? path : `${path}/`, input.auth])
  }
  return result
}

function overlaps(a: [string, string], b: [string, string]) {
  if (a[0] === '=' && b[0] === '=') return a[1] === b[1]
  if (a[0] === '=') return a[1].startsWith(b[1])
  if (b[0] === '=') return b[1].startsWith(a[1])
  return a[1].startsWith(b[1]) || b[1].startsWith(a[1])
}

function existingBehavior(block: LocationBlock) {
  const luaBlocks = [...block.body.matchAll(/access_by_lua_block\s*\{([^{}]*)\}/g)]
  if (luaBlocks.length > 1 || (luaBlocks.length && luaBlocks[0][1].trim() !== 'return')) {
    throw new Error(`现有 ${block.path} 的 Lua 鉴权无法自动判断`)
  }
  const rest = block.body.replace(/access_by_lua_block\s*\{[^{}]*\}/g, '')
  if (/\b(rewrite|try_files|proxy_set_header|proxy_redirect|return|access_by_lua_file)\b/.test(rest)) {
    throw new Error(`现有 ${block.path} 包含额外行为，需要人工核对`)
  }
  const passes = [...block.body.matchAll(proxyPattern)]
  if (passes.length !== 1) throw new Error(`现有 ${block.path} 的 proxy_pass 无法判断`)
  const origin = proxyOrigin(passes[0][1])
  const uri = passes[0][1].slice(origin.length)
  if (uri && uri !== block.path) throw new Error(`现有 ${block.path} 使用自定义 URI 映射`)
  return { auth: luaBlocks.length ? 'skip' : 'required', origin }
}

function renderLocation(modifier: string, path: string, auth: GatewayAuth, upstream: string, newline: string) {
  const lines = [`    location ${modifier === '=' ? '= ' : ''}${path} {`]
  if (auth === 'skip') lines.push('        access_by_lua_block {', '            return', '        }', '')
  lines.push(`        proxy_pass ${upstream};`, '    }')
  return lines.join(newline)
}

function insertionPoint(source: string, fallbackStart: number) {
  let cursor = fallbackStart
  while (cursor > 0) {
    const previous = source.lastIndexOf('\n', cursor - 2) + 1
    const line = source.slice(previous, cursor).trim()
    if (!line) {
      cursor = previous
      continue
    }
    if (/^#\s*(不匹配|未列入)/.test(line)) return previous
    break
  }
  return fallbackStart
}

export function planGatewayEdit(source: string, inputs: GatewayRouteInput[]): GatewayPlan {
  const info = inspectGatewaySource(source)
  const present = getLocations(source)
  const fallback = present.find((item) => item.modifier === '' && item.path === '/')!
  const requested = new Map<string, [string, string, GatewayAuth]>()
  for (const input of inputs) {
    for (const route of requestedLocations(input)) {
      const key = `${route[0]}:${route[1]}`
      const previous = requested.get(key)
      if (previous && previous[2] !== route[2]) throw new Error(`${route[1]} 有冲突的鉴权要求`)
      requested.set(key, route)
    }
  }

  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const additions: string[] = []
  let skipped = 0
  for (const [modifier, path, auth] of requested.values()) {
    let duplicate = false
    for (const block of present) {
      if (block.path === '/' || !overlaps([modifier, path], [block.modifier, block.path])) continue
      if (path === block.path && modifier !== block.modifier && modifier !== '=' && block.modifier !== '=') {
        throw new Error(`${path} 已有不同的前缀匹配修饰符`)
      }
      const existing = existingBehavior(block)
      if (existing.auth !== auth || existing.origin !== info.upstream) {
        throw new Error(`${path} 与现有 ${block.path} 的鉴权或上游冲突`)
      }
      if (modifier === block.modifier && path === block.path) duplicate = true
    }
    if (duplicate) skipped += 1
    else additions.push(renderLocation(modifier, path, auth, info.upstream, newline))
  }

  if (!additions.length) return { info, output: source, added: 0, skipped }
  const point = insertionPoint(source, fallback.start)
  const output = source.slice(0, point) + additions.join(newline + newline) + newline + newline + source.slice(point)
  return { info, output, added: additions.length, skipped }
}
