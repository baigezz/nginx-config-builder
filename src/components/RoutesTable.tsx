import { useState } from 'react'
import { normalizePath } from '../lib/route-parser'
import type { LocationModifier, PathMode, ProxyRoute } from '../types/nginx'

interface RoutesTableProps {
  routes: ProxyRoute[]
  onChange: (routes: ProxyRoute[]) => void
  onNotice: (message: string) => void
}

export function RoutesTable({ routes, onChange, onNotice }: RoutesTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProxyRoute | null>(null)

  const beginEdit = (route: ProxyRoute) => {
    setEditingId(route.id)
    setDraft({ ...route })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
  }

  const saveEdit = () => {
    if (!draft) return

    const normalized = {
      ...draft,
      path: normalizePath(draft.path, draft.locationModifier),
      upstream: draft.upstream.trim(),
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

  return (
    <section className="card">
      <header>
        <span>4</span>
        <div>
          <h2>路由列表 <em>({routes.length} 条)</em></h2>
          <p>编辑 location、WebSocket、超时、上传限制和缓存策略</p>
        </div>
      </header>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>路径</th>
              <th>上游地址</th>
              <th>匹配方式</th>
              <th>能力</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <>
                <tr key={route.id}>
                  <td><code>{route.path}</code></td>
                  <td><code>{route.upstream}</code></td>
                  <td>
                    <span className="pill">
                      {route.locationModifier === 'exact'
                        ? '= 精确'
                        : route.locationModifier === 'prefer-prefix'
                          ? '^~ 优先前缀'
                          : route.pathMode === 'strip'
                            ? '前缀 · 去前缀'
                            : '前缀 · 保留'}
                    </span>
                  </td>
                  <td className="featureTags">
                    {route.websocket && <span>WS</span>}
                    {route.readTimeout && <span>Timeout</span>}
                    {route.clientMaxBodySize && <span>Upload</span>}
                    {route.disableCache && <span>No Cache</span>}
                    {!route.websocket && !route.readTimeout && !route.clientMaxBodySize && !route.disableCache && <i>默认</i>}
                  </td>
                  <td className="actions">
                    <button className="link" onClick={() => beginEdit(route)}>编辑</button>
                    <button className="danger" onClick={() => removeRoute(route.id)}>删除</button>
                  </td>
                </tr>

                {editingId === route.id && draft && (
                  <tr className="routeEditorRow" key={`${route.id}-editor`}>
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
                            Upstream
                            <input
                              value={draft.upstream}
                              onChange={(event) => setDraft({ ...draft, upstream: event.target.value })}
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
                              onChange={(event) =>
                                setDraft({ ...draft, pathMode: event.target.value as PathMode })
                              }
                            >
                              <option value="preserve">保留完整路径</option>
                              <option value="strip">移除匹配前缀</option>
                            </select>
                          </label>
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

                        <div className="editorGrid3">
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
                        </div>

                        <div className="editorActions">
                          <button className="secondary" onClick={cancelEdit}>取消</button>
                          <button className="primary" onClick={saveEdit}>保存路由</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
