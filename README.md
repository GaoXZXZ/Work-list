# Work List

适合个人使用的工作台。可以在 Windows 应用窗口和 iPhone 主屏幕中记录工作，使用同一 GitHub 私有仓库同步。Windows 桌面组件提供任务预览。网页部分可直接托管静态文件。

## 在 Windows 打开

双击应用目录中的 `Work List.exe`，本机 Node.js 服务会在后台启动，工作台以 Edge 独立窗口打开。首次可点「预览示例」体验工作流。示例数据独立于正式记录。`启动工作记录.cmd` 也可用于查看启动日志。

在本机工作台侧栏点「桌面组件」，或双击 `Work List 桌面组件.lnk` 直接打开。组件默认位于桌面右下方，采用半透明底色，普通应用窗口会盖在它上面。拖动标题可移动组件，拖动边缘或四个角可改变大小。大小和位置会在下次启动时恢复。点任务可打开详情，点「+」可新建任务。

工作台打开时会更新桌面上的任务名称和进度。关闭工作台后，组件继续显示最近一次预览。首次启动组件时，Windows 启动器会调用系统的 .NET Framework 编译组件。预览文件保存在当前 Windows 账户的本机应用数据目录中。

## 在 iPhone 使用

1. 将 `index.html`、`styles.css`、`app.mjs`、`model.mjs`、`storage.mjs`、`reports.mjs`、`report-ui.mjs`、`sw.js`、`manifest.webmanifest`、三张 PNG 和 `.nojekyll` 放到 HTTPS 静态托管站点。采用 GitHub Pages 时，可把这些文件放进源码仓库的 `main` 根目录，再到仓库的 **Settings → Pages** 选择 **Deploy from a branch → main → /(root)**。如需在 iPhone 调用 DeepSeek，请按下文部署带 Node 服务的 HTTPS 版本。[GitHub Pages 配置说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
2. 用 iPhone Safari 打开部署后的地址，选择「分享 → 添加到主屏幕」，打开「作为网页 App 打开」。Windows 也可以直接访问这个部署地址。[Apple 使用指南](https://support.apple.com/guide/iphone/browse-the-web-iph1fbef4daa/ios)

## 开启自动同步

1. 在 GitHub 新建一个 **Private** 仓库专门存放工作数据。创建时勾选添加 README，以初始化默认分支。站点源码与私有数据各用一个仓库。
2. 在 GitHub 创建 fine-grained personal access token，限定到该数据仓库，仓库权限只需 **Contents: Read and write**。令牌可以在两台设备使用，也可以分别建立。[GitHub 令牌说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
3. 在两台设备分别进入「设置与同步 → 连接 GitHub 私有仓库」，填入同一个仓库名和 **同一个云同步口令**，并输入各设备的令牌。操作密码是本机写操作的核验口令，可在两台设备分别设置。
4. 连好后，每次打开、回到前台、保存或恢复联网都会自动同步。应用开启时大约每 45 秒检查一次云端。离线时照常记录，恢复联网后会合并；应用完全关闭期间的同步会在下次打开时继续。

数据在上传前经 AES-GCM 加密，云端合并使用 GitHub 文件版本检查。两台设备各自追加的跟进会保留，同时编辑同一字段时按版本顺序取一份。云同步口令及令牌保存在当前浏览器的本机存储中，由当前浏览器的密钥加密，以便重新打开时自动连接。任务可直接查看，操作密码保护新建、编辑、移动、跟进、归档、重新打开和删除。浏览器的各个配置文件及不同站点地址分别存储，切换地址时先在原地址完成同步。

## 整理和查找

- 左侧可选全部、今天、近 7 天、本月或具体月份。进行中任务按最近变动日期筛选，已办结任务按办结日期筛选，展示时间统一使用北京时间。
- Windows 可拖动任务左侧的手柄，将任务放到另一条任务上。iPhone 可在详情点「移动任务」，也可点击列表里的手柄选择上级或移为顶级任务。
- 每项任务独立办结。删掉上级任务时，它的子任务移为顶级。已办结的任务可以重新打开并恢复办结前的进度。
- 搜索范围包括任务名、工作说明和跟进记录。截止日期可选，逾期任务会显示提示。

## 工作报表

从侧栏打开「工作报表」，在周报、月报和年报间切换。选择日期可定位到该周、该月或该年，也可用箭头前后翻期。周报按北京时间周一至周日计算，月报和年报按自然月和自然年计算。年报还会按月列出新增、办结和跟进。

统计按任务新建、当前保留的办结时间和跟进记录的原始录入时间取数。待推进事项显示报表生成时的进度和截止日期。重开任务会清除原办结时间，重新生成旧报表时，该次办结会从统计中移除。草稿可编辑、复制或下载为 TXT，临时编辑会保留在当前页面。

## 启用 DeepSeek 撰写

应用通过同源 Node 服务调用 DeepSeek 官方 API，默认模型为 `deepseek-flash`。在报表中点「用 DeepSeek 撰写」，检查和删改本次素材，填写 AI 访问口令，再点「发送并生成」。预览后点「使用此稿」，即可继续编辑或导出。确认发送的素材会传给 DeepSeek，接口凭据和 GitHub 同步数据各自使用独立配置。[DeepSeek API 文档](https://api-docs.deepseek.com/api/create-chat-completion/) · [模型与计费](https://api-docs.deepseek.com/quick_start/pricing/)

### Windows 本机

用 Node.js 22 或更新版本。在应用目录新建 `.env.local`，用自己的值替换下面的占位内容。AI 访问口令由你设置，至少 16 个字符，首次生成时在应用内输入。

```dotenv
DEEPSEEK_API_KEY=填入自己的DeepSeek密钥
WORK_JOURNAL_AI_TOKEN=填入独立的随机访问口令
```

结束已运行的本机服务后再双击 `Work List.exe`。启动器会加载本机的 `.env.local`。运行命令也可使用 `node --env-file=.env.local local-server.mjs`。

### iPhone 和 Windows 共用服务

在可运行 Node.js 的主机上运行 `node local-server.mjs`，由 HTTPS 反向代理把站点根路径转发到该服务并保留站点的原始 Host。将下面这些变量设置在服务端，Windows 和 iPhone 用同一 HTTPS 地址打开应用。首次访问 AI 时，两台设备输入所配置的 AI 访问口令。

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `WORK_JOURNAL_AI_TOKEN` | AI 访问口令，至少 16 个字符 |
| `WORK_JOURNAL_ORIGIN` | 公开 HTTPS 地址，例如 `https://journal.example.com` |
| `WORK_JOURNAL_HOST` | 监听地址。同机代理可沿用 `127.0.0.1`。容器可按托管平台要求设为 `0.0.0.0` |
| `WORK_JOURNAL_PORT` 或 `PORT` | Node 服务监听端口，默认 `8765` |
| `WORK_JOURNAL_DEEPSEEK_MODEL` | 可选。默认 `deepseek-flash`，也可设为 `deepseek-v4-pro` |

GitHub Pages 可提供离线工作台和自动报表。带 DeepSeek 的版本需要运行上述 Node 服务。`.env.local` 仅供本机，已加入 Git 忽略规则。

## 本机检查

运行 `node --test` 检查任务、同步、报表周期和 DeepSeek 请求逻辑。运行 `node local-server.mjs` 启动本机工作台。
