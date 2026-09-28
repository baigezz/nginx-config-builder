import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

type PathMode = 'preserve' | 'strip'
type Route = { id: string; path: string; upstream: string; pathMode: PathMode }

const starterPaths = `/psp-tmis-ai-mobile/
/psp-tmis-base-mobile/
/psp-tmis-net-taxi-mobile/`

function normalizePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

function routeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
function parseRoutes(input: string, defaultUpstream: string, pathMode: PathMode): Route[] {
  return input.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const matched = line.match(/^(\S+)\s*(?:->|\s)\s*(https?:\/\/\S+)$/)
    return {
      id: routeId(),
      path: normalizePath(matched?.[1] ?? line),
      upstream: matched?.[2] ?? defaultUpstream,
      pathMode,
    }
  })
}

function parseCsv(text: string, defaultUpstream: string, defaultMode: PathMode): Route[] {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!rows.length) return []
  const header = rows[0].toLowerCase()
  const start = header.includes('path') && header.includes('upstream') ? 1 : 0
  return rows.slice(start).map((row) => {
    const [path, upstream, mode] = row.split(',').map((cell) => cell.trim())
    return {
      id: routeId(),
      path: normalizePath(path),
      upstream: upstream || defaultUpstream,
      pathMode: mode === 'strip' || mode === 'strip-prefix' ? 'strip' : defaultMode,
    }
  })
}
function parseJson(text: string, defaultUpstream: string, defaultMode: PathMode): Route[] {
  const value = JSON.parse(text) as unknown
  if (!Array.isArray(value)) throw new Error('JSON 顶层必须是数组')
  return value.map((item) => {
    if (typeof item === 'string') {
      return { id: routeId(), path: normalizePath(item), upstream: defaultUpstream, pathMode: defaultMode }
    }
    if (!item || typeof item !== 'object') throw new Error('JSON 每一项必须是字符串或对象')
    const record = item as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path : ''
    const upstream = typeof record.upstream === 'string' ? record.upstream : defaultUpstream
    const mode = record.pathMode === 'strip' || record.pathMode === 'strip-prefix' ? 'strip' : defaultMode
    if (!path) throw new Error('JSON 对象缺少 path')
    return { id: routeId(), path: normalizePath(path), upstream, pathMode: mode }
  })
}

function generateLocation(route: Route) {
  const upstream = route.upstream.replace(/\/$/, '')
  const proxyPass = route.pathMode === 'strip' ? `${upstream}/` : upstream
  return `location ${route.path} {
    proxy_pass ${proxyPass};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }`
}
function App() {
  const [domain, setDomain] = useState('example.com')
  const [port, setPort] = useState('80')
  const [input, setInput] = useState(starterPaths)
  const [defaultUpstream, setDefaultUpstream] = useState('http://10.0.0.20:8080')
  const [pathMode, setPathMode] = useState<PathMode>('preserve')
  const [routes, setRoutes] = useState<Route[]>(() => parseRoutes(starterPaths, defaultUpstream, 'preserve'))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Route | null>(null)
  const [notice, setNotice] = useState('')

  const config = useMemo(() => {
    const locations = routes.map(generateLocation).join('\n\n  ')
    return `server {
  listen ${port};
  server_name ${domain};

  ${locations}
}`
  }, [domain, port, routes])

  const warnings = useMemo(() => {
    const result: string[] = []
    routes.forEach((route) => {
      if (!/^https?:\/\//.test(route.upstream)) result.push(`${route.path} 的 upstream 缺少 http:// 或 https://`)
    })
    return result
  }, [routes])
  const mergeRoutes = (incoming: Route[]) => {
    const seen = new Set(routes.map((route) => route.path))
    const accepted: Route[] = []
    const duplicates: string[] = []
    incoming.forEach((route) => {
      if (!route.path) return
      if (seen.has(route.path)) duplicates.push(route.path)
      else {
        seen.add(route.path)
        accepted.push(route)
      }
    })
    setRoutes((current) => [...current, ...accepted])
    setNotice(
      duplicates.length
        ? `已添加 ${accepted.length} 条，跳过 ${duplicates.length} 条重复路径：${duplicates.join('、')}`
        : `已添加 ${accepted.length} 条路由`,
    )
  }

  const addRoutes = () => mergeRoutes(parseRoutes(input, defaultUpstream, pathMode))

  const removeRoute = (id: string) => {
    setRoutes((current) => current.filter((item) => item.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const beginEdit = (route: Route) => {
    setEditingId(route.id)
    setDraft({ ...route })
  }

  const saveEdit = () => {
    if (!draft) return
    const normalized = { ...draft, path: normalizePath(draft.path) }
    const duplicate = routes.some((route) => route.id !== normalized.id && route.path === normalized.path)
    if (duplicate) {
      setNotice(`无法保存：路径 ${normalized.path} 已存在`)
      return
    }
    setRoutes((current) => current.map((route) => route.id === normalized.id ? normalized : route))
    setEditingId(null)
    setDraft(null)
    setNotice('路由已更新')
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const lower = file.name.toLowerCase()
      const imported = lower.endsWith('.json')
        ? parseJson(text, defaultUpstream, pathMode)
        : parseCsv(text, defaultUpstream, pathMode)
      mergeRoutes(imported)
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : '无法解析文件'}`)
    }
  }

  const copyConfig = async () => {
    await navigator.clipboard.writeText(config)
    setNotice('配置已复制到剪贴板')
  }

  const downloadConfig = () => {
    const blob = new Blob([config], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${domain || 'nginx'}.conf`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('nginx.conf 已生成下载')
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand"><span className="brandIcon">N</span><div><strong>Nginx 配置生成器</strong><small>简单 · 快速 · 可控</small></div></div>
        <nav>
          <button>快速开始</button><button>常用模板</button><button className="active">自定义配置</button><button>导入现有配置</button>
        </nav>
        <div className="tip"><strong>💡 批量导入</strong><p>支持多行粘贴、CSV 和 JSON。重复 location 会自动跳过。</p></div>
      </aside>

      <section className="workspace">
        <div className="formArea">
          <section className="card">
            <header><span>1</span><div><h2>Server 基础配置</h2><p>设置域名和监听端口</p></div></header>
            <div className="grid2">
              <label>域名 (server_name)<input value={domain} onChange={(e) => setDomain(e.target.value)} /></label>
              <label>监听端口<input value={port} onChange={(e) => setPort(e.target.value)} /></label>
            </div>
          </section>

          <section className="card">
            <header><span>2</span><div><h2>批量代理路由</h2><p>粘贴或导入，一次生成多个 location</p></div></header>
            <div className="importBar">
              <b>批量输入</b>
              <label className="fileButton">导入 CSV / JSON<input type="file" accept=".csv,.json,text/csv,application/json" onChange={importFile} /></label>
              <span>CSV: path,upstream,pathMode</span>
            </div>
            <div className="builder">
              <label className="paths">输入路径<textarea value={input} onChange={(e) => setInput(e.target.value)} /></label>
              <div className="options">
                <label>默认上游地址<input value={defaultUpstream} onChange={(e) => setDefaultUpstream(e.target.value)} /></label>
                <fieldset><legend>路径转发方式</legend>
                  <label><input type="radio" checked={pathMode === 'preserve'} onChange={() => setPathMode('preserve')} /> 保留完整路径</label>
                  <label><input type="radio" checked={pathMode === 'strip'} onChange={() => setPathMode('strip')} /> 移除匹配前缀</label>
                </fieldset>
                <button className="primary" onClick={addRoutes}>+ 解析并添加到列表</button>
              </div>
            </div>
            {notice && <div className="notice">{notice}</div>}
          </section>

          <section className="card">
            <header><span>3</span><div><h2>路由列表 <em>({routes.length} 条)</em></h2><p>支持单条编辑、删除和重复校验</p></div></header>
            <div className="tableWrap"><table>
              <thead><tr><th>路径</th><th>上游地址</th><th>路径模式</th><th>操作</th></tr></thead>
              <tbody>{routes.map((route) => {
                const editing = editingId === route.id && draft
                return (
                  <tr key={route.id}>
                    <td>{editing ? <input value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} /> : <code>{route.path}</code>}</td>
                    <td>{editing ? <input value={draft.upstream} onChange={(e) => setDraft({ ...draft, upstream: e.target.value })} /> : <code>{route.upstream}</code>}</td>
                    <td>{editing ? (
                      <select value={draft.pathMode} onChange={(e) => setDraft({ ...draft, pathMode: e.target.value as PathMode })}>
                        <option value="preserve">保留路径</option><option value="strip">去前缀</option>
                      </select>
                    ) : <span className="pill">{route.pathMode === 'preserve' ? '保留路径' : '去前缀'}</span>}</td>
                    <td className="actions">{editing
                      ? <><button className="link" onClick={saveEdit}>保存</button><button className="muted" onClick={() => { setEditingId(null); setDraft(null) }}>取消</button></>
                      : <><button className="link" onClick={() => beginEdit(route)}>编辑</button><button className="danger" onClick={() => removeRoute(route.id)}>删除</button></>}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          </section>
        </div>

        <aside className="preview card">
          <header><span>4</span><div><h2>生成的 Nginx 配置</h2><p>实时预览，可复制或下载</p></div></header>
          <div className="previewTabs"><b>完整配置</b><span>仅 Server 块</span><span>仅 Location</span></div>
          <pre><code>{config}</code></pre>
          {warnings.length
            ? <div className="status warning">⚠ {warnings.join('；')}</div>
            : <div className="status">✓ 已生成 {routes.length} 条代理规则，基础校验通过</div>}
          <div className="previewActions">
            <button className="secondary" onClick={downloadConfig}>下载 nginx.conf</button>
            <button className="copy" onClick={copyConfig}>复制到剪贴板</button>
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
