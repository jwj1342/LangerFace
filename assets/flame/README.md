# FLAME 资产目录（license-gated，**不入库**）

本目录用于存放 **FLAME** 头模派生文件，供 3D FLAME 轨（见 issue #61）的拓扑导出 / 离线拟合使用。

> ⚠️ **本目录除本 README 外全部 gitignore。** 仓库**不提交任何 FLAME 衍生资产**——
> 即便是 neutral 几何，FLAME 也要求逐用户在 MPI 注册并接受 license 后才能（再）分发。

## License

- FLAME 模型：在 <https://flame.is.tue.mpg.de> 注册账号、接受 model license 后下载。
  - 旧版 FLAME 多为 *non-commercial scientific research* license；**FLAME 2023 Open** 为 CC-BY-4.0（优先调研对象），但**再分发**通常仍需逐用户注册。
  - FLAME **texture model** 为 CC-BY-NC-SA 4.0（非商用 + share-alike）——**不要**用于公开部署的生产路径。
- 引用：Li et al., *Learning a model of facial shape and expression from 4D scans*, SIGGRAPH Asia 2017。

## 放什么

| 文件 | 用途 |
|---|---|
| `flame_neutral.obj` | FLAME neutral 头模（你从 FLAME 导出的 OBJ）。`tools/export_flame_topology.py` 读它生成 `web/assets/topology_flame_2023.json`。 |
| `generic_model.pkl` / `FLAME2023/` | 完整 FLAME 模型（shape/expression 基），供离线拟合（Phase 3）使用。 |

## 用法

```bash
# 资产就位后，导出 web 端拓扑契约（仅含三角拓扑 + 元数据）
python tools/export_flame_topology.py
```

资产缺失时该脚本会安全跳过并打印获取指引，CI / 他人 checkout 不受影响。

亦可用环境变量 `LANGERFACE_ASSETS_DIR` 把资产目录指到仓库外的本地路径（见 `src/langerface/config/assets.py`）。
