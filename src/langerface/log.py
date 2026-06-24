"""集中日志（可观测性）。

库代码用 ``get_logger(__name__)`` 取 logger，**不**自行配置 handler；
应用入口（apps/*）调用一次 ``configure_logging()`` 决定输出格式与级别。
环境变量 ``LANGERFACE_LOG_LEVEL`` 可覆盖默认级别（如 DEBUG / WARNING）。

结构化诊断（issue #51）：业务路径用 ``logger.*(..., extra={...})`` 记录阶段耗时、
检测失败原因、资产版本等。字段命名与 web 端（``web/logger.js`` /
``docs/OBSERVABILITY.md``）保持单一真源：``event`` / ``phase`` / ``durationMs`` /
``reason`` / ``assetVersions`` / ``langerfaceVersion``。``Phase`` 与
``DetectFailureReason`` 在此集中定义，避免失败原因散落成自由文本。
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager

_CONFIGURED = False
_DEFAULT_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


# ── 结构化诊断字段约定（与 web/logger.js 单一真源对齐）─────────────────────────
class Phase:
    """阶段名常量（对应 OBSERVABILITY.md 的 ``detail.phase``）。"""

    ASSETS = "assets"
    FRAME = "frame"
    DETECT = "detect"
    SCAN = "scan"


class DetectFailureReason:
    """检测/业务失败原因枚举（对应 OBSERVABILITY.md 的 ``detail.reason``）。

    用可枚举的小写蛇形常量，让失败可归类、可计数，而非仅一句自由文本告警。
    """

    NO_FACE = "no_face"  # 检测未返回任何人脸
    NO_TIMESTAMP = "no_timestamp"  # VIDEO 模式缺时间戳
    ATLAS_MISSING = "atlas_missing"  # 选中线系统的图谱未加载
    NO_ATLAS_LOADED = "no_atlas_loaded"  # 一个图谱都没加载到
    DETECTOR_CLOSE_ERROR = "detector_close_error"  # 关闭检测器时出错

    #: 全部合法取值，便于测试/导出端校验。
    ALL = frozenset(
        {
            NO_FACE,
            NO_TIMESTAMP,
            ATLAS_MISSING,
            NO_ATLAS_LOADED,
            DETECTOR_CLOSE_ERROR,
        }
    )


def langerface_version() -> str:
    """返回 ``langerface.__version__``（结构化诊断里回指构建版本用）。"""
    from . import __version__

    return __version__


def get_logger(name: str) -> logging.Logger:
    """库内统一取 logger 的入口。"""
    return logging.getLogger(name)


@contextmanager
def log_stage_duration(logger: logging.Logger, event: str, phase: str, **extra):
    """上下文管理器：用 ``perf_counter`` 度量一段代码耗时，退出时发一条结构化 debug 日志。

    记录字段 ``event`` / ``phase`` / ``durationMs``（命名与 web 端一致）。仅做观测，
    不吞异常——异常照常向上抛，但仍会带上已测得的 ``durationMs`` 落一条日志。
    """
    t0 = time.perf_counter()
    failed = False
    try:
        yield
    except BaseException:
        failed = True
        raise
    finally:
        duration_ms = (time.perf_counter() - t0) * 1000.0
        logger.debug(
            "%s 耗时 %.2fms",
            phase,
            duration_ms,
            extra={
                "event": event,
                "phase": phase,
                "durationMs": duration_ms,
                "failed": failed,
                **extra,
            },
        )


def configure_logging(level: int | str | None = None) -> None:
    """由应用入口调用一次，配置根 logger。重复调用是幂等的。

    level: 显式级别；为 None 时取环境变量 LANGERFACE_LOG_LEVEL，再退回 INFO。
    """
    global _CONFIGURED
    if level is None:
        level = os.environ.get("LANGERFACE_LOG_LEVEL", "INFO")
    if isinstance(level, str):
        level = logging.getLevelName(level.upper())
    if _CONFIGURED:
        logging.getLogger().setLevel(level)
        return
    logging.basicConfig(level=level, format=_DEFAULT_FORMAT)
    _CONFIGURED = True
