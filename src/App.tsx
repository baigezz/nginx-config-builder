import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import { PresetPicker } from './components/PresetPicker'
import { RequestSimulator } from './components/RequestSimulator'
import { RoutesTable } from './components/RoutesTable'
import { presets } from './data/presets'
import { generateNginxConfig } from './lib/nginx-generator'
import { createRoute, parseBulkRoutes, parseCsv, parseJson } from './lib/route-parser'
import { validateConfig } from './lib/validator'
import type { NginxPreset, PathMode, ProxyRoute, ServerConfig } from './types/nginx'

const starterPaths = `/psp-tmis-ai-mobile/
/psp-tmis-base-mobile/
/psp-tmis-net-taxi-mobile/`

function App() {
  const [domain, setDomain] = useState('example.com')
  const [port, setPort] = useState('80')
  const [input, setInput] = useState(starterPaths)
  const [defaultUpstream, setDefaultUpstream] = useState('http://10.0.0.20:8080')
  const [pathMode, setPathMode] = useState<PathMode>('preserve')
  const [routes, setRoutes] = useState<ProxyRoute[]>(() =>
    parseBulkRoutes(starterPaths, 'http://10.0.0.20:8080', 'preserve'),
  )
  const [notice, setNotice] = useState('')

  const server = useMemo(() => ({ domain, port }), [domain, port])
  const config = useMemo(() => generateNginxConfig(server, routes), [server, routes])
  const issues = useMemo(() => validateConfig(server, routes), [server, routes])
  const hasErrors = issues.some((issue) => issue.level === 'error')

  const mergeRoutes = (incoming: ProxyRoute[]) => {
    const seen = new Set(
      routes.map((route) => `${route.locationModifier}:${route.path}`),
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

    setRoutes((current) => [...current, ...accepted])
    setNotice(
      duplicates.length
        ? `已添加 ${accepted.length} 条，跳过 ${duplicates.length} 条重复 location：${duplicates.join('、')}`
        : `已添加 ${accepted.length} 条路由`,
    )
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
    anchor.download = `${domain || 'nginx'}.conf`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Nginx 配置文件已生成下载')
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
          <button className="active">常用模板</button>
          <button>自定义配置</button>
          <button>导入现有配置</button>
        </nav>

        <div className="tip">
          <strong>💡 Stage 3</strong>
          <p>模板、路由高级配置和请求模拟已经加入。下一阶段会支持反解析已有 Nginx。</p>
        </div>
      </aside>

      <section className="workspace">
        <div className="formArea">
          <section className="card">
            <header>
              <span>1</span>
              <div>
                <h2>常用模板</h2>
                <p>快速加入常见代理场景，再按实际环境微调</p>
              </div>
            </header>
            <PresetPicker presets={presets} onApply={applyPreset} />
          </section>

          <section className="card">
            <header>
              <span>2</span>
              <div>
                <h2>Server 基础配置</h2>
                <p>设置域名和监听端口</p>
              </div>
            </header>
            <div className="grid2">
              <label>
                域名 (server_name)
                <input value={domain} onChange={(event) => setDomain(event.target.value)} />
              </label>
              <label>
                监听端口
                <input value={port} onChange={(event) => setPort(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="card">
            <header>
              <span>3</span>
              <div>
                <h2>批量代理路由</h2>
                <p>粘贴或导入，一次生成多个 location</p>
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
              <span>CSV: path, upstream, pathMode, websocket</span>
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
                  <legend>路径转发方式</legend>
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
                  + 解析并添加到列表
                </button>
              </div>
            </div>

            {notice && <div className="notice">{notice}</div>}
          </section>

          <RoutesTable routes={routes} onChange={setRoutes} onNotice={setNotice} />

          <RequestSimulator routes={routes} />
        </div>

        <aside className="preview card">
          <header>
            <span>6</span>
            <div>
              <h2>生成的 Nginx 配置</h2>
              <p>实时预览，可复制或下载</p>
            </div>
          </header>

          <div className="previewTabs">
            <b>完整配置</b>
            <span>{routes.length} Locations</span>
            <span>{issues.length} Checks</span>
          </div>

          <pre><code>{config}</code></pre>

          {issues.length === 0 ? (
            <div className="status">✓ 基础校验通过，可以继续验证 nginx -t</div>
          ) : (
            <div className={`status ${hasErrors ? 'error' : 'warning'}`}>
              <strong>{hasErrors ? '发现需要修复的问题' : '配置可生成，但有提示'}</strong>
              <div className="issueList">
                {issues.slice(0, 6).map((issue, index) => (
                  <div key={`${issue.message}-${index}`} className={`issue ${issue.level}`}>
                    <span>{issue.level === 'error' ? '×' : issue.level === 'warning' ? '!' : 'i'}</span>
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
