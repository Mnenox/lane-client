# lane-client

lane 的配套 Windows 零代码桌面客户端（Electron）。博客的撰写、素材、页面设置、发布、备份全部在这里完成；视觉与博客墙面同源（B 组「午夜霓虹巷」冻结色值）。

## 运行

```bash
npm install
npm start          # 正常启动（关闭窗体隐藏到托盘）
npm run capture    # 截图模式（调试用）
```

首次启动进入向导：连接 GitHub（Personal Access Token，scopes: `repo, workflow`）→ 从 lane-theme 模板创建博客仓库（本地模板复制或 GitHub 模板生成）→ 自动开通 Pages → 进入写作台。也可在向导第一步直接"打开已有内容库"。

## 安装包

```bash
npm run dist       # electron-builder NSIS → release/lane-client Setup 1.0.0.exe
```

安装包内置 Electron 运行时；目标机器另需 Node.js（本地预览 astro dev）与 Git（提交 / 推送）。GitHub Release 附同名安装程序。

## 五个模块

- **写作台**：稿件列表（竖版 2:3 迷你海报缩略图）+ Markdown 编辑器（编辑 / 预览双模式）+ 元数据面板（标签 / 封面 / 发布时间 / 草稿 / 摘要 / 别名）。自动保存；预览由内容库内 `astro dev` 渲染，与线上完全一致。
- **素材库**：拖拽 / 选择上传，sharp 自动压缩转 WebP、规范命名；插入文章自动生成引用；删除前提示检查引用。
- **页面设置**：站点信息、导航、墙面预设 / 圆角 / 倾斜 / 密度 / 贴纸 / 动画、关于页正文，全表单化 + 即时预览；保存写入 `site.config.json`。
- **发布管理**：一键发布（commit + push）、撤回、定时队列、Git 历史；状态追踪 已提交 → 构建中 → 已上线 / 失败（轮询 GitHub Actions）。
- **备份导出**：文章 + 图片 + 配置打包 zip；导入恢复可迁移到新电脑。

## 托盘与定时发布

托盘驻留：图标 + 状态提示；右键快捷新建草稿 / 打开 / 退出。定时任务每 30 秒扫描到期文章：在线时立即推送触发云端构建（分钟级准点）并系统通知；关机时由云端每 30 分钟重建兜底（见 lane-theme 工作流）。

## 架构

```
src/main/      主进程：窗口 / 托盘 / IPC / git / GitHub REST / 内容读写 / 预览服务 / 定时任务
src/preload/   contextBridge 安全桥（invoke / onStatus / getPathForFile）
src/renderer/  渲染层：五视图 + 向导（原生 JS，无框架）
tools/         gen-icon.js（窗口 / 托盘统一图标生成）、shoot.js（可见窗口截图验证）
```

耦合契约 = 内容 schema（见 `lane-theme/docs/schema.md`）：客户端只读写 frontmatter 字段、`site.config.json` 与素材目录，不修改主题代码。

## 安全说明

Token 仅存于本机用户数据目录；push 凭据以 `x-access-token` 形式写入远程 URL（本地仓库私有使用）。生产建议改用 Git credential manager 或 OAuth 应用（需注册 client_id，见规格书 F1）。

MIT © 2026 lane contributors