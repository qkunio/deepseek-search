# DeepSeek Search

仿百度样式的纯前端搜索页，基于 [DeepSeek Search API](https://api-docs.deepseek.com/api/search)。

在线地址：https://qkunio.github.io/deepseek-search/

## 功能

- 首页：DeepSeek logo + 搜索框，右上角「设置」弹窗配置 API Key、是否生成候选词
- 输入时实时调用 `deepseek-flash`（关闭思考模式）生成下拉联想词，支持键盘 ↑/↓/Esc、中文输入法
- 每次搜索调用 `POST /v1/tools/search` 取最多 50 条结果，前端每页 10 条分页
- 结果页：关键词标红、站点图标与名称、发布日期、「权威」标签、可展开长摘要
- 底部「相关搜索」同样由 `deepseek-flash` 生成
- URL 形如 `?wd=关键词&pn=2`，可分享、支持浏览器前进后退

## 说明

- 无构建步骤，`index.html` + `style.css` + `app.js` 直接部署到 GitHub Pages
- API Key 只保存在浏览器 `localStorage`，请求由浏览器直接发往 `api.deepseek.com`
- 本地开发：`python -m http.server 5173`，可选新建不入库的 `config.local.js`（`window.DS_LOCAL_KEY = 'sk-...'`），仅在 localhost 下加载
