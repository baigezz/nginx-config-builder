import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { parseNginxConfig } from '../lib/nginx-parser'
import type { NginxServer } from '../types/nginx'

const sampleConfig = `server {
  listen 80;
  server_name example.com;

  location /JSTMBSW/ {
    proxy_pass http://10.1.21.29:8871/JSTMBSW/;
  }

  location /preview {
    proxy_pass http://10.1.31.16:8000/preview;
  }

  location /tles-psp/api {
    proxy_pass http://10.1.21.27:17005/api;
  }
}

server {
  listen 443 ssl;
  server_name secure.example.com;
  ssl_certificate /etc/nginx/certs/site.crt;
  ssl_certificate_key /etc/nginx/certs/site.key;

  access_log /var/log/nginx/secure.access.log;

  location /api/ {
    proxy_pass http://127.0.0.1:8080/;
  }
}`

interface NginxImportProps {
  onReplace: (servers: NginxServer[]) => void
  onAppend: (servers: NginxServer[]) => void
  onNotice: (message: string) => void
}

function modeLabel(server: NginxServer, routeIndex: number) {
  const route = server.routes[routeIndex]
  if (!route) return ''
  if (route.pathMode === 'custom') return `URI → ${route.proxyPassUri}`
  if (route.proxyPassUri && route.proxyPassUri === route.path) return '显式保留 URI'
  return route.pathMode === 'strip' ? '去前缀' : '保留路径'
}

export function NginxImport({ onReplace, onAppend, onNotice }: NginxImportProps) {
  const [source, setSource] = useState(sampleConfig)
  const [parsedSource, setParsedSource] = useState('')
  const parsed = useMemo(
    () => (parsedSource ? parseNginxConfig(parsedSource) : null),
    [parsedSource],
  )

  const parse = () => {
    if (!source.trim()) {
      onNotice('请先粘贴 Nginx 配置')
      return
    }
    setParsedSource(source)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const text = await file.text()
    setSource(text)
    setParsedSource(text)
  }

  const routeCount = parsed?.servers.reduce(
    (sum, server) => sum + server.routes.length,
    0,
  ) ?? 0

  return (
    <section className="card importConfigCard">
      <header>
        <span>1</span>
        <div>
          <h2>导入现有 Nginx 配置</h2>
          <p>支持多 server、TLS、proxy_pass URI 映射和额外指令保留</p>
        </div>
      </header>

      <div className="nginxImportToolbar">
        <div>
          <strong>Stage 5 · Multi Server Import</strong>
          <span>相同 URI、去前缀和自定义 URI 映射都能识别</span>
        </div>
        <label className="fileButton">
          选择 .conf 文件
          <input type="file" accept=".conf,.nginx,text/plain" onChange={importFile} />
        </label>
      </div>

      <textarea
        className="nginxSource"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
      />

      <div className="importConfigActions">
        <button className="secondary" onClick={() => setSource('')}>清空</button>
        <button className="primary" onClick={parse}>解析配置</button>
      </div>

      {parsed && (
        <div className="parsePreview">
          <div className="parseSummary">
            <div><span>SERVER BLOCKS</span><strong>{parsed.servers.length}</strong></div>
            <div><span>ROUTES</span><strong>{routeCount}</strong></div>
            <div>
              <span>TLS</span>
              <strong>{parsed.servers.filter((server) => server.sslEnabled).length}</strong>
            </div>
          </div>

          <div className="parsedServerList">
            {parsed.servers.map((server) => (
              <div className="parsedServer" key={server.id}>
                <div className="parsedServerTitle">
                  <div>
                    <strong>{server.domain}</strong>
                    <small>
                      listen {server.port}{server.sslEnabled ? ' ssl' : ''} · {server.routes.length} routes
                    </small>
                  </div>
                  {(server.rawDirectives.length > 0 || server.rawBlocks.length > 0) && (
                    <b>
                      {server.rawDirectives.length + server.rawBlocks.length} raw
                    </b>
                  )}
                </div>

                {server.routes.slice(0, 6).map((route, routeIndex) => (
                  <div className="parsedRoute" key={route.id}>
                    <code>{route.path}</code>
                    <span>→</span>
                    <code>{route.upstream}{route.proxyPassUri}</code>
                    <b>{modeLabel(server, routeIndex)}</b>
                  </div>
                ))}
                {server.routes.length > 6 && (
                  <small className="moreRoutes">还有 {server.routes.length - 6} 条路由…</small>
                )}
              </div>
            ))}
          </div>

          {parsed.diagnostics.length > 0 && (
            <div className="parseDiagnostics">
              {parsed.diagnostics.map((item, index) => (
                <div className={item.level} key={`${item.message}-${index}`}>
                  <span>{item.level === 'warning' ? '!' : 'i'}</span>
                  {item.message}
                </div>
              ))}
            </div>
          )}

          <div className="parseApplyActions">
            <button
              className="secondary"
              disabled={!parsed.servers.length}
              onClick={() => {
                onAppend(parsed.servers)
                onNotice(`已追加 ${parsed.servers.length} 个 Server，共 ${routeCount} 条路由`)
              }}
            >
              追加为 Server
            </button>
            <button
              className="primary"
              disabled={!parsed.servers.length}
              onClick={() => {
                onReplace(parsed.servers)
                onNotice(`已用解析结果替换当前配置：${parsed.servers.length} 个 Server，${routeCount} 条路由`)
              }}
            >
              用解析结果替换全部
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
