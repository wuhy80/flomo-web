# flomo-sim

一个参考 [flomo](https://flomoapp.com) 的极简笔记应用：**数据端到端加密后存在你自己的 GitHub 私有仓库**，既能当静态网站用，也能作为 DeepSeek Harness 的侧边栏面板直接查看和记录。

- **零服务器**：站点是纯静态的，部署到 GitHub Pages 免费
- **真加密**：密码即密钥（PBKDF2-SHA256 60 万次 → AES-256-GCM），仓库里只有密文
- **两套外壳，一套内核**：网页版和 DSH 面板共用同一个 `@flomo/core` 与 `@flomo/ui`
- **Agent 可读写**：装上 DSH 插件后，对话里说「记一条」就能落库

---

## 为什么是"客户端加密"而不是"登录"

GitHub Pages 是纯静态托管，**没有服务端，因此做不了真正的登录**。任何"输入密码 → 跳转"的纯前端写法，密码都躺在 JS 源码里，等于没有。

所以这里换了个思路：不做「登录」，做「**解密**」。

```
密码 ──PBKDF2-SHA256(600k, 随机 salt)──▶ AES-256-GCM 密钥
                                            │
                          密文 shard ◀──────┘  解密成功 == 密码正确
```

- 站点壳公开，但里面没有任何数据
- 仓库里是密文；AES-GCM 自带认证标签，密码错了根本解不出来
- **连 GitHub 自己都读不了你的笔记**
- 不需要单独存密码哈希 —— 解密成功本身就是验证，没有额外的 hash oracle 可打

### 安全性质

> **PAT 泄露 ≠ 笔记泄露。**

即使有人从浏览器里偷到你的 GitHub token，他拿到的也只是密文文件，还需要你的密码 ——
而密码从不离开你的设备，也从不写进任何仓库。

### 诚实的代价

- **忘记密码 = 数据永久丢失**。所以首次创建保险库时会生成一个**恢复码**（原始密钥的 base64）。请抄写到密码管理器或纸上，**不要**放进这个仓库。
- 单人使用无并发问题；多设备同时写同一月份会有 git 冲突，此时会提示重试而不是静默丢数据。

---

## 架构

```
公开仓库（本站点，GitHub Pages）
  └─ 只有站点壳 + 密码框，无任何数据
        │  解锁后，浏览器内解密 + 读写
        ▼
私有仓库 flomo-data           ← 只当存储，不涉及 Pages，所以免费
  ├─ vault.json               KDF 参数 + 一段已知明文的密文（无秘密，可公开）
  └─ data/2025-06.json        按月分片的密文
        ▲  共用同一个 core
        │
DSH 插件 dsh-flomo
  ├─ host 面：vault + PAT + 解密密钥 + agent 工具
  └─ client 面：侧栏图标 + 中央全页 flomo 面板
```

**每月一个分片**的理由：单文件写爆 1MB 后 GitHub Contents API 会变慢；分片后每次只改一个月，diff 干净、冲突面小。

**没有索引文件**：月份列表来自目录列举，这样两台设备写不同月份时永远不会争抢同一个可变文件。

---

## 快速开始（网页版）

```bash
pnpm install
pnpm dev            # http://localhost:5273
```

首次打开会让你填：

| 字段 | 说明 |
|---|---|
| GitHub 用户名 | 你的账号 |
| 私有仓库名 | 例如 `flomo-data`（**必须私有**） |
| 分支 | 可留空 |
| PAT | 细粒度令牌，权限只要 `Contents: Read and write`，范围限定这一个仓库 |

在 GitHub 的 **Settings → Developer settings → Fine-grained tokens** 创建。
`vault.json` 不存在时，下一步会让你**创建保险库**并设置密码。

### 部署到 GitHub Pages

1. 推到一个公开仓库，`main` 分支
2. Settings → Pages → Source 选 **GitHub Actions**
3. `.github/workflows/deploy.yml` 会自动构建并发布

`vite.config.ts` 里用了 `base: './'`，所以域名根路径和 `/仓库名/` 子路径都能直接用。

> ⚠️ **站点壳仓库可以公开，数据仓库必须私有。** 私有仓库不享受免费 Pages，
> 但这里的数据仓库根本不走 Pages，只当存储用，所以依然免费。

---

## 安装 DSH 插件

插件是双面的：host 面在 DSH 进程里持有 PAT、密钥和解密后的笔记；client 面只是在 Web GUI 里渲染。

```bash
pnpm build:plugin          # 产出 packages/dsh-plugin/lib/{index.js,client.js}
```

然后用插件管理器以 `link:` 方式装进 profile：

```
plugin_manager install_bundle  target = link:D:\code\flomo-sim\packages\dsh-plugin
```

装好后侧边栏会多出一个 **flomo** 图标，点开就是完整的 flomo 界面（和网页版是同一套 UI）。

### 配置与凭据

面板首次打开会让你填仓库与 token。它们分别落在：

| 内容 | 位置 |
|---|---|
| owner / repo / branch | `~/.dsh/flomo.json`（无秘密） |
| PAT | DSH 凭据中心的 `FLOMO_GITHUB_TOKEN` |
| 密码（**可选**） | DSH 凭据中心的 `FLOMO_PASSWORD` |

**密码默认不保存。** 面板里解锁后，密钥只存在于 host 内存中，DSH 重启后需要重新解锁 ——
这是更安全的默认值。如果你希望 agent 工具在你没解锁时也能读写（比如定时任务），
再设置 `FLOMO_PASSWORD`：

```
dsh credentials set FLOMO_PASSWORD
```

### Agent 工具

| 工具 | 作用 |
|---|---|
| `flomo_add` | 记一条（`#标签` 写在正文里自动解析） |
| `flomo_search` | 全文搜索，可按标签过滤 |
| `flomo_recent` | 最近 N 条 |
| `flomo_daily_review` | 每日回顾（当天固定，排除最近两天） |
| `flomo_tags` | 标签统计 |
| `flomo_random` | 随机漫步 |

于是你可以直接说「把这条记到 flomo」或者「我上周记了什么关于架构的」。

> `flomo_add` 在返回成功前就已经加密并推到 GitHub，所以成功即持久化。

---

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动网页版开发服务器 |
| `pnpm build` | 构建网页版（`packages/web/dist`） |
| `pnpm build:plugin` | 构建 DSH 插件两半 |
| `pnpm watch:plugin` | 监听模式重建插件 |
| `pnpm test` | 跑 core 与插件 host 的测试 |
| `pnpm typecheck` | 全仓类型检查 |

---

## 目录结构

```
packages/
├─ core/        零依赖内核：加密、Memo 模型、#标签解析、按月分片、GitHub 存储
│  └─ testing.ts   内存版仓库，两个测试套件共用
├─ ui/          flomo 风格 React 组件与样式，网页版和面板共用
├─ web/         Vite 应用 + Pages 部署
└─ dsh-plugin/  dsh-flomo 双面插件
   ├─ src/index.ts      host 入口：注册路由与 agent 工具
   ├─ src/routes.ts     两个路由 + 一道守卫
   ├─ src/client/       侧栏图标 + 中央面板
   └─ build.mjs         两半的打包（含模块加载器封装）
```

### 一个刻意的设计

`@flomo/core` 和 `@flomo/ui` **直接以 TypeScript 源码分发**，不做预编译。谁用谁打包
（网页版用 Vite，插件用 esbuild）。这样整个 monorepo 没有构建顺序问题 —— 不需要
"先编译 A 才能编译 B"。

样式同理，以字符串常量导出（`packages/ui/src/styles.ts`）而不是 `.css` 文件，
因为在两个宿主里注入方式完全一致，不需要任何 loader 配置。

---

## 测试

```bash
pnpm test
```

- `packages/core/test/core.test.ts` —— 加密往返、分片持久化、**密文里不含明文**、
  写冲突检测、标签解析、搜索与每日回顾的确定性
- `packages/dsh-plugin/test/host.test.ts` —— 真实 host 服务 + 真实 HTTP 路由，
  跑在内存仓库上：配置流程、保险库生命周期、请求守卫（无同源标记必须 403）、
  action 协议、agent 工具

---

## 已知限制

- **忘记密码就没了**（除非有恢复码）—— 这是端到端加密的固有代价，不是 bug
- 多设备同时编辑同一月份会冲突，需要重试
- 图片尚未支持（计划放独立资源仓库当图床）
- `[[双向链接]]` 尚未实现
- DSH 会在进程内缓存**已成功导入**的插件模块，所以改了 host 半之后需要
  关掉再打开该 bundle，或者重启 DSH；client 半则由 client HMR 处理
