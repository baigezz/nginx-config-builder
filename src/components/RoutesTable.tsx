import { Fragment, useState } from 'react'
import { normalizePath } from '../lib/route-parser'
import type { LocationModifier, PathMode, ProxyRoute } from '../types/nginx'

interface RoutesTableProps {
  routes: ProxyRoute[]
  onChange: (routes: ProxyRoute[]) => void
  onNotice: (message: string) => void
}

function routeModeLabel(route: ProxyRoute) {
  if (route.pathMode === 'custom') return `URI → ${route.proxyPassUri}`
  if (route.proxyPassUri && route.proxyPassUri === route.path) return '保留 · 显式 URI'
  if (route.pathMode === 'strip') return '前缀 · 去前缀'
  return '前缀 · 保留'
}

export function RoutesTable({ routes, onChange, onNotice }: RoutesTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProxyRoute | null>(null)

  const beginEdit = (route: ProxyRoute) => {
    setEditingId(route.id)
    setDraft({ ...route, rawDirectives: [...route.rawDirectives] })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
  }

  const saveEdit = () => {
    if (!draft) return

    const normalized = {
      ...draft,
      path: normalizePath(draft.path),
      upstream: draft.upstream.trim().replace(/\/+$/, ''),
      proxyPassUri: draft.proxyPassUri.trim(),
      rawDirectives: draft.rawDirectives.map((item) => item.trim()).filter(Boolean),
    }

    const duplicate = routes.some(
      (route) =>
        route.id !== normalized.id &&
        route.locationModifier === normalized.locationModifier &&
        route.path === normalized.path,
    )

    if (duplicate) {
      onNotice(`无法保存：location ${normalized.path} 已存在`)
      return
    }

    onChange(routes.map((route) => (route.id === normalized.id ? normalized : route)))
    onNotice('路由已更新')
    cancelEdit()
  }

  const removeRoute = (id: string) => {
    onChange(routes.filter((route) => route.id !== id))
    if (editingId === id) cancelEdit()
  }

  const setPathMode = (mode: PathMode) => {
    if (!draft) return
    setDraft({
      ...draft,
      pathMode: mode,
      proxyPassUri:
        mode === 'preserve'
          ? ''
          : mode === 'strip'
            ? '/'
            : draft.proxyPassUri || '/',
    })
  }

  const setProxyPassUri = (value: string) => {
    if (!draft) return
    const mode: PathMode =
      !value
        ? 'preserve'
        : value === '/'
          ? 'strip'
          : value === draft.path
            ? 'preserve'
            : 'custom'

    setDraft({ ...draft, proxyPassUri: value, pathMode: mode })
  }

  return (
    <section className="card">
      <header>
        <span>6</span>
        <div>
          <h2>路由列表 <em>({routes.length} 条)</em></h2>
          <p>编辑 location、proxy_pass URI、WebSocket、超时和保留指令</p>
        </div>
      </header>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>路径</th>
              <th>Proxy Pass</th>
              <th>匹配 / URI</th>
              <th>能力</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <Fragment key={route.id}>
                <tr>
                  <td><code>{route.path}</code></td>
                  <td><code>{route.upstream}{route.proxyPassUri}</code></td>
                  <td>
                    <span className="pill">
                      {route.locationModifier === 'exact'
                        ? '= 精确 · '
                        : route.locationModifier === 'prefer-prefix'
                          ? '^~ · '
                          : ''}
                      {routeModeLabel(route)}
                    </span>
                  </td>
                  <td className="featureTags">
                    {route.websocket && <span>WS</span>}
                    {route.readTimeout && <span>Timeout</span>}
                    {route.clientMaxBodySize && <span>Upload</span>}
                    {route.disableCache && <span>No Cache</span>}
                    {route.rawDirectives.length > 0 && <span>Raw {route.rawDirectives.length}</span>}
                    {route.proxyPassUri && <span>URI</span>}
                    {!route.websocket &&
                      !route.readTimeout &&
                      !route.clientMaxBodySize &&
                      !route.disableCache &&
                      !route.rawDirectives.length &&
                      !route.proxyPassUri && <i>默认</i>}
                  </td>
                  <td className="actions">
                    <button className="link" onClick={() => beginEdit(route)}>编辑</button>
                    <button className="danger" onClick={() => removeRoute(route.id)}>删除</button>
                  </td>
                </tr>

                {editingId === route.id && draft && (
                  <tr className="routeEditorRow">
                    <td colSpan={5}>
                      <div className="routeEditor">
                        <div className="editorGrid2">
                          <label>
                            Location 路径
                            <input
                              value={draft.path}
                              onChange={(event) => setDraft({ ...draft, path: event.target.value })}
                            />
                          </label>
                          <label>
                            Upstream 主机
                            <input
                              value={draft.upstream}
                              onChange={(event) =>
                                setDraft({ ...draft, upstream: event.target.value })
                              }
                            />
                          </label>
                        </div>

                        <div className="editorGrid3">
                          <label>
                            匹配方式
                            <select
                              value={draft.locationModifier}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  locationModifier: event.target.value as LocationModifier,
                                })
                              }
                            >
                              <option value="prefix">普通前缀</option>
                              <option value="prefer-prefix">^~ 优先前缀</option>
                              <option value="exact">= 精确匹配</option>
                            </select>
                          </label>
                          <label>
                            路径转发
                            <select
                              value={draft.pathMode}
                              onChange={(event) => setPathMode(event.target.value as PathMode)}
                            >
                              <option value="preserve">保留完整路径</option>
                              <option value="strip">移除匹配前缀</option>
                              <option value="custom">自定义 URI 映射</option>
                            </select>
                          </label>
                          <label>
                            proxy_pass URI
                            <input
                              value={draft.proxyPassUri}
                              onChange={(event) => setProxyPassUri(event.target.value)}
                              placeholder="留空、/、/api 或与 location 相同"
                            />
                          </label>
                        </div>

                        <div className="editorGrid3">
                          <label>
                            上传大小
                            <input
                              value={draft.clientMaxBodySize}
                              onChange={(event) =>
                                setDraft({ ...draft, clientMaxBodySize: event.target.value })
                              }
                              placeholder="例如 50m"
                            />
                          </label>
                          <label>
                            Connect Timeout
                            <input
                              value={draft.connectTimeout}
                              onChange={(event) =>
                                setDraft({ ...draft, connectTimeout: event.target.value })
                              }
                              placeholder="例如 5s"
                            />
                          </label>
                          <label>
                            Read Timeout
                            <input
                              value={draft.readTimeout}
                              onChange={(event) =>
                                setDraft({ ...draft, readTimeout: event.target.value })
                              }
                              placeholder="例如 60s"
                            />
                          </label>
                        </div>

                        <div className="editorGrid2">
                          <label>
                            Send Timeout
                            <input
                              value={draft.sendTimeout}
                              onChange={(event) =>
                                setDraft({ ...draft, sendTimeout: event.target.value })
                              }
                              placeholder="例如 60s"
                            />
                          </label>
                          <label>
                            保留的原始指令（每行一条）
                            <textarea
                              value={draft.rawDirectives.join('\n')}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  rawDirectives: event.target.value.split(/\r?\n/),
                                })
                              }
                              placeholder="proxy_set_header X-Custom $http_x_custom;"
                            />
                          </label>
                        </div>

                        <div className="toggleRow">
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.websocket}
                              onChange={(event) =>
                                setDraft({ ...draft, websocket: event.target.checked })
                              }
                            />
                            WebSocket
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.disableCache}
                              onChange={(event) =>
                                setDraft({ ...draft, disableCache: event.target.checked })
                              }
                            />
                            proxy_cache off
                          </label>
                        </div>

                        <div className="editorActions">
                          <button className="secondary" onClick={cancelEdit}>取消</button>
                          <button className="primary" onClick={saveEdit}>保存路由</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
