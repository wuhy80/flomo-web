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
pnpm test                # 156 个测试（glob 收集，新增测试文件不用改脚本）
pnpm typecheck           # 覆盖 src/、test/ 和 vite.config.ts
pnpm build               # 网页版产物
pnpm build:plugin        # 插件两半
pnpm smoke               # 部署冒烟测试（需先 build）
```

> `tsconfig.json` 的 `include` **包含 `test/`**。这是刻意的：测试是对外的公开 API 的
> 第一批使用者，让它们过类型检查等于顺带验证了 API 的类型契约。
> 另外 `pnpm test` 用 glob 而不是文件清单 —— 清单会漏，而漏掉的测试**不会报错，
> 只是不跑**。
>
> 产物测试会**自己构建 `lib/`**（`lib/` 是 gitignore 的）。所以干净检出能直接跑，
> 而且测试不可能对着过期产物通过。

### 图标

```bash
python packages/web/scripts/make-icons.py
```

一次性工具，**产物已提交**，所以 CI 不需要 Pillow。只在标记本身变化时重跑。
`pnpm smoke` 会断言 manifest 声明了图标、其中一个是 maskable、且每个图标 URL
都能作为图片取到 —— 少了图标 manifest 照样能安装，只是装出来是平台的占位图。

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
> 手机上没有导航）**没有一个**是当时的测试套件或读代码能发现的。

### 真的去操作它

```bash
node packages/web/scripts/interact.mjs http://127.0.0.1:5273/
node packages/web/scripts/interact.mjs http://127.0.0.1:5273/ --size 420x900
```

截图只到"渲染出来了"为止。这个脚本**在真实的输入框里打字、点发送**，然后检查应用
**到底想持久化什么**：

- 新记录出现在信息流里、输入框自己清空、`#标签` 从正文里解析出来
- 内容被写进当月分片 —— 而且**所有写入里都没有明文**（正文和标签都没有）
- **另外三个视图真的能点开**（每日回顾 / 随机漫步 / 全部），搜索真的会过滤、清空后会恢复
- **编辑一条已有记录**：正文被替换而不是被追加，旧正文消失而不是重复
- **置顶 / 取消置顶真的会改变顺序** —— 不只是把按钮文字换掉
- **改写路径同样没有明文**：编辑会重写一个已存在的分片，和追加到空分片是两条不同的路

最后一条是**整个项目的核心主张**，而它是在**浏览器里**被验证的，不是靠服务层。
mock 的 `PUT` 不再丢弃请求体，而是记到 `window.__flomoWrites` —— 这正是"能问出
应用想存什么"的前提。

**两种视口都要跑。** 窄屏下侧栏会变成横向导航条、操作按钮会换位置，那些改动
**看截图是看不出能不能用的** —— 必须真的点一下。`pnpm --filter @flomo/web interact`
会把两种尺寸都跑一遍。

> 浏览器那部分逻辑在 `harness.mjs`，`screenshot.mjs` 与 `interact.mjs` 共用。
> 抽取时验证过：重构前后截图的**哈希完全一致**。

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

那个 `toolsRegistered` / `toolsError` 字段就是为这件事加的 —— 它直接指出了
工具为什么没注册上。

同一个路由还返回 `stateClients`：**读过状态的客户端 User-Agent**。面板在挂载时会读一次，
所以那里出现一个浏览器 UA，就是**浏览器半真的加载并挂载了**的唯一外部可见证据 ——
因为 GUI 自己的 index 需要只有桌面壳才持有的鉴权（见坑 8）。

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

### 9. 这台机器上有透明加密（DLP），`.ts` / `.js` / `.css` 落盘会被加密

写 `.ts` 文件后，**git 和 harness 的读取工具看到的是密文**（`%TSD-Header-###%`
开头，长度补齐到 4096 的整数倍），而 `node` / `tsc` 看到的是明文。表现是：

- `read` / `edit` 工具报 `binary file`，`git diff` 显示 `Bin 14878 -> 24576 bytes`
- 但 `pnpm typecheck`、`pnpm test`、`pnpm build` 全都正常

**按扩展名，不是按路径**（实测）：

| 会被加密 | 不会 |
|---|---|
| `.ts` `.js` `.css` | `.tsx` `.mjs` `.json` `.md` `.yml` `.txt` `.png` |

**这会真的毁掉一次提交**：加密的源文件进仓库，CI 和 Pages 上就是乱码。

三条规矩：

1. **源码用文件工具写，不要用 shell 写。** harness 的 `write` / `edit` 落盘是明文
   （实测 `git hash-object` 与 `dotnet` 哈希一致），而 `[IO.File]::WriteAllBytes`、
   `Set-Content`、`Out-File` 写出来是密文。
2. **发现某文件被加密了，别用 shell 修。** 用临时索引 + `git checkout-index`
   让 git 去写那个文件 —— git 写出来是明文：
   ```powershell
   $env:GIT_INDEX_FILE = "$env:TEMP\idx"
   git read-tree HEAD
   git update-index --add --cacheinfo "100644,<blob>,<path>"
   git -c core.autocrlf=false checkout-index -f -- <path>
   Remove-Item Env:\GIT_INDEX_FILE
   ```
3. **提交前自查**：下面这条命令应当输出 `same=True`。不一致就是密文。
   ```powershell
   $b=[IO.File]::ReadAllBytes($f)
   $h=[Text.Encoding]::ASCII.GetBytes("blob $($b.Length)`0")
   $d=[BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($h+$b)).Replace('-','').ToLower()
   $d -eq (git hash-object --no-filters -- $f).Trim()
   ```

### 10. 这台机器到 github.com 的 HTTPS 被 TLS 层拖慢，SSH 正常

实测（同一时刻、同一台机器）：

| 目标 | TCP 443 | 实际 HTTP / 握手 | 稳定性 |
|---|---|---|---|
| `github.com` | 103 ms | **17.9 – 22.7 s** | 稳定地慢 |
| `git ls-remote`（HTTPS） | — | **2.6 – 23.5 s** | **抖动极大** |
| `api.github.com` | 1112 ms | **209 ms**（热连接） | 稳定 |
| `ssh.github.com:443` | — | **2.8 s** 握手完成 | 稳定 |
| `*.github.io` | — | 6.4 s | — |
| `*.workers.dev` | DNS → 31.13.64.7（Facebook 的 IP，即污染） | 完全不通 | — |

结论：**TCP 没问题，慢在 HTTPS 的 TLS 握手**。但要注意 **HTTPS 的耗时抖动极大**
（同一台机器相隔 40 分钟，`git ls-remote` 从 23.5 s 变成 2.6 s），所以**不要把这个
数字写死在任何地方** —— 要下结论就现测。真正稳定的是 SSH（约 3 s，没有几十秒的尾部）。

绕法不是换线路，而是**换协议**。另外镜像前缀（`ghfast.top` 之类）的 remote 推送失败
与速度无关：只读镜像本来就不接受 push。

- git 的修法见 `scripts/setup-github-ssh.ps1`：`~/.ssh/config` 里
  `Host github.com` → `ssh.github.com:443`，再加
  `git config --global url."git@github.com:".insteadOf "https://github.com/"`。
  这两条对**所有仓库**生效，不需要逐仓库配置。
- `api.github.com` 很快，所以**应用运行时不需要任何中转** —— 保险库读写是 200 ms 级。
- `*.workers.dev` 被污染，意味着 **OAuth 中转不能部署在那里**，得用
  Pages Functions（`*.pages.dev` 通）或自定义域名。

> 写 `.ps1` 时注意：Windows PowerShell 5.1 把 **UTF-8 无 BOM** 的脚本按 GBK 读，
> 一个 `—` 就会变成乱码，所以 `setup-github-ssh.ps1` 里**全是 ASCII**。
> 另外它给原生命令传空参数时用的是 `-N '""'` 而不是 `-N ''` —— 后者会被 5.1 丢掉。

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

### 动了样式或组件结构，就要重截 README 的图

```bash
pnpm --filter @flomo/web dev            # 另开一个终端
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ docs/screenshot-feed.png
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ docs/screenshot-locked.png --locked
node packages/web/scripts/screenshot.mjs http://127.0.0.1:5273/ docs/screenshot-mobile.png --size 420x900
```

**没有任何东西会提醒你。** `docs/` 里那三张图没有任何自动生成或校验，所以它们会悄悄
落后于代码 —— 已经发生过一次：热力图加了月份标签之后，README 里的主图两个月都没跟上，
展示的是一个不存在的界面。一份"用图说话"的文档，图过期比文字过期更糟。

三张图分别在验证什么：信息流（样式与块渲染）、门禁（居中布局）、窄屏（响应式断点）。
所以**改 `styles.ts`、改 `MemoItem` 的结构、或改任何布局相关的 class，都要重截**。

> 截图里的日期是相对**生成时刻**的（fixture 用 `new Date()` 往前推），所以隔几天重截
> 内容会不同 —— 那是 demo 数据，不是漂移。真正要盯的是**布局**。
