import type { NginxServer } from '../types/nginx'

interface ServerManagerProps {
  servers: NginxServer[]
  activeServerId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
}

export function ServerManager({
  servers,
  activeServerId,
  onSelect,
  onAdd,
  onRemove,
}: ServerManagerProps) {
  const activeId = activeServerId || servers[0]?.id || ''

  return (
    <section className="card serverManagerCard">
      <header>
        <span>2</span>
        <div>
          <h2>Server 工作区 <em>({servers.length} 个)</em></h2>
          <p>每个 server 独立维护域名、TLS、路由和原始指令</p>
        </div>
      </header>

      <div className="serverTabs">
        {servers.map((server, index) => (
          <button
            key={server.id}
            className={server.id === activeId ? 'active' : ''}
            onClick={() => onSelect(server.id)}
          >
            <span>{server.sslEnabled ? '🔒' : '🌐'}</span>
            <span>
              <strong>{server.domain || `Server ${index + 1}`}</strong>
              <small>:{server.port} · {server.routes.length} routes</small>
            </span>
          </button>
        ))}
        <button className="addServer" onClick={onAdd}>+ 新建 Server</button>
      </div>

      {servers.length > 1 && activeId && (
        <div className="serverManagerActions">
          <button className="danger" onClick={() => onRemove(activeId)}>
            删除当前 Server
          </button>
        </div>
      )}
    </section>
  )
}
