import type { NginxPreset, RouteSeed } from '../types/nginx'

const defaults: Omit<RouteSeed, 'path' | 'upstream'> = {
  pathMode: 'preserve',
  proxyPassUri: '',
  locationModifier: 'prefix',
  websocket: false,
  connectTimeout: '',
  readTimeout: '',
  sendTimeout: '',
  clientMaxBodySize: '',
  disableCache: false,
  rawDirectives: [],
}

export const presets: NginxPreset[] = [
  {
    id: 'nextjs',
    name: 'Next.js / Node',
    description: '把整站流量代理到本机 3000 端口。',
    badge: 'Web App',
    routes: [{ ...defaults, path: '/', upstream: 'http://127.0.0.1:3000' }],
  },
  {
    id: 'spa-dev',
    name: 'React / Vue Dev',
    description: '开发环境常用的 SPA dev server 代理。',
    badge: 'SPA',
    routes: [{ ...defaults, path: '/', upstream: 'http://127.0.0.1:5173' }],
  },
  {
    id: 'api-gateway',
    name: 'API 去前缀',
    description: '/api/users 转发成上游 /users。',
    badge: 'API',
    routes: [
      {
        ...defaults,
        path: '/api/',
        upstream: 'http://127.0.0.1:8080',
        pathMode: 'strip',
      },
    ],
  },
  {
    id: 'websocket',
    name: 'WebSocket',
    description: '预置 Upgrade / Connection 相关配置。',
    badge: 'Realtime',
    routes: [
      {
        ...defaults,
        path: '/ws/',
        upstream: 'http://127.0.0.1:3000',
        websocket: true,
        readTimeout: '60s',
      },
    ],
  },
  {
    id: 'mobile-services',
    name: '移动端微服务',
    description: '一次生成 ai / base / net-taxi 三条代理路由。',
    badge: 'Batch',
    routes: [
      { ...defaults, path: '/psp-tmis-ai-mobile/', upstream: 'http://10.0.0.20:8080' },
      { ...defaults, path: '/psp-tmis-base-mobile/', upstream: 'http://10.0.0.20:8080' },
      { ...defaults, path: '/psp-tmis-net-taxi-mobile/', upstream: 'http://10.0.0.20:8080' },
    ],
  },
]
