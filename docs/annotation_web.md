# 网页 3D 线标注（替代 3D Slicer）

把医生在 3D 头模上标注张力线的工作流，从桌面专业软件（3D Slicer）搬进**浏览器**——
与项目现有的 Vite + Three.js 前端同栈、零安装、并能**直接导出项目的图谱格式**。

> 这取代了早期 `标线工具.zip` 里的 3D Slicer 方案。Slicer 路线依赖桌面安装、纹理显示
> 不稳、且产出需要再转换；网页方案与部署前端一致，导出即用。

## 打开

```bash
cd web && npm run dev
# 浏览器打开 Vite 提示地址下的 /annotate.html，例如 http://127.0.0.1:5173/annotate.html
```

生产构建（Vercel）已把 `annotate.html` 纳入多页入口（见 `web/vite.config.js`）。

## 工作流

1. **加载网格**：点「加载标准脸」用内置标准脸网格；或「上传头模 JSON」（`{vertices:[[x,y,z]...], triangles:[[a,b,c]...]}`，例如 HeadSpace 头模经 `tools/headspace` 导出）。
2. **选线系统**：RSTL（首选）/ Langer；可填线名与区域。
3. **画线**：拖拽旋转、滚轮缩放；**点击**在网格表面落一个控制点（射线拾取，落点贴合表面）。
4. **新建 / 撤销点 / 完成线**：一条线 ≥2 点才会收录；可在右侧列表删除任意线。
5. **导出**：
   - **导出图谱**（仅在标准脸上标注时可用）：输出 langerface 图谱格式，每点 `[三角面 id, u, v]`（重心坐标，`w=1−u−v`），与 [`src/langerface/lines/atlas.py`](../src/langerface/lines/atlas.py)、`assets/atlas_*.json` 一致 —— **可直接作为图谱 / 临床校验产物**。
   - **导出 xyz**：任意头模通用的 3D 折线（`[x,y,z]`，网格局部坐标），与 `tools/headspace` 的 `*_xyz` 线兼容。

## 它如何接入项目

- **临床校验闭环（issue #2）**：医生在标准脸上画/改线 → 导出图谱 → 评审后替换 `assets/atlas_rstl.json` 并把 `validated` 置 `true`、在 `provenance` 记录校验者 → 被 2D 实时管线与对拍测试直接使用。
- **3D 头模标注**：HeadSpace 等头模由 [headspace 离线管线](headspace_pipeline.md)产出/配准（数据获取见 [headspace_data.md](headspace_data.md)），导出为 `{vertices, triangles}` JSON 供本页加载；标注得到的 xyz 线再经 `langerface.geometry`（加权 Sim3）在头模与标准脸之间迁移。
- **数据隐私**：真实头模（HeadSpace）**不入库**，仅本地使用；标注产物（图谱/xyz JSON，仅坐标）可入库评审。

## 实现

| 文件 | 职责 |
|---|---|
| `web/annotate_model.js` | 纯数据模型：线/点管理、重心坐标、导出图谱/xyz（node 可单测，见 `tools/test_annotate_model.mjs`） |
| `web/annotate_viewer.js` | Three.js 场景：网格加载、射线表面拾取、线与控制点渲染 |
| `web/annotate_main.js` | UI ↔ 模型 ↔ 视图 的装配（指针拖拽/点击、导出、列表） |
| `web/annotate.html` / `annotate.css` | 标注页与样式 |
