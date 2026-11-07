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
3. Secret 内容使用你自己在 GitHub 上生成的有效期较短的 **Fine-grained Personal Access Token**：Resource owner 必须为 `zhengjiaru2018-eng`，Repository access 选 **All repositories**（不能只选 `ruru`）。Repository permissions：**Repository creation: Read and write** 或 **Administration: Read and write**，并且 **Contents: Read and write**。GitHub 官方文档确认 `POST /user/repos` 需要前述创建权限之一。
4. 打开 **Actions** → **Mirror OneSip Public Repositories** → **Run workflow**。
5. 查看 Actions 的日志和 Job Summary，核对结果。迁移完毕后**删除该 Secret 并撤销 PAT**。

**安全：** 绝对不要把 Token、账号密码或其他凭据贴到仓库代码、GitHub Issue 或 ChatGPT 对话里。此 workflow 不执行旧仓库的程序代码，只搬运 Git 对象。

## 列表与实现
- `scripts/onesip-public-repos.txt`：23 个已发现的原仓库名
- `scripts/migrate-onesip.sh`：批量镜像脚本
- `.github/workflows/migrate-onesip.yml`：手动启动的 GitHub Actions 工作流

原仓库的大小、Git LFS、存储配额和受保护分支等可能影响部分迁移，按执行日志逐项确认。

## 如果出现 HTTP 403

若日志提示 `gh: Resource not accessible by personal access token (HTTP 403)`，代表当前保存在 `ONESIP_MIGRATION_TOKEN` Secret 中的 Token 无法执行 `POST /user/repos` 创建新仓库。常见原因是没有勾选 **Repository creation (write)** 或 **Administration (write)**，或资源所有者/可访问仓库范围选错。

**处理方法：**
1. 打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens，重新生成一个短期 Token（或调整现有 Token 的权限）。资源所有者需为 `zhengjiaru2018-eng`。
2. 选 **All repositories**，授予 Repository creation（write，或 Administration write）以及 Contents（write）。
3. 回到 `ruru` → Settings → Secrets and variables → Actions → `ONESIP_MIGRATION_TOKEN`，用新 Token **替换 Secret 的值**。
4. 在 Actions 工作流选择 **Run workflow** 重新启动。不要只点重新运行旧的错误日志而不调整 Secret。
5. 核对新产生的私有仓库及 Actions Job Summary；完成后撤销 Token 并删除 Secret。

Github 官方接口权限文档：https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user

**注意：** 直接在 ChatGPT 连接 GitHub，并不等于 GitHub Actions 中的 PAT 自动获得创建新仓库的权限。
