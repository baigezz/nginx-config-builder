# Nginx Config Builder

一个面向常见反向代理场景的可视化 Nginx 配置生成与导入工具。

在线预览：

https://baigezz.github.io/nginx-config-builder/

## 当前能力

- 多 Server 工作区
- HTTPS / TLS 基础配置
- 批量创建 location
- 常用代理模板
- WebSocket、超时、上传大小、缓存配置
- 请求路径模拟
- CSV / JSON 路由导入
- 粘贴或上传现有 Nginx 配置反解析
- 未结构化 Server 指令保留
- 无法安全结构化的 location 以 Raw Block 继续保留

## 在页面编辑现有 OpenResty 配置

侧栏选择“配置文件批量编辑”，上传业务端口 `.conf`，或粘贴原文并填写导出文件名。可以在页面直接修改原文，也可以每行输入一条路径，选择匹配范围和 Lua 鉴权，再在表格中逐条调整。右侧显示改动和完整配置，下载时保留所选文件名。多个文件可分别导入、切换和下载；内容仅在当前页面内存中处理，刷新后需重新导入。

此模式从所选文件读取现有上游，只在 404 兜底前插入新 `location`，不会用普通生成器重排整份配置。支持根路径、子路径及二者同时匹配；`{id}` 等参数路径使用参数前固定前缀。公开路径生成局部 `access_by_lua_block`，受保护路径继承 server 层 Lua。重复规则会跳过；鉴权、上游或匹配规则冲突会停止该文件的下载。默认拒绝文件、预留端口及自定义 URI 映射等无法安全判断的情况需人工处理。

页面检查是静态检查。下载后仍需在完整 OpenResty 环境执行 `-t`，再按目标主机分别部署。

## proxy_pass URI 识别

工具会区分 Nginx 的不同 URI 语义，而不是只看 upstream 主机。

### 1. 不带 URI：保留完整请求路径

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080;
}
```

### 2. URI 为 `/`：移除 location 前缀

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/;
}
```

### 3. 显式 URI 映射

下面这种配置也会被结构化保存：

```nginx
location /JSTMBSW/ {
    proxy_pass http://10.1.21.29:8871/JSTMBSW/;
}

location /preview {
    proxy_pass http://10.1.31.16:8000/preview;
}

location /tles-psp/api {
    proxy_pass http://10.1.21.27:17005/api;
}
```

前两条属于显式保留 URI，最后一条属于自定义 URI 映射。

## Raw Block 保留策略

为了避免导入时静默丢失配置，以下内容如果暂时无法安全结构化，会保留并继续输出：

- 正则或命名 location
- 没有 `proxy_pass` 的 location
- 使用复杂或无法解析 `proxy_pass` 的 location
- 含嵌套 `if` / `limit_except` 等块的 location

Server 级无法结构化的普通指令，例如 `access_log`、`error_log`、`include`、`ssl_protocols` 等，也会作为原始指令保留。

> 注：注释和原始格式排版目前不会保证逐字节保留，目标优先是保留有效配置语义。

## 开发

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

项目使用 React + TypeScript + Vite，feature 分支和 Pull Request 会通过 GitHub Actions 自动执行构建校验。
