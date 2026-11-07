# OneSip 公开仓库批量迁移

此仓库 `zhengjiaru2018-eng/ruru` 是 **迁移控制台**，不把 23 个项目混在同一个仓库里。

## 迁移目标
- 来源：`https://github.com/onesip`（已检索到 23 个 Public 仓库）
- 目的地：`https://github.com/zhengjiaru2018-eng`
- 每个来源仓库将在新账号下使用原名新建一个独立仓库。
- 使用 `git clone --bare` 和 `git push --mirror` 保留 Git 分支、标签和提交历史。
- **默认先建为 Private**，检查代码没有泄露密钥后再自行公开。
- 如果新账号下已有同名仓库，则**跳过**，绝不强制覆盖。
- GitHub Issues、PR、Stars、仓库设置、部署/Actions Secrets 等不在普通 Git 镜像迁移范围内。

## 启动前：请在 GitHub 网页完成授权
1. 使用新账号，进入 `ruru` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**。
2. 新增名为 `ONESIP_MIGRATION_TOKEN` 的 Secret。
3. Secret 内容使用你自己在 GitHub 上生成的有效期较短的 Fine-grained Personal Access Token（资源所有者为 `zhengjiaru2018-eng`，Repository access 选 **All repositories**，授予创建仓库所需的 Administration/Repository creation 写入权限和 Contents 读写权限）。如果页面权限名称或范围不同，请先依照 GitHub 官方文档核对。
4. 打开 **Actions** → **Mirror OneSip Public Repositories** → **Run workflow**。
5. 查看 Actions 的日志和 Job Summary，核对结果。迁移完毕后**删除该 Secret 并撤销 PAT**。

**安全：** 绝对不要把 Token、账号密码或其他凭据贴到仓库代码、GitHub Issue 或 ChatGPT 对话里。此 workflow 不执行旧仓库的程序代码，只搬运 Git 对象。

## 列表与实现
- `scripts/onesip-public-repos.txt`：23 个已发现的原仓库名
- `scripts/migrate-onesip.sh`：批量镜像脚本
- `.github/workflows/migrate-onesip.yml`：手动启动的 GitHub Actions 工作流

原仓库的大小、Git LFS、存储配额和受保护分支等可能影响部分迁移，按执行日志逐项确认。