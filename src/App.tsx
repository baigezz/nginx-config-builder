import { useMemo, useState } from 'react'
import './App.css'

type PathMode = 'preserve' | 'strip'

type Route = {
  id: string
  path: string
  upstream: string
  pathMode: PathMode
}

const starterPaths = `/psp-tmis-ai-mobile/
/psp-tmis-base-mobile/
/psp-tmis-net-taxi-mobile/`

function normalizePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

function parseRoutes(input: string, defaultUpstream: string, pathMode: PathMode): Route[] {
  return input.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const matched = line.match(/^(\S+)\s*(?:->|\s)\s*(https?:\/\/\S+)$/)
    const path = normalizePath(matched?.[1] ?? line)
    return { id: `${Date.now()}-${index}`, path, upstream: matched?.[2] ?? defaultUpstream, pathMode }
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

  const config = useMemo(() => {
    const locations = routes.map(generateLocation).join('\n\n  ')
    return `server {
  listen ${port};
  server_name ${domain};

  ${locations}
}`
  }, [domain, port, routes])

  const addRoutes = () => {
    const incoming = parseRoutes(input, defaultUpstream, pathMode)
    const unique = incoming.filter((route) => !routes.some((item) => item.path === route.path))
    setRoutes((current) => [...current, ...unique])
  }
  const removeRoute = (id: string) => setRoutes((current) => current.filter((item) => item.id !== id))

  const copyConfig = async () => {
    await navigator.clipboard.writeText(config)
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand"><span className="brandIcon">N</span><div><strong>Nginx 配置生成器</strong><small>简单 · 快速 · 可控</small></div></div>
        <nav>
          <button>快速开始</button><button>常用模板</button><button className="active">自定义配置</button><button>导入现有配置</button>
        </nav>
        <div className="tip"><strong>💡 小贴士</strong><p>支持一行一个路径，也支持 “路径 -&gt; upstream” 格式。</p></div>
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
            <header><span>2</span><div><h2>批量代理路由</h2><p>粘贴多条路径，一次生成多个 location</p></div></header>
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
          </section>
          <section className="card">
            <header><span>3</span><div><h2>路由列表 <em>({routes.length} 条)</em></h2><p>确认解析结果后再生成配置</p></div></header>
            <div className="tableWrap"><table>
              <thead><tr><th>路径</th><th>上游地址</th><th>路径模式</th><th>操作</th></tr></thead>
              <tbody>{routes.map((route) => (
                <tr key={route.id}>
                  <td><code>{route.path}</code></td><td><code>{route.upstream}</code></td>
                  <td><span className="pill">{route.pathMode === 'preserve' ? '保留路径' : '去前缀'}</span></td>
                  <td><button className="danger" onClick={() => removeRoute(route.id)}>删除</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        </div>

        <aside className="preview card">
          <header><span>4</span><div><h2>生成的 Nginx 配置</h2><p>实时预览，可直接复制使用</p></div></header>
          <div className="previewTabs"><b>完整配置</b><span>仅 Server 块</span><span>仅 Location</span></div>
          <pre><code>{config}</code></pre>
          <div className="status">✓ 已生成 {routes.length} 条代理规则</div>
          <button className="copy" onClick={copyConfig}>复制到剪贴板</button>
        </aside>
      </section>
    </main>
  )
}

export default App
