import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { parseNginxConfig } from '../lib/nginx-parser'
import type { ProxyRoute, ServerConfig } from '../types/nginx'

const sampleConfig = `server {
  listen 80;
  server_name example.com;

  location /api/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_read_timeout 60s;
    client_max_body_size 50m;
  }

  location ^~ /ws/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}`

interface NginxImportProps {
  onReplace: (server: ServerConfig, routes: ProxyRoute[]) => void
  onAppend: (routes: ProxyRoute[]) => void
  onNotice: (message: string) => void
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

  return (
    <section className="card importConfigCard">
      <header>
        <span>1</span>
        <div>
          <h2>导入现有 Nginx 配置</h2>
          <p>粘贴 server 配置，自动转换成可编辑的路由数据</p>
        </div>
      </header>

      <div className="nginxImportToolbar">
        <div>
          <strong>Stage 4 · Reverse Parse</strong>
          <span>当前优先支持常见 reverse proxy 配置</span>
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
            <div><span>server_name</span><strong>{parsed.server.domain}</strong></div>
            <div><span>listen</span><strong>{parsed.server.port}</strong></div>
            <div><span>可导入路由</span><strong>{parsed.routes.length}</strong></div>
          </div>

          {parsed.routes.length > 0 && (
            <div className="parsedRoutes">
              {parsed.routes.slice(0, 6).map((route) => (
                <div key={route.id}>
                  <code>{route.path}</code>
                  <span>→</span>
                  <code>{route.upstream}</code>
                  <b>{route.pathMode === 'strip' ? '去前缀' : '保留路径'}</b>
                </div>
              ))}
              {parsed.routes.length > 6 && <small>还有 {parsed.routes.length - 6} 条路由…</small>}
            </div>
          )}

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
              disabled={!parsed.routes.length}
              onClick={() => {
                onAppend(parsed.routes)
                onNotice(`已追加 ${parsed.routes.length} 条解析路由`)
              }}
            >
              追加到当前配置
            </button>
            <button
              className="primary"
              disabled={!parsed.routes.length}
              onClick={() => {
                onReplace(parsed.server, parsed.routes)
                onNotice(`已用解析结果替换当前配置，共 ${parsed.routes.length} 条路由`)
              }}
            >
              用解析结果替换
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
