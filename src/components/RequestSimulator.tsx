import { useMemo, useState } from 'react'
import { simulateRequest } from '../lib/nginx-generator'
import type { ProxyRoute } from '../types/nginx'

interface RequestSimulatorProps {
  routes: ProxyRoute[]
}

export function RequestSimulator({ routes }: RequestSimulatorProps) {
  const [requestPath, setRequestPath] = useState('/psp-tmis-ai-mobile/user/list')
  const result = useMemo(
    () => simulateRequest(requestPath, routes),
    [requestPath, routes],
  )

  return (
    <section className="card simulatorCard">
      <header>
        <span>6</span>
        <div>
          <h2>请求路径模拟器</h2>
          <p>预览 Nginx 会匹配哪条 location，以及最终转发到哪里</p>
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
            <span>路径模式</span>
            <strong>{result.matchedRoute.pathMode === 'strip' ? '去前缀' : '保留完整路径'}</strong>
          </div>
          <div className="simulationTarget">
            <span>最终 upstream</span>
            <code>{result.upstreamUrl}</code>
          </div>
        </div>
      ) : (
        <div className="simulationEmpty">当前没有 location 能匹配这个请求。</div>
      )}

      <p className="simulationHint">
        当前模拟器覆盖精确匹配和前缀匹配；正则 location 会在后续高级模式中加入。
      </p>
    </section>
  )
}
