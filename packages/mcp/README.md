# @flomo/mcp — flomo 的 MCP 服务器

把 flomo 保险库封装成 [Model Context Protocol](https://modelcontextprotocol.io) 工具，
让任何 MCP 客户端(Claude Desktop、ZCode 等)里的大模型能**添加、查看你的笔记**。
数据路径和网页端完全一致:在本进程内解密,经 GitHub Contents API 读写你自己的私有仓库,
**凭据只留在本机**,没有任何服务器经手。

## 工具

| 工具 | 作用 |
| --- | --- |
| `flomo_add` | 写一条笔记,标签写在正文里(`读完《深度工作》 #读书/认知`) |
| `flomo_recent` | 最近笔记,新的在前 |
| `flomo_search` | 按正文关键词、按标签,或两者组合 |
| `flomo_daily_review` | 每日回顾,按 flomo 的规则挑旧笔记 |
| `flomo_tags` | 全部标签及计数 |

## 配置

服务器从环境变量读全部设置(MCP 客户端的 `mcpServers` 配置里带 `env`):

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `FLOMO_GITHUB_TOKEN` | 是 | 细粒度 PAT,只授**单个私有仓库的 Contents 读写** |
| `FLOMO_REPO` | 是 | `owner/repo` 格式 |
| `FLOMO_BRANCH` | 否 | 默认用仓库默认分支 |
| `FLOMO_PASSWORD` | 二选一 | 保险库密码 |
| `FLOMO_RECOVERY_CODE` | 二选一 | 创建保险库时给出的恢复码(推荐:免去每次 PBKDF2 派生) |

## 接入

命令就是 `node`,指向本包的 `server.ts`(仓库无需构建,Node ≥ 22.6 直接跑 TypeScript):

```json
{
  "mcpServers": {
    "flomo": {
      "command": "node",
      "args": ["D:/code/flomo-sim/packages/mcp/server.ts"],
      "env": {
        "FLOMO_GITHUB_TOKEN": "github_pat_…",
        "FLOMO_REPO": "you/your-vault",
        "FLOMO_RECOVERY_CODE": "……"
      }
    }
  }
}
```

仓库根目录还有个快捷方式:`pnpm mcp`(同样从环境变量读配置)。

## 安全说明

- 进程在你机器上运行,解密不出本机 —— 与网页版「密钥不离开设备」是同一条边界,只是多了一个本地持钥程序
- PAT 只需要 Contents 读写、只授给 vault 那一个仓库;泄漏面就是仓库本身(里面只有密文)
- 环境变量可能出现在进程列表或客户端配置文件里,注意保管;用恢复码可以避免把密码放进配置

## 测试

`pnpm test` 会跑 `test/server.test.ts`:协议层走内存保险库(真实加解密、不经 GitHub),
另有一条用例真的 spawn 服务器进程、走一遍 stdio 的 initialize → tools/list → tools/call。
