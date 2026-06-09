# 评论系统说明

## 概述

本文档服务器内置了文本选中评论功能。用户可以在渲染后的章节页面中选中任意文本段落，添加评论。评论数据持久化到 `data/comments/` 目录下，每章一个 JSON 文件。

## 数据文件位置

```
data/comments/<章节文件名>.json
```

例如：`data/comments/03-使用指南.json`

## 数据格式

```json
{
  "file": "03-使用指南.md",
  "comments": [
    {
      "id": "a1b2c3d4",
      "author": "张三",
      "sectionHeading": "3.2 章节导航",
      "sectionLevel": 2,
      "selectedText": "文档服务器会根据 Markdown 文件生成章节导航",
      "textHash": "e4f5a6b7",
      "contextBefore": "在内容组织中我们提到，",
      "contextAfter": "，方便读者按章节浏览长文档",
      "comment": "这里可以补充章节排序规则和 README 首页行为说明",
      "createdAt": "2026-06-05T10:30:00.000Z",
      "resolved": false
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 评论唯一标识（8 位 hex），页面展示为 `#a1b2c3d4`，可点击复制 |
| `author` | string | 评论者署名 |
| `sectionHeading` | string | 选中文本所在章节标题（如 "3.2 文档 CRUD"），用于定位 |
| `sectionLevel` | number | 章节层级（1=h1, 2=h2, 3=h3, 4=h4） |
| `selectedText` | string | 用户选中的原文文本 |
| `textHash` | string | 选中文本的 SHA-256 前 8 位（浏览器端 DOM 匹配用） |
| `contextBefore` | string | 选中文本前 20 个字符 |
| `contextAfter` | string | 选中文本后 20 个字符 |
| `comment` | string | 评论内容 |
| `createdAt` | string | 创建时间（ISO 8601） |
| `resolved` | boolean | 是否已解决 |

## 如何定位评论对应的原文

在源 `.md` 文件中定位评论目标文本，按优先级使用以下字段：

1. **`sectionHeading`** — 先在文件中搜索该章节标题，缩小范围
2. **`selectedText`** — 在章节范围内搜索选中文本
3. **`contextBefore` + `contextAfter`** — 用前后文验证匹配正确性

示例：评论 `#a1b2c3d4` 指向 `03-使用指南.md` 中 "3.2 章节导航" 章节下的 "文档服务器会根据 Markdown 文件生成章节导航" 这段文本。

## 与 Agent 交互

当你收到评论数据后，可以：

1. 读取 `data/comments/<文件>.json` 获取该章所有评论
2. 根据 `sectionHeading` + `selectedText` 在源 `.md` 文件中定位
3. 根据 `comment` 内容进行修改、补充或优化
4. 修改完成后，将 `resolved` 设为 `true`（通过 PATCH API 或直接编辑 JSON）

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/comments/<文件>.md` | 获取该章所有评论 |
| POST | `/api/comments/<文件>.md` | 新增评论（JSON body） |
| DELETE | `/api/comments/<文件>.md?id=<id>` | 删除指定评论 |
| PATCH | `/api/comments/<文件>.md?id=<id>` | 更新评论（如 `{"resolved": true}`） |
