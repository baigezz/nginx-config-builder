import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  inspectGatewaySource,
  planGatewayEdit,
} from '../lib/gateway-editor'
import type { GatewayAuth, GatewayRouteInput, GatewayScope } from '../lib/gateway-editor'

interface SourceFile {
  id: string
  name: string
  original: string
  source: string
}

interface DraftRoute extends GatewayRouteInput {
  id: string
  fileId: string
}

function changedLines(before: string, after: string) {
  if (before === after) return '无改动'
  const oldLines = before.split(/\r?\n/)
  const newLines = after.split(/\r?\n/)
  let first = 0
  while (first < oldLines.length && first < newLines.length && oldLines[first] === newLines[first]) first += 1
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > first && newEnd > first && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  return [
    `@@ 第 ${first + 1} 行附近 @@`,
    ...oldLines.slice(first, oldEnd).map((line) => `- ${line}`),
    ...newLines.slice(first, newEnd).map((line) => `+ ${line}`),
  ].join('\n')
}

function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function GatewayWorkspace() {
  const [files, setFiles] = useState<SourceFile[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [routes, setRoutes] = useState<DraftRoute[]>([])
  const [batch, setBatch] = useState('')
  const [batchScope, setBatchScope] = useState<GatewayScope>('root')
  const [batchAuth, setBatchAuth] = useState<GatewayAuth>('required')
  const [pastedName, setPastedName] = useState('')
  const [pastedSource, setPastedSource] = useState('')
  const [previewMode, setPreviewMode] = useState<'diff' | 'full'>('diff')
  const [notice, setNotice] = useState('')

  const selected = files.find((file) => file.id === selectedId) ?? files[0]
  const selectedRoutes = routes.filter((route) => route.fileId === selected?.id)
  const planned = useMemo(() => {
    if (!selected) return null
    try {
      const plan = planGatewayEdit(selected.source, selectedRoutes)
      const namedPort = selected.name.match(/-(\d+)\.conf$/)?.[1]
      if (namedPort && namedPort !== plan.info.port) {
        throw new Error(`文件名端口与 listen ${plan.info.port} 不一致`)
      }
      return { plan, error: '' }
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : '配置无法解析' }
    }
  }, [selected, selectedRoutes])

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])]
    event.target.value = ''
    const accepted: SourceFile[] = []
    const rejected: string[] = []
    const known = new Set(files.map((file) => file.name))
    for (const file of chosen) {
      if (!file.name.endsWith('.conf') || known.has(file.name)) {
        rejected.push(`${file.name}：文件名重复或不是 .conf`)
        continue
      }
      try {
        const source = await file.text()
        const info = inspectGatewaySource(source)
        const namedPort = file.name.match(/-(\d+)\.conf$/)?.[1]
        if (namedPort && namedPort !== info.port) throw new Error(`文件名端口与 listen ${info.port} 不一致`)
        accepted.push({ id: crypto.randomUUID(), name: file.name, original: source, source })
        known.add(file.name)
      } catch (error) {
        rejected.push(`${file.name}：${error instanceof Error ? error.message : '读取失败'}`)
      }
    }
    if (accepted.length) {
      setFiles((current) => [...current, ...accepted])
      setSelectedId(accepted[0].id)
    }
    setNotice([
      accepted.length ? `已导入 ${accepted.length} 个业务配置文件` : '',
      ...rejected,
    ].filter(Boolean).join('；'))
  }

  const importPasted = () => {
    const name = pastedName.trim()
    if (!name.endsWith('.conf') || files.some((file) => file.name === name)) {
      setNotice('请填写一个未导入的 .conf 文件名')
      return
    }
    try {
      const info = inspectGatewaySource(pastedSource)
      const namedPort = name.match(/-(\d+)\.conf$/)?.[1]
      if (namedPort && namedPort !== info.port) throw new Error(`文件名端口与 listen ${info.port} 不一致`)
      const file = { id: crypto.randomUUID(), name, original: pastedSource, source: pastedSource }
      setFiles((current) => [...current, file])
      setSelectedId(file.id)
      setPastedName('')
      setPastedSource('')
      setNotice(`已导入 ${name}`)
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : '配置无法解析'}`)
    }
  }

  const addBatch = () => {
    if (!selected) return
    const paths = batch.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) =>
      line.replace(/^[-*]\s+/, '').replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, ''),
    )
    if (!paths.length) {
      setNotice('请先输入路径，每行一条')
      return
    }
    const additions: DraftRoute[] = paths.map((path) => ({
      id: crypto.randomUUID(),
      fileId: selected.id,
      path,
      scope: /\{[^{}]+\}/.test(path) ? 'children' : batchScope,
      auth: batchAuth,
    }))
    try {
      planGatewayEdit(selected.source, [...selectedRoutes, ...additions])
      setRoutes((current) => [...current, ...additions])
      setBatch('')
      setNotice(`已加入 ${additions.length} 条路径，可在下方逐条修改`)
    } catch (error) {
      setNotice(`未添加：${error instanceof Error ? error.message : '路径无法解析'}`)
    }
  }

  const updateRoute = (id: string, patch: Partial<DraftRoute>) => {
    setRoutes((current) => current.map((route) => route.id === id ? { ...route, ...patch } : route))
  }

  const updateSource = (source: string) => {
    if (!selected) return
    setFiles((current) => current.map((file) => file.id === selected.id ? { ...file, source } : file))
  }

  const download = () => {
    if (!selected || !planned?.plan) return
    downloadText(selected.name, planned.plan.output)
    setNotice(`已下载 ${selected.name}；部署前仍需在目标环境执行 OpenResty -t`)
  }

  return (
    <section className="gatewayWorkspace">
      <div className="formArea">
        <section className="card">
          <header>
            <span>1</span>
            <div>
              <h2>导入业务端口配置</h2>
              <p>可选择多个 .conf；文件内容只在当前浏览器页面处理</p>
            </div>
          </header>
          <div className="gatewayToolbar">
            <label className="fileButton">
              选择 .conf 文件
              <input type="file" multiple accept=".conf,text/plain" onChange={importFiles} />
            </label>
            {files.length > 0 && <span>已导入 {files.length} 个文件</span>}
          </div>
          <details className="gatewayPaste">
            <summary>或粘贴现有配置</summary>
            <label>
              导出文件名
              <input value={pastedName} onChange={(event) => setPastedName(event.target.value)} placeholder="site-5003.conf" />
            </label>
            <label>
              配置内容
              <textarea value={pastedSource} onChange={(event) => setPastedSource(event.target.value)} placeholder="server { ... }" spellCheck={false} />
            </label>
            <button className="secondary" onClick={importPasted}>导入粘贴内容</button>
          </details>
          {files.length > 0 && (
            <label className="gatewayFileSelect">
              当前编辑文件
              <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
                {files.map((file) => <option value={file.id} key={file.id}>{file.name}</option>)}
              </select>
            </label>
          )}
          {planned?.plan && (
            <div className="gatewayFacts">
              <span>入口：{planned.plan.info.domain}:{planned.plan.info.port}</span>
              <span>上游：{planned.plan.info.upstream}</span>
              <span>已有 location：{planned.plan.info.locationCount}</span>
            </div>
          )}
        </section>

        {selected && (
          <>
            <section className="card">
              <header>
                <span>2</span>
                <div>
                  <h2>批量加入路径</h2>
                  <p>每行一条；带 {'{id}'} 的路径使用参数前的固定前缀</p>
                </div>
              </header>
              <label>
                路径清单
                <textarea
                  className="gatewayBatch"
                  value={batch}
                  onChange={(event) => setBatch(event.target.value)}
                  placeholder={'/api/example\n/api/items/{id}/detail'}
                />
              </label>
              <div className="gatewayControls">
                <label>
                  匹配范围
                  <select value={batchScope} onChange={(event) => setBatchScope(event.target.value as GatewayScope)}>
                    <option value="root">仅根路径</option>
                    <option value="children">仅子路径</option>
                    <option value="both">根路径和子路径</option>
                  </select>
                </label>
                <label>
                  Lua 鉴权
                  <select value={batchAuth} onChange={(event) => setBatchAuth(event.target.value as GatewayAuth)}>
                    <option value="required">需要拦截</option>
                    <option value="skip">不用拦截</option>
                  </select>
                </label>
                <button className="primary" onClick={addBatch}>加入待生成列表</button>
              </div>
              {selectedRoutes.length > 0 && (
                <div className="tableWrap gatewayRoutes">
                  <table>
                    <thead><tr><th>路径</th><th>范围</th><th>鉴权</th><th /></tr></thead>
                    <tbody>
                      {selectedRoutes.map((route) => (
                        <tr key={route.id}>
                          <td><input aria-label="路径" value={route.path} onChange={(event) => updateRoute(route.id, { path: event.target.value })} /></td>
                          <td>
                            <select aria-label="匹配范围" value={route.scope} onChange={(event) => updateRoute(route.id, { scope: event.target.value as GatewayScope })}>
                              <option value="root">仅根路径</option>
                              <option value="children">仅子路径</option>
                              <option value="both">根路径和子路径</option>
                            </select>
                          </td>
                          <td>
                            <select aria-label="Lua 鉴权" value={route.auth} onChange={(event) => updateRoute(route.id, { auth: event.target.value as GatewayAuth })}>
                              <option value="required">需要拦截</option>
                              <option value="skip">不用拦截</option>
                            </select>
                          </td>
                          <td><button className="danger" aria-label="删除路径" onClick={() => setRoutes((current) => current.filter((item) => item.id !== route.id))}>删除</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <header>
                <span>3</span>
                <div>
                  <h2>直接编辑原始配置</h2>
                  <p>原有 Lua、TLS、代理头和注释会保留；此处的手工改动也进入最终文件</p>
                </div>
              </header>
              <textarea
                className="gatewaySource"
                aria-label="原始配置"
                spellCheck={false}
                value={selected.source}
                onChange={(event) => updateSource(event.target.value)}
              />
            </section>
          </>
        )}
        {notice && <div className="notice" role="status">{notice}</div>}
      </div>

      <aside className="preview card gatewayPreview">
        <header>
          <span>4</span>
          <div>
            <h2>文件预览与下载</h2>
            <p>仅下载当前文件，名称保持不变</p>
          </div>
        </header>
        {selected ? (
          <>
            <div className="previewTabs gatewayTabs">
              <button className={previewMode === 'diff' ? 'active' : ''} onClick={() => setPreviewMode('diff')}>改动</button>
              <button className={previewMode === 'full' ? 'active' : ''} onClick={() => setPreviewMode('full')}>完整配置</button>
              {planned?.plan && <span>新增 {planned.plan.added} · 跳过重复 {planned.plan.skipped}</span>}
            </div>
            {planned?.error ? (
              <div className="status error">{planned.error}</div>
            ) : (
              <>
                <pre><code>{previewMode === 'diff'
                  ? changedLines(selected.original, planned?.plan?.output ?? selected.source)
                  : planned?.plan?.output}</code></pre>
                <div className="status">已完成静态检查；下载后请用完整 OpenResty 环境执行 -t</div>
              </>
            )}
            <div className="previewActions">
              <button className="primary" disabled={!planned?.plan} onClick={download}>下载 {selected.name}</button>
              <button className="secondary" disabled={!planned?.plan} onClick={() => {
                if (planned?.plan) navigator.clipboard.writeText(planned.plan.output).then(() => setNotice('配置已复制'))
              }}>复制配置</button>
            </div>
          </>
        ) : (
          <p className="gatewayEmpty">先导入一个业务端口的 .conf 文件，再在页面编辑和预览。</p>
        )}
      </aside>
    </section>
  )
}
