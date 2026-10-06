# 验证现状

这份文档记录**哪些事情被真正验证过、用什么验证的**，以及**哪些没有**。
数字是某个时刻的快照；命令是长期有效的。

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm build:plugin && pnpm smoke
pnpm --filter @flomo/web interact        # 需要先起 dev server，见下
```

---

## 一、每次提交都会跑的

| 检查 | 规模 | 结果 |
|---|---|---|
| `pnpm typecheck` | `src/` + `test/` + `vite.config.ts` | 干净 |
| `pnpm test` | **238 个测试 / 46 个套件** | 全通过 |
| `pnpm build` | 59 个模块 → `packages/web/dist` | 成功 |
| `pnpm build:plugin` | `lib/index.js` + `lib/client.js` | 成功 |
| `pnpm smoke` | **28 项部署检查** | 全通过 |
| 行覆盖率 | 全部文件 | **97.80%**，且**没有文件低于 90%** |

CI 里 `.github/workflows/ci.yml` 跑前四项，`deploy.yml` 另外发布站点。

### `pnpm smoke` 检查什么

它**像 GitHub Pages 那样**静态服务 `dist/`，然后检查：每个引用能否解析、入口文件名是否带内容哈希、
Service Worker 是否被拷贝且以 JavaScript 提供、它承诺预缓存的 URL 是否都可达、
manifest 是否声明了图标（其中一个是 maskable）且每个图标 URL 都能作为图片取到。

**验证过它会失败**：藏起 `dist/sw.js` 会列出多项失败并退出 1；把图标指向不存在的文件、
或把 `icons` 整个删掉，各自都会报出对应的失败。

---

## 二、需要真实浏览器和 dev server 的

```bash
pnpm --filter @flomo/web dev            # 另开一个终端，保持运行
pnpm --filter @flomo/web interact       # 两种视口各跑一遍
pnpm --filter @flomo/web shots          # 重新生成截图
```

**23 项交互检查 × 2 种视口（1280×1000 与 420×900），全通过。**

它让**真正的应用**跑**真正的代码路径**：`fetch` 被换成一个基于**真实加密保险库**的
Contents API，解锁走**真正的表单**，操作走**真正的输入框和按钮**。

覆盖到的行为：

- 记录：新条目出现在信息流、输入框自清空、`#标签` 从正文解析出来
- **持久化的是密文** —— 而且编辑（重写已有分片）这条路径同样没有明文
- 三个视图能点开、搜索会过滤、清空后会恢复
- **编辑是替换不是追加**，旧正文消失而不是重复
- **置顶/取消置顶真的改变顺序**，不只是换按钮文字

截图工具（`screenshot.mjs`）负责"看"：它抓到过加粗显示成星号、整个应用只有最宽子元素
那么宽、手机上没有导航 —— **没有一个**是当时的测试或读代码能发现的。

---

## 三、插件侧的端到端

`packages/dsh-plugin/test/journey.test.ts` 走的是插件**自己的 HTTP 表面**，
按人点击的顺序：配置 → 创建 → 记录 → 保存 → 从面板路由读回 → **从 agent 搜索工具读回**。

其中关于"不存在"的断言，都是**反向验证过**的（确认它们不是空转）：

- 仓库里**每个**存储文件都不含笔记正文、密码、令牌
- 设置文件里只有仓库坐标 —— 那四样一样都没有，**包括只显示一次的恢复码**
- 而令牌**确实在凭据中心里**（保证上一条不是因为"它哪儿都没去"才通过）

---

## 四、**没有**验证的

诚实地列出来，比让它们看起来像已验证的要紧。

> **首期目标「在 DSH 里能直接查看并记录」只差下面第 1、2 条。**
> 两条都只需要你一个动作，而且**第 1 条我读一条命令就能自己确认**。

### 1. DSH 里的面板 —— 只有你能确认

插件**已安装、已启用，状态路由在真实 DSH 上可用**（`/flomo-sim/api/state` 返回 200）。
但"侧栏里出现了 flomo 图标、点开是完整界面"这一条，我**无法自己验证**：

- GUI 自己的 index 需要启动令牌换来的 cookie，而令牌只在桌面壳内存里（不在磁盘上，`DSH_WEB_URL` 里也没有）
- 我**已经确认**路由存在、客户端产物能被加载、面板能被 SSR 渲染 —— 但这些都不等于"它在你的浏览器里挂上了"

### 2. agent 工具在真实 DSH 里注册失败，修复待重启生效

`/state` 现在返回：

```
"toolsRegistered": false,
"toolsError": "unsupported JSON schema: schema.type must be one of object/array/string/number/integer/boolean/null"
```

**根因已定位并已修复**（见 `docs/DEVELOPING.md` 的坑 4：`defineTool` 会展开
`{ type: 'json' }` 简写，而自备兜底不会），但 **DSH 按包名缓存已导入的模块，
只有重启才能刷新**。重启后 `toolsRegistered` 应变为 `true`。

### 3. 真实 GitHub

所有测试都用内存里的假仓库。真实的 Contents API、真实的令牌 scope、
真实的冲突与限流，**都没有实测过**。

### 4. 图片、导入的更新语义、十万级语料的性能

README 的"已知限制"里列着，都是设计取舍而非缺陷。

---

## 五、怎么确认上面第 1、2 条

1. **重启 DSH**
2. 读一次状态路由：

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:19387/flomo-sim/api/state" -UseBasicParsing `
  -Headers @{ "sec-fetch-site" = "same-origin" } | Select-Object -ExpandProperty Content
```

- `toolsRegistered` 应变为 **`true`**（否则 `toolsError` 会点名是哪个工具、哪一条）
- `stateClients` 里应出现一个**浏览器 UA** —— 面板在挂载时会读一次状态，
  所以那是"浏览器半真的挂上了"的唯一外部可见证据

3. 点一下侧栏里的 flomo 图标

---

## 六、文档本身也审过

代码有 238 个测试盯着，散文没有。所以有一轮专门逐条核对 README 的断言与代码事实，
**连续五轮查出五处**，每一处都是"读代码看不出来"的（因为它们不是代码）：

| 问题 | 性质 |
|---|---|
| 加密**没有**防护什么 | 从未写过（浏览器被攻陷、回环 HTTP 路由、同源插件） |
| 请求闸门的机制 | **描述错了** —— `same-origin` 会短路，两个检查不叠加 |
| "没有 hash oracle 可打" | **误导** —— 有（`vault.json` 里那段已知明文的密文），只是每次猜测都要跑满 60 万次 PBKDF2 |
| 目录树 | 指向**不存在的路径**；顺着它挖出三种拿 `MemoryStore` 的方式和一个**自我否定的垫片**（已删除） |
| README 完全没提 `interact.mjs` | 读者会以为浏览器验证止于"渲染出来了" |

**关于"保证"的散文，值得和代码一样的怀疑。** 这五处里有两处就在描述安全性质的那一节。
