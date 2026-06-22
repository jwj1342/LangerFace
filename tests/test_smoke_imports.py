"""冒烟测试：导入 langerface 的每一个子模块。

不需要 mediapipe / opencv（这些在各模块内延迟导入），只需 numpy。
作用：在没有完整运行环境时也能尽早抓出包重构后的导入断裂。
"""
import importlib
import pkgutil

import langerface


def test_import_every_submodule():
    failures = []
    for mod in pkgutil.walk_packages(langerface.__path__, langerface.__name__ + "."):
        try:
            importlib.import_module(mod.name)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{mod.name}: {exc!r}")
    assert not failures, "子模块导入失败:\n" + "\n".join(failures)


def test_public_api_surface():
    for name in ("Config", "LineStyle", "build_config", "SYSTEM_RSTL", "SYSTEM_LANGER", "VALID_SYSTEMS"):
        assert hasattr(langerface, name), f"langerface 顶层缺少 {name}"
