# 日语阅读学习

手机优先的日语学习 Web 应用（PWA）。导入小说或文章后逐句分析：

- **日译中**：点击单词显示读音、原形和释义；长按句子显示中文翻译和用到的语法
- **中译日**：点击中文词语显示对应的日语词、读音和释义；长按句子显示日语译文和语法
- 点击释义进入单词 / 语法详情页（AI 生成的详细讲解、例句、近义辨析）
- 收藏单词和语法，自动记录来源句；同一个词在不同句子中收藏会合并显示多个来源句，点击来源句跳回原文位置
- 导入 `.txt` / `.docx` 或直接粘贴文本，自动按语言分到日语书库 / 中文书库，书名可修改

## 技术方案

- React + TypeScript + Vite，PWA，可添加到手机主屏幕
- 日语分词、读音、原形：本地 [kuromoji](https://github.com/takuyaa/kuromoji.js)（不消耗 API）
- 中文分词：浏览器内置 `Intl.Segmenter`
- 翻译、语法、释义：通过 OpenAI 兼容接口调用大模型（默认 `gemini-3.1-flash-lite`，详解用 `gemini-3.5-flash`），结果缓存在本地，同一句不会重复请求
- 数据：全部保存在本机浏览器 IndexedDB，可在设置里导出 / 恢复备份

## 开发

```bash
cd app
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建，输出到 app/dist
```

首次使用时在应用的「设置」里填写接口地址和 API Key（只保存在本机）。

## 部署

推送到 `main` 分支后，GitHub Actions 会自动构建并发布到 GitHub Pages（需要在仓库 Settings → Pages 中把 Source 设为 GitHub Actions）。
