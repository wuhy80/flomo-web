# flomo OAuth relay

一个只有 100 多行的 Cloudflare Worker，唯一的作用是**替浏览器完成 GitHub 的
授权码换令牌**。

## 为什么非要有它

GitHub 的 `POST /login/oauth/access_token` **不支持 CORS 预检**。原话在
[github/docs#22270](https://github.com/github/docs/issues/22270)：
*"CORS pre-flights are not supported on this endpoint ... authenticating from a
SPA is impossible without a service relay"*。

- **PKCE 解决不了这个问题。** GitHub 在 2025-07 支持了 PKCE，但它防的是授权码
  被截走，不改变"浏览器发不出这个请求"。
- **隐式流也不行。** GitHub 从来没有实现过。
- **设备流也不行。** `login/device/code` 同样跨域被挡。

所以纯静态站点想拿到 token，就必须有一个持有 `client_secret` 的地方替你换。
这个 Worker 就是那个地方，除此之外它什么都不做。

## 它刻意不做什么

| 不做 | 为什么重要 |
|---|---|
| **不接触密码或派生密钥** | 笔记仍然端到端加密。拿到 token 只能拿到密文 —— 和 PAT 泄露的后果完全一样 |
| **不代理 Contents API** | 浏览器依旧直接和 `api.github.com` 说话，存储层一行没改 |
| **不存任何东西** | 没有数据库、没有 cookie、没有会话表。每次请求自带 `code` 或 `refresh_token` |
| **不放行任何其他账号** | 见下 |

## 「只允许 wuhy80」是在这里执行的

关键点是**先验证、后返回**：

```
浏览器 ──code──▶ Worker ──code+secret──▶ GitHub
                    │                      │
                    │◀──── access_token ───┘
                    │
                    ├──▶ GET /user  ──▶ 这个 token 属于谁？
                    │
                    ├─ 是 wuhy80 ──▶ 返回 token
                    └─ 不是      ──▶ 403，token 就地丢弃
```

**为什么不能放到前端做**：只要 token 出现在任何响应体里，它就已经在浏览器里了
—— 用户能打开网络面板读出来。前端再判断一次只是表演。所以检查必须在 token
被写进响应**之前**发生，而那个位置只有这里。

配套地，前端拿到 token 后，`owner` 一律取自 Worker 返回的 `login`，从不取自
输入框 —— 所以"某个人的 code 变成了你的仓库主人"这件事没有路径可走。

## 部署（约 5 分钟）

### 1. 建 OAuth App

打开 <https://github.com/settings/applications/new>：

| 字段 | 填什么 |
|---|---|
| Application name | 随意，例如 `flomo-web` |
| Homepage URL | `https://wuhy80.github.io/flomo-web/` |
| Authorization callback URL | `https://wuhy80.github.io/flomo-web/` |

> 回调地址必须**精确**是站点地址（含结尾斜杠与否取决于你的 Pages 路径）。
> 它等于 `location.origin + location.pathname`，前端就是这么算的。

**另外强烈建议**：建好之后进入应用设置，把
**Expiring user tokens**（短时令牌）**关掉**。
GitHub 从 2026-08 起对新 OAuth App 默认启用 8 小时令牌，不关的话每天要重新登录
三次。关掉就是长期令牌，和传统 PAT 的体验一致。

（没关也能用：Worker 会透传 `refresh_token`，前端会在快过期时自动续期。
但关掉更简单，官方文档也是这么建议的。）

建好后记下 **Client ID** 和 **Client secret**。

### 2. 部署 Worker

```bash
cd relay
npx wrangler deploy
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

- `ALLOWED_ORIGIN` 和 `ALLOWED_LOGIN` 在 `wrangler.toml` 里，默认就是
  `https://wuhy80.github.io` 和 `wuhy80`。
- **`client_secret` 只作为 secret 存在 Cloudflare**，不进仓库、不进前端。
- 部署完 `wrangler` 会打印一个 `https://flomo-oauth-relay.<你的子域>.workers.dev`
  地址。

验证部署：

```bash
curl https://flomo-oauth-relay.<子域>.workers.dev/
# {"service":"flomo-oauth-relay","allowedLogin":"wuhy80","allowedOrigin":"https://wuhy80.github.io"}
```

### 3. 把两个值填进前端

编辑 `packages/web/src/oauth.ts`：

```ts
export const GITHUB_CLIENT_ID = 'Ov23li...'   // 第 1 步的 Client ID
export const RELAY_URL = 'https://flomo-oauth-relay.<子域>.workers.dev'
```

然后 `pnpm build` 并推送到 `main`，Pages 会自动发布。

> **两个值都是空的会发生什么？** 登录按钮不出现，站点行为和以前**完全一样**
> —— 手动填 PAT。这是刻意的：别人 fork 这个仓库时，不会看到一个点了会坏的按钮。

### 4. 用 `pnpm check:oauth` 确认配好了

```bash
pnpm check:oauth
```

它逐项检查：两个常量填了没、是不是 HTTPS、Client ID 形状对不对、中转是否
**真的在线**、以及中转报告的 `allowedLogin` / `allowedOrigin` 是否和你的站点
一致。全部通过才会说可以发布 —— 因为这几项里任何一项错了，症状都是
「点了登录，然后失败」，而失败原因只有打开控制台才看得见。

## 成本与安全边界

- **免费额度**：Cloudflare Workers 免费套餐每天 10 万次请求，登录一次用一次。
- **`repo` 权限比 PAT 大**：OAuth App 拿到的是"该账号所有私有仓库"的读写，
  而原来的细粒度 PAT 只限 `flomo-data` 的 Contents。这是"用 GitHub 登录"的真实
  代价，想避免只能改用 GitHub App（要额外的安装流程）。
- **中转挂了会怎样**：登录失败并显示原因；已经登录过的设备**不受影响**，
  因为 token 在本地，续期失败也只是等下次登录。
- **中转被攻陷会怎样**：攻击者拿到 `client_secret`，可以伪造别人的登录流程，
  但**拿不到任何笔记** —— 仓库里是密文，密码从不经过这里。

## 本地调试

```bash
cd relay
npx wrangler dev          # 本地起一个中转
```

然后把 `RELAY_URL` 指向 `http://localhost:8787`，并在 `wrangler.toml` 里把
`ALLOWED_ORIGIN` 临时改成 `http://localhost:5273`。

## 测试

```bash
node --test "relay/test/*.test.ts"     # 或根目录 pnpm test
```

测试覆盖的是**失败方向**：别的来源、别的账号、没有 state、GitHub 不肯说 token
属于谁、上游连不上 —— 因为一个错误的放行同样会返回 200，看不出来。
