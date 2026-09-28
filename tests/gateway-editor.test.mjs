import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectGatewaySource, planGatewayEdit } from '../src/lib/gateway-editor.ts'

const source = `server {
    listen 5003 ssl;
    server_name example.com;
    ssl_certificate /cert/site.crt;
    ssl_certificate_key /cert/site.key;
    access_by_lua_file /conf/access_check.lua;
    proxy_set_header Authorization "";
    proxy_set_header Host $proxy_host;

    location = /public {
        access_by_lua_block {
            return
        }
        proxy_pass http://backend:8989/public;
    }

    # 不匹配以上路径返回 404。
    location / {
        return 404;
    }
}
`

test('no pending paths returns the original source byte for byte', () => {
  assert.equal(planGatewayEdit(source, []).output, source)
  assert.equal(inspectGatewaySource(source).port, '5003')
})

test('public root and children keep existing Lua, headers, TLS and fallback', () => {
  const plan = planGatewayEdit(source, [{ path: '/new', scope: 'both', auth: 'skip' }])
  assert.equal(plan.added, 2)
  assert.equal(plan.output.match(/access_by_lua_block\s*\{/g)?.length, 3)
  assert.match(plan.output, /location = \/new \{[\s\S]*?proxy_pass http:\/\/backend:8989;/)
  assert.match(plan.output, /location \/new\/ \{[\s\S]*?proxy_pass http:\/\/backend:8989;/)
  assert.match(plan.output, /proxy_set_header Authorization "";/)
  assert.match(plan.output, /ssl_certificate \/cert\/site.crt;/)
  assert.ok(plan.output.indexOf('location /new/') < plan.output.indexOf('# 不匹配'))
})

test('equivalent existing location is skipped', () => {
  const plan = planGatewayEdit(source, [{ path: '/public', scope: 'root', auth: 'skip' }])
  assert.equal(plan.added, 0)
  assert.equal(plan.skipped, 1)
  assert.equal(plan.output, source)
})

test('conflicting authentication is rejected', () => {
  assert.throws(
    () => planGatewayEdit(source, [{ path: '/public', scope: 'root', auth: 'required' }]),
    /鉴权或上游冲突/,
  )
})

test('parameter path uses its fixed slash-boundary prefix', () => {
  const plan = planGatewayEdit(source, [{ path: '/api/items/{id}/detail', scope: 'children', auth: 'required' }])
  assert.match(plan.output, /location \/api\/items\/ \{/)
  assert.doesNotMatch(plan.output, /location \/api\/items\{/)
  assert.doesNotMatch(plan.output, /\{id\}/)
})

test('reserved and default reject servers cannot become business routes', () => {
  assert.throws(() => inspectGatewaySource(source.replace('        proxy_pass http://backend:8989/public;\n', '')), /没有唯一上游/)
  assert.throws(() => inspectGatewaySource('server {\n listen 4001 ssl default_server;\n server_name _;\n ssl_reject_handshake on;\n}\n'), /唯一的 listen/)
})
