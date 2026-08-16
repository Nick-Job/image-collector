# 图片收集器 · 无水印素材采集浏览器扩展

一个参考 [doubao-nomark](https://github.com/ihmily/doubao-nomark)（豆包/即梦去水印）、
[PicList](https://github.com/Kuingsmile/PicList) 与 [boomb](https://github.com/liuzi6612/boomb)（GitHub 存图）
思路实现的 Chrome / Edge 浏览器扩展：

- **采集**：Pinterest、花瓣（Huaban）等平台的**图片 + 视频**，自动解析**原图地址**（Pinterest 走 `originals`，花瓣去掉 `_fw658` 等尺寸后缀）
- **自动选最大清晰度**：同一素材存在多个清晰度版本（如 480p/720p、缩略图/原图）时，刷新后自动合并为**分辨率最高**的一条
- **去水印**：豆包（Doubao）、即梦（Jimeng）页面内自动提取**无水印原图 / 原视频**
- **筛选**：面板内置筛选条 —— 类型（图片/视频）、格式（JPG/PNG/WEBP/GIF/其他）、清晰度（≥480p/720p/1080p，按高度）、文件大小（≥0.5MB 起，HEAD 探测真实大小）
- **存哪里随你**：
  - ⬇️ **下载到本地**（像 doubao-nomark 一样一键下载）
  - ⬆️ **推送到 GitHub 图库**（参考 PicList/boomb 的 Contents API 方案），推送后可复制 **jsDelivr CDN 链接** 直接用于 Markdown / 网页
- **通用采集**：任意网站，通过扩展弹窗「扫描当前页图片」即可收集；也可开启「所有网页显示悬浮按钮」
- **界面**：纯白极简（白/黑/灰），面板为**页面居中弹窗**（半透明遮罩 + 居中卡片，类似无印豆包），自动适配系统深色模式

---

## 目录结构

```
拓展程序-图片收集/
├── extension/                    # 浏览器扩展（加载这个目录）
│   ├── manifest.json             # MV3 配置
│   ├── background.js             # 下载 / GitHub 推送 / 消息路由
│   ├── popup.html / popup.js     # 扩展弹窗
│   ├── options.html / options.js # 设置页（GitHub / 下载）
│   ├── icons/                    # 图标
│   └── content/
│       ├── normalize.js          # 图片 URL 原图规范化（Pinterest/花瓣）
│       ├── collector-ui.js       # 通用采集面板（悬浮按钮 + 网格）
│       ├── pinterest-huaban.js   # Pinterest / 花瓣 页面扫描器
│       ├── doubao-extract.js     # 豆包无水印提取（MAIN world 拦截网络请求）
│       ├── jimeng-extract.js     # 即梦无水印提取（MAIN world 拦截网络请求）
│       ├── fab-everywhere.js     # 可选：所有网页显示采集悬浮按钮
│       └── generic-scan.js       # 任意网站通用扫描
└── tools/
    ├── make-icons.js             # 生成图标（node）
    ├── test-normalize.js         # URL 规范化单元测试（node）
    └── test-integration.js       # jsdom 端到端集成测试（需 jsdom）
```

## 安装

**方式一：从发布压缩包安装（推荐）**

1. 前往本仓库的 [Releases](../../releases) 页面，下载 `image-collector-v1.0.0.zip`
2. 解压得到 `extension` 文件夹
3. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
4. 打开右上角「开发者模式」→ 点击「加载已解压的扩展程序」→ 选择解压出的文件夹

**方式二：从源码安装**

1. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目的 **`extension`** 目录
4. 加载后地址栏右侧出现 📷 图标即安装成功

> 需要 Chrome / Edge 111+（MAIN world 内容脚本特性）。卸载后数据（GitHub Token 等）仍保留在浏览器本地存储中，重装可继续使用。

## 使用说明

### 1) Pinterest / 花瓣（采集 + 原图）

- 打开任意 Pinterest 画板 / 搜索页，或花瓣画板 / 采集页
- 页面右下角出现 **📷 悬浮按钮**（带已识别数量角标）
- 点击打开采集面板：
  - 自动识别**图片原图**（Pinterest 替换为 `originals`，花瓣去掉 `_fw658` 等后缀）与页面上的**视频**
  - 面板顶部有**筛选条**：
    - 类型：全部 / 仅图片 / 仅视频
    - 格式：JPG / PNG / WEBP / GIF / 其他（仅对图片生效）
    - 清晰度：≥480p / ≥720p / ≥1080p（按高度筛选）
    - 大小：≥0.5MB / 1MB / 5MB / 10MB / 50MB（选择后自动 HEAD 探测每个文件的真实大小）
  - 卡片上会显示类型角标（🖼 图片 / 🎬 视频）、分辨率与文件大小
  - 可单独勾选 / 全选 / 反选 / 刷新（筛选结果中操作）
  - 「⬇ 下载选中」保存到本地（默认 `下载/图片收集/平台/...`）
  - 「⬆ 推送 GitHub」推送到你的图库仓库
  - 滚动页面加载更多后点「刷新」即可继续采集

### 2) 豆包（无水印原图 / 原视频）

- 打开豆包对话页 `doubao.com/chat/...`，扩展在后台拦截聊天数据流，自动提取 `image_ori_raw` **无水印原图**与 `video_origin / play_url` 等**原视频**（原理同 doubao-nomark）
- 打开豆包分享页 `doubao.com/thread/...`，自动解析页面内嵌数据
- 点 📷 悬浮按钮查看 / 筛选 / 下载 / 推送

### 3) 即梦（无水印原图 / 原视频）

- 打开 `jimeng.jianying.com` 的创作列表 / 详情页
- 扩展拦截即梦内部 API，提取 `image_origin / video_origin / upscaled / raw` 等字段的**原始图片与视频地址**；同时扫描页面图片并应用 `2400:2400` 高清转换作为兜底
- 点 📷 悬浮按钮查看 / 筛选 / 下载 / 推送

### 4) 任意网站通用采集

- 点击扩展图标（弹窗）→「🔍 扫描当前页图片（任意网站通用）」，会在当前页**直接打开采集面板**
- 或：在设置页开启「**在所有网页显示 📷 采集悬浮按钮**」，之后任意网站的右下角都会出现按钮（像无印豆包在豆包页那样），点按钮即可收集当前页图片（>= 200px），支持下载 / 推送 GitHub

### 5) GitHub 图库（可选，推送图片用）

1. 创建仓库（或使用已有仓库）
2. 创建 Token：
   - GitHub → Settings → Developer settings → **Personal access tokens** → **Fine-grained tokens** → Generate new token
   - Repository access 选择目标仓库
   - Permissions → **Contents: Read and write**
3. 点击扩展弹窗 →「⚙️ 设置」，填入：
   - Token、仓库 `owner/repo`、分支（默认 `main`）、仓库内根目录（默认 `images`）
   - 「子目录」选自动时，Pinterest/花瓣按画板名、豆包/即梦按平台名归档
4. 点「测试连接」验证成功
5. 回到采集面板点「⬆ 推送 GitHub」：
   - 图片按 `根目录/分类/日期/文件名` 上传（参考 PicList/boomb 的 Contents API 方案）
   - 推送完成后弹出结果面板，可**复制全部 jsDelivr CDN 链接** 或 **复制全部 Markdown 引用**，直接贴到文章 / 网页里使用
   - 可选：每次推送写一份 `manifest-时间戳.json` 索引文件

> Token 只保存在本机浏览器 `chrome.storage.local`，不上传任何服务器；扩展所有网络请求都在你本地浏览器发起。

## 常见问题

| 问题 | 说明 |
| --- | --- |
| 推送报 422 / 仓库中已存在 | 同日同路径已推过同名文件。换一天再推即可（路径含日期），或改名后重推 |
| 下载/推送报 403、链接过期 | 豆包/即梦的图片 CDN 链接带时效签名，过期后需回到页面点「刷新」重新提取 |
| 即梦没有提取到任何图片 | 部分页面需先打开创作详情/生成列表触发数据加载，再点面板「刷新」 |
| 面板在 Pinterest 上数量很多 | 单次最多展示 1200 张，滚动后点「刷新」继续；可用筛选条缩小范围 |
| 视频没有识别到 | 视频需先加载进页面（滚动/播放触发），再点面板「刷新」；豆包/即梦需先触发一次生成或详情数据加载 |
| 大小筛选不生效 | 部分 CDN 不支持 HEAD 探测（返回未知），这类文件会先放行显示，探测失败时以实际下载为准 |
| Token 权限不足 | 确认 fine-grained token 勾选了目标仓库的 `Contents: Read and write` |
| 图片超过 100MB | GitHub Contents API 单文件上限 100MB，超大文件请改用本地下载 |

## 技术说明

- **豆包/即梦去水印**：内容脚本以 `world: "MAIN"` 注入页面主世界，在 `document_start` 阶段拦截 `fetch` / `XMLHttpRequest`，从接口响应中提取无水印原图字段（豆包 `image_ori_raw`；即梦 `origin/upscaled/raw` 等），通过 `postMessage` 桥接回隔离世界面板
- **GitHub 存图**：`PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}`，body 为 `{ message, content: base64, branch }`，与 PicList / boomb 同方案；并发 3 路上传
- **CDN 链接**：`https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}`

## 开发 / 测试

```bash
node tools/make-icons.js        # 重新生成图标
node tools/test-normalize.js    # URL 规范化 + 筛选 + 身份合并单元测试（46 项）
# 集成测试需要 jsdom（本地缓存安装）：
cd /tmp && mkdir -p ic-test && cd ic-test && npm install jsdom --no-audit --no-fund --cache ./npm-cache
node /path/to/拓展程序-图片收集/tools/test-integration.js   # 端到端 37 项
```

## 免责声明

本项目仅供个人学习交流使用。请遵守 Pinterest、花瓣、豆包、即梦等平台的服务条款及相关法律法规，尊重图片版权，仅下载你有权使用的素材。
