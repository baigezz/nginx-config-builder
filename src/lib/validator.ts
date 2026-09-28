import type { ProxyRoute, ServerConfig, ValidationIssue } from '../types/nginx'

export function validateConfig(
  server: ServerConfig,
  routes: ProxyRoute[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!server.domain.trim()) {
    issues.push({ level: 'error', message: 'server_name 不能为空' })
  }

  const port = Number(server.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({ level: 'error', message: '监听端口必须是 1-65535 的整数' })
  }

  const seen = new Set<string>()
  routes.forEach((route) => {
    const key = `${route.locationModifier}:${route.path}`
    if (seen.has(key)) {
      issues.push({ level: 'error', message: `重复 location：${route.path}` })
    }
    seen.add(key)

    if (!route.path.startsWith('/')) {
      issues.push({ level: 'error', message: `${route.path} 必须以 / 开头` })
    }

    try {
      const url = new URL(route.upstream)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        issues.push({ level: 'error', message: `${route.path} 的 upstream 仅支持 http/https` })
      }
    } catch {
      issues.push({ level: 'error', message: `${route.path} 的 upstream 地址无效` })
    }

    if (route.locationModifier === 'exact' && route.pathMode === 'strip') {
      issues.push({
        level: 'warning',
        message: `${route.path} 是精确匹配，通常不需要“去前缀”模式`,
      })
    }
  })

  const prefixRoutes = routes.filter((route) => route.locationModifier !== 'exact')
  for (let i = 0; i < prefixRoutes.length; i += 1) {
    for (let j = i + 1; j < prefixRoutes.length; j += 1) {
      const a = prefixRoutes[i]
      const b = prefixRoutes[j]
      if (a.path !== b.path && (a.path.startsWith(b.path) || b.path.startsWith(a.path))) {
        const shorter = a.path.length < b.path.length ? a : b
        const longer = shorter === a ? b : a
        issues.push({
          level: 'info',
          message: `路径重叠：${longer.path} 会比 ${shorter.path} 更具体地匹配请求`,
        })
      }
    }
  }

  return issues
}
