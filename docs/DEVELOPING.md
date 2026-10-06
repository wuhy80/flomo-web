# 开发说明

这份文档记录的是**读代码看不出来**的东西：分层规则为什么是这样，以及这个仓库里
已经咬过人的坑。每条坑都真实发生过，代价是时间。

---

## 目录与职责

```
packages/
├─ core/        零依赖内核。加密、Memo 模型、块与行内标记解析、按月分片、GitHub 客户端
├─ ui/          flomo 风格 React 组件与样式表，被 web 与 dsh-plugin 共用
├─ web/         Vite 应用 + 部署产物 + 冒烟测试 + 截图工具
└─ dsh-plugin/  dsh-flomo 双面插件（host 半 + client 半）
```

### 两条分层规则

**① 纯逻辑进 `core`，`core` 不认识 DOM、不认识 React。**

因为同一份逻辑要在三个地方跑：浏览器、DSH 的 host 进程（Node）、以及测试。
`core/cache.ts` 里的 `CacheArea` 就是这条规则的产物 —— 它比 DOM 的 `Storage` 更窄，
所以测试能塞一个 `Map` 进去。

**② 同一份语法只能有一个解析器。**

`#标签`、`[[链接]]`、`**加粗**`、`` `行内代码` `` 全部由 `core/inline.ts` 里的
**一条 alternation** 识别；代码围栏与引用块由 `core/blocks.ts` 识别。标签索引、
链接解析、渲染器读的都是同一份 token 流。

这条规则不是洁癖 —— 它保证**界面上高亮的，永远等于索引里存下来的**。一旦有第二个
正则，两者就会漂移。往 `tokenizeInline` 加新标记时，记得同时更新：

- `markupOf()`（把 token 还原成源码，供"只认标签"和"只看散文"两个视图使用）
- 覆盖全输入的不变量测试（`core.test.ts` 的 `tokenizeInline` 一节）
- `MemoItem` 的 `renderInline`

---

## 常用命令

```bash
pnpm install
pnpm dev                 # 网页版开发服务器 → http://localhost:5273
pnpm test                # 155 个测试
pnpm typecheck
pnpm build               # 网页版产物
pnpm build:plugin        # 插件两半
pnpm smoke               # 部署冒烟测试（需先 build）
```

### 用真实浏览器看它

```bash
pnpm --filter @flomo/web dev          # 另开一个终端
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ shot.png
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ gate.png --locked
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ review.png --click 每日回顾
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ memo.png --open 心流
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ phone.png --size 420x900
```

它把 `fetch` 换成一个基于**真实加密保险库**的 Contents API，让真正的应用跑真正的
代码路径、用真正的表单解锁，再截图。mock 只活在注入的页面脚本里，**不进产物**。

> 这个工具值回票价：它抓到的问题（加粗显示成星号、整个应用只有最宽子元素那么宽、
> 手机上没有导航）**没有一个**是 150 个测试或读代码能发现的。

---

## 坑

### 1. 样式表是模板字符串 —— 注释里不能有反引号

`packages/ui/src/styles.ts` 把整份 CSS 放在一个模板字符串里（这样两个宿主注入方式
完全一致，不需要 loader 配置）。在 CSS 注释里写一个反引号就会**终止这个字符串**，
模块直接不解析。

**这条已经犯过两次。** 现在有测试从源码里把字面量切出来断言里面没有反引号 ——
数文件里的反引号是不行的，周围的 JSDoc 合法地含有它们。

### 2. 不要逐行改写打包产物

`build.mjs` 曾经为了让封装体好看，把 bundle 的每一行缩进两个 tab。结果是**静默改坏代码**：
esbuild 的压缩器会把 `"\n"` 打印成一个**跨两行**的模板字符串，逐行加缩进就把缩进
**注进了字符串里面**，每一处 `split("\n")` 都变成了 `split("\n\t\t")`。

> 任何逐行改写 bundle 的东西都必须知道哪些行在字符串字面量里，而唯一安全的数量是零。

封装体现在原样插入。

### 3. DSH 的 host 半无法热重载

DSH 会把**已成功导入**的插件模块缓存在进程里，按包名索引。所以改完 host 半之后：

- 关掉再打开 bundle → **无效**（只是重新跑 `apply`，模块还是旧的）
- 改 `package.json` 的 `main` 指向新文件名 → **无效**（不是按文件 URL 缓存）
- 改版本号 → 没用过，但按上面的规律大概率也无效

**只有重启 DSH。** client 半不受影响（有 client HMR）。

判断当前跑的是哪一版：读插件自己的状态路由。

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:19387/flomo-sim/api/state" -UseBasicParsing `
  -Headers @{ "sec-fetch-site" = "same-origin" } | Select-Object -ExpandProperty Content
```

那个 `toolsRegistered` / `toolsError` 字段就是为这件事加的 —— 它在这一轮直接
指出了工具为什么没注册上。

### 4. `defineTool` 不是等价函数

DSH 自己的 `defineTool` **还会展开 `{ type: 'json' }` 这个 output 简写**。而
`@deepseek-ai/*` 从一个 `link:` 安装的插件里**解析不到**（见下一条），所以插件必须
自备兜底 —— 兜底不会展开简写，registry 就会拒绝它，六个工具**一个都注册不上**，
而唯一的证据是一行状态字符串。

**结论：`output.schema` 永远写成自身合法的 JSON Schema。** 有测试断言
`schema.type` 在 registry 允许的集合里。

### 5. `@deepseek-ai/*` 从一个 link 安装的插件里解析不到

这些包由 Harness 在运行时提供，磁盘上没有。对 profile 里的**普通目录**插件没问题，
但 `link:` 安装时解析路径会走到工作区外 —— 一个**静态** `import` 会把整个插件
（连面板一起）拖垮。

所以 `@deepseek-ai/dsh-tools` 是**惰性导入 + try/catch**：拿不到就降级成自备实现，
代价只是工具，不是整个插件。

### 6. 本机 shell 是 Windows PowerShell 5.1，不是 pwsh 7

- 不支持 `&&`、`??`、三元 `? :`
- `Set-Content` **按 ANSI 写** —— 用它改含中文的源码会**全部变成乱码**（犯过一次，
  用 `git checkout` 恢复的）。**源码编辑一律走文件工具。**
- `Invoke-WebRequest` 把文本响应**按 Latin-1 解码** —— 控制台里看到的乱码可能不在
  数据里。要判断就自己按 UTF-8 解 `RawContentStream.ToArray()`。

### 7. 沙箱模式会让 shell 彻底起不来

`workspace-write` 下 `pwsh` 每次都返回 `0xC0000142`（DLL 初始化失败），进程根本起不来。
切到 `danger-full-access` 就好了。遇到这个不要反复重试，直接看权限模式。

### 8. DSH 的 shell index 需要真正的鉴权

`GET http://127.0.0.1:19387/` 返回 401（需要启动令牌换来的 cookie，只在桌面壳内存里）。
**但插件自己注册的路由不需要** —— 它们只要求回环 + 同源标记。这就是插件路由可以被
`Invoke-WebRequest` 直接检查的原因，也是为什么诊断信息应该放在插件自己的状态路由里。

---

## 加一个功能：一条走过的路

以"给正文加一种新标记"为例，改动会落在这些地方（顺序即依赖顺序）：

1. `core/inline.ts` —— 模式 + `tokenizeInline` + `markupOf`
2. `core/tags.ts` / `core/links.ts` —— 如果新标记影响它们，确认仍取正确的子集
3. `core/test/core.test.ts` —— 覆盖全输入的不变量 + 新标记的行为
4. `ui/MemoItem.tsx` —— `renderInline` 里渲染它
5. `ui/styles.ts` —— 样式（**注释里别写反引号**）
6. `dsh-plugin/test/artifacts.test.ts` —— 断言**真实产物**渲染出的是元素而不是字面量
7. `pnpm test && pnpm typecheck && pnpm build && pnpm smoke`
8. 截图看一眼

第 6 步不能省：加粗那次的教训是，源码测试全绿而**界面上显示的是星号**。

---

## 提交前

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm build:plugin && pnpm smoke
```

`pnpm smoke` 会**像 GitHub Pages 那样**静态服务 `dist/`，检查每个引用是否解析得到、
Service Worker 是否被拷进去、以及它承诺预缓存的 URL 是否都可达。CI 里它在发布之前跑。
