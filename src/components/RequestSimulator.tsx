import { useMemo, useState } from 'react'
import { simulateRequest } from '../lib/nginx-generator'
import type { ProxyRoute } from '../types/nginx'

interface RequestSimulatorProps {
  routes: ProxyRoute[]
}

export function RequestSimulator({ routes }: RequestSimulatorProps) {
  const [requestPath, setRequestPath] = useState('/api/items/1')
  const result = useMemo(
    () => simulateRequest(requestPath, routes),
    [requestPath, routes],
  )

  return (
    <section className="card simulatorCard">
      <header>
        <span>7</span>
        <div>
          <h2>请求路径模拟器</h2>
          <p>包含显式 proxy_pass URI 的替换结果</p>
        </div>
      </header>

      <label>
        请求路径
        <input
          value={requestPath}
          onChange={(event) => setRequestPath(event.target.value)}
          placeholder="/api/users/42"
        />
      </label>

      {result.matchedRoute ? (
        <div className="simulationResult">
          <div>
            <span>匹配 location</span>
            <code>{result.matchedRoute.path}</code>
          </div>
          <div>
            <span>转发模式</span>
            <strong>
              {result.matchedRoute.pathMode === 'custom'
                ? '自定义 URI 映射'
                : result.matchedRoute.pathMode === 'strip'
                  ? '去前缀'
                  : '保留完整路径'}
            </strong>
          </div>
          {result.matchedRoute.proxyPassUri && (
            <div>
              <span>proxy_pass URI</span>
              <code>{result.matchedRoute.proxyPassUri}</code>
            </div>
          )}
          <div className="simulationTarget">
            <span>最终 upstream</span>
            <code>{result.upstreamUrl}</code>
          </div>
        </div>
      ) : (
        <div className="simulationEmpty">当前 Server 没有 location 能匹配这个请求。</div>
      )}

      <p className="simulationHint">
        模拟器覆盖精确匹配、前缀匹配和 proxy_pass URI 替换；正则 location 仍会保留为导入提示。
      </p>
    </section>
  )
}
