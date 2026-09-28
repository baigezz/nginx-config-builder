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
location /catalog/ {
    proxy_pass http://backend.example.com/catalog/;
}

location /reports {
    proxy_pass http://reports.example.com/reports;
}

location /service/api {
    proxy_pass http://api.example.com/v1;
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
