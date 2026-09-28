import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import { NginxImport } from './components/NginxImport'
import { PresetPicker } from './components/PresetPicker'
import { RequestSimulator } from './components/RequestSimulator'
import { RoutesTable } from './components/RoutesTable'
import { ServerManager } from './components/ServerManager'
import { presets } from './data/presets'
import { generateNginxConfig } from './lib/nginx-generator'
import {
  createRoute,
  createServer,
  parseBulkRoutes,
  parseCsv,
  parseJson,
} from './lib/route-parser'
import { validateConfig } from './lib/validator'
import type { NginxPreset, NginxServer, PathMode, ProxyRoute } from './types/nginx'

const starterPaths = `/service-a/
/service-b/
/service-c/`

function createInitialServer() {
  return createServer(
    { domain: 'example.com', port: '80' },
    parseBulkRoutes(starterPaths, 'http://backend.example.com:8080', 'preserve'),
  )
}

function App() {
  const [servers, setServers] = useState<NginxServer[]>(() => [createInitialServer()])
  const [activeServerId, setActiveServerId] = useState('')
  const [input, setInput] = useState(starterPaths)
  const [defaultUpstream, setDefaultUpstream] = useState('http://backend.example.com:8080')
  const [pathMode, setPathMode] = useState<PathMode>('preserve')
  const [notice, setNotice] = useState('')

  const activeServer =
    servers.find((server) => server.id === activeServerId) ?? servers[0]

  const config = useMemo(() => generateNginxConfig(servers), [servers])
  const issues = useMemo(() => validateConfig(servers), [servers])
  const hasErrors = issues.some((issue) => issue.level === 'error')
  const totalRoutes = useMemo(
    () => servers.reduce((sum, server) => sum + server.routes.length, 0),
    [servers],
  )

  const updateActiveServer = (patch: Partial<NginxServer>) => {
    if (!activeServer) return
    setServers((current) =>
      current.map((server) =>
        server.id === activeServer.id ? { ...server, ...patch } : server,
      ),
    )
  }

  const setActiveRoutes = (routes: ProxyRoute[]) => {
    updateActiveServer({ routes })
  }

  const mergeRoutes = (incoming: ProxyRoute[]) => {
    if (!activeServer) return

    const seen = new Set(
      activeServer.routes.map((route) => `${route.locationModifier}:${route.path}`),
    )
    const accepted: ProxyRoute[] = []
    const duplicates: string[] = []

    incoming.forEach((route) => {
      if (!route.path) return
      const key = `${route.locationModifier}:${route.path}`
      if (seen.has(key)) {
        duplicates.push(route.path)
        return
      }

      seen.add(key)
      accepted.push(route)
    })

    setActiveRoutes([...activeServer.routes, ...accepted])
    setNotice(
      duplicates.length
        ? `已添加 ${accepted.length} 条，跳过 ${duplicates.length} 条重复 location：${duplicates.join('、')}`
        : `已添加 ${accepted.length} 条路由到 ${activeServer.domain}`,
    )
  }

  const replaceServers = (incoming: NginxServer[]) => {
    if (!incoming.length) return
    setServers(incoming)
    setActiveServerId(incoming[0].id)
  }

  const appendServers = (incoming: NginxServer[]) => {
    if (!incoming.length) return
    setServers((current) => [...current, ...incoming])
    setActiveServerId(incoming[0].id)
  }

  const addServer = () => {
    const server = createServer({
      domain: `server-${servers.length + 1}.example.com`,
      port: '80',
    })
    setServers((current) => [...current, server])
    setActiveServerId(server.id)
    setNotice('已创建新的 Server')
  }

  const removeServer = (id: string) => {
    if (servers.length <= 1) return
    const remaining = servers.filter((server) => server.id !== id)
    setServers(remaining)
    if (activeServer?.id === id) {
      setActiveServerId(remaining[0]?.id ?? '')
    }
    setNotice('已删除当前 Server')
  }

  const addRoutes = () => {
    mergeRoutes(parseBulkRoutes(input, defaultUpstream, pathMode))
  }

  const applyPreset = (preset: NginxPreset) => {
    const incoming = preset.routes.map((route) => createRoute(route))
    mergeRoutes(incoming)
    setNotice(`已应用「${preset.name}」模板`)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const imported = file.name.toLowerCase().endsWith('.json')
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
    anchor.download = 'nginx.conf'
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('nginx.conf 已生成下载')
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandIcon">N</span>
          <div>
            <strong>Nginx 配置生成器</strong>
            <small>简单 · 快速 · 可控</small>
          </div>
        </div>

        <nav>
          <button>快速开始</button>
          <button>常用模板</button>
          <button className="active">多 Server / TLS</button>
          <button>导入现有配置</button>
        </nav>

        <div className="tip">
          <strong>💡 Stage 5</strong>
          <p>支持多个 Server、HTTPS/TLS、proxy_pass URI 映射，并尽量保留未结构化的原始指令。</p>
        </div>
      </aside>

      <section className="workspace">
        <div className="formArea">
          <NginxImport
            onReplace={replaceServers}
            onAppend={appendServers}
            onNotice={setNotice}
          />

          <ServerManager
            servers={servers}
            activeServerId={activeServer?.id ?? ''}
            onSelect={setActiveServerId}
            onAdd={addServer}
            onRemove={removeServer}
          />

          {activeServer && (
            <>
              <section className="card serverSettingsCard">
                <header>
                  <span>3</span>
                  <div>
                    <h2>Server 基础与 TLS</h2>
                    <p>当前编辑：{activeServer.domain}</p>
                  </div>
                </header>

                <div className="grid2">
                  <label>
                    域名 (server_name)
                    <input
                      value={activeServer.domain}
                      onChange={(event) => updateActiveServer({ domain: event.target.value })}
                    />
                  </label>
                  <label>
                    监听端口
                    <input
                      value={activeServer.port}
                      onChange={(event) => updateActiveServer({ port: event.target.value })}
                    />
                  </label>
                </div>

                <label className="tlsToggle">
                  <input
                    type="checkbox"
                    checked={activeServer.sslEnabled}
                    onChange={(event) =>
                      updateActiveServer({ sslEnabled: event.target.checked })
                    }
                  />
                  <span>
                    <strong>启用 HTTPS / TLS</strong>
                    <small>生成 listen ... ssl 以及证书配置</small>
                  </span>
                </label>

                {activeServer.sslEnabled && (
                  <div className="tlsGrid">
                    <label>
                      ssl_certificate
                      <input
                        value={activeServer.sslCertificate}
                        onChange={(event) =>
                          updateActiveServer({ sslCertificate: event.target.value })
                        }
                        placeholder="/etc/nginx/certs/site.crt"
                      />
                    </label>
                    <label>
                      ssl_certificate_key
                      <input
                        value={activeServer.sslCertificateKey}
                        onChange={(event) =>
                          updateActiveServer({ sslCertificateKey: event.target.value })
                        }
                        placeholder="/etc/nginx/certs/site.key"
                      />
                    </label>
                  </div>
                )}

                <label className="rawDirectivesField">
                  Server 原始指令（每行一条，会原样重新生成）
                  <textarea
                    value={activeServer.rawDirectives.join('\n')}
                    onChange={(event) =>
                      updateActiveServer({
                        rawDirectives: event.target.value
                          .split(/\r?\n/)
                          .map((line) => line.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={'access_log /var/log/nginx/app.access.log;\ninclude /etc/nginx/snippets/security.conf;'}
                  />
                </label>

                {activeServer.rawBlocks.length > 0 && (
                  <div className="rawBlocksPanel">
                    <div>
                      <strong>Raw Blocks · {activeServer.rawBlocks.length}</strong>
                      <span>暂不结构化编辑，但生成配置时会继续保留</span>
                    </div>
                    <pre>{activeServer.rawBlocks.join('\n\n')}</pre>
                  </div>
                )}
              </section>

              <section className="card">
                <header>
                  <span>4</span>
                  <div>
                    <h2>常用模板</h2>
                    <p>模板会添加到当前 Server，不影响其他 Server</p>
                  </div>
                </header>
                <PresetPicker presets={presets} onApply={applyPreset} />
              </section>

              <section className="card">
                <header>
                  <span>5</span>
                  <div>
                    <h2>批量代理路由</h2>
                    <p>为当前 Server 批量加入多个 location</p>
                  </div>
                </header>

                <div className="importBar">
                  <b>批量输入</b>
                  <label className="fileButton">
                    导入 CSV / JSON
                    <input
                      type="file"
                      accept=".csv,.json,text/csv,application/json"
                      onChange={importFile}
                    />
                  </label>
                  <span>CSV 可选第 5 列 proxyPassUri</span>
                </div>

                <div className="builder">
                  <label className="paths">
                    输入路径
                    <textarea value={input} onChange={(event) => setInput(event.target.value)} />
                  </label>

                  <div className="options">
                    <label>
                      默认上游地址
                      <input
                        value={defaultUpstream}
                        onChange={(event) => setDefaultUpstream(event.target.value)}
                      />
                    </label>

                    <fieldset>
                      <legend>默认路径转发方式</legend>
                      <label>
                        <input
                          type="radio"
                          checked={pathMode === 'preserve'}
                          onChange={() => setPathMode('preserve')}
                        />
                        保留完整路径
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={pathMode === 'strip'}
                          onChange={() => setPathMode('strip')}
                        />
                        移除匹配前缀
                      </label>
                    </fieldset>

                    <button className="primary" onClick={addRoutes}>
                      + 解析并添加到当前 Server
                    </button>
                  </div>
                </div>

                {notice && <div className="notice">{notice}</div>}
              </section>

              <RoutesTable
                routes={activeServer.routes}
                onChange={setActiveRoutes}
                onNotice={setNotice}
              />

              <RequestSimulator routes={activeServer.routes} />
            </>
          )}
        </div>

        <aside className="preview card">
          <header>
            <span>8</span>
            <div>
              <h2>生成的 Nginx 配置</h2>
              <p>完整输出全部 Server，可复制或下载</p>
            </div>
          </header>

          <div className="previewTabs">
            <b>完整配置</b>
            <span>{servers.length} Servers</span>
            <span>{totalRoutes} Locations</span>
            <span>{issues.length} Checks</span>
          </div>

          <pre><code>{config}</code></pre>

          {issues.length === 0 ? (
            <div className="status">✓ 基础校验通过，可以继续验证 nginx -t</div>
          ) : (
            <div className={`status ${hasErrors ? 'error' : 'warning'}`}>
              <strong>{hasErrors ? '发现需要修复的问题' : '配置可生成，但有提示'}</strong>
              <div className="issueList">
                {issues.slice(0, 8).map((issue, index) => (
                  <div key={`${issue.message}-${index}`} className={`issue ${issue.level}`}>
                    <span>
                      {issue.level === 'error' ? '×' : issue.level === 'warning' ? '!' : 'i'}
                    </span>
                    {issue.message}
                  </div>
                ))}
              </div>
            </div>
          )}

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
