"""集中日志（可观测性）。

库代码用 ``get_logger(__name__)`` 取 logger，**不**自行配置 handler；
应用入口（apps/*）调用一次 ``configure_logging()`` 决定输出格式与级别。
环境变量 ``LANGERFACE_LOG_LEVEL`` 可覆盖默认级别（如 DEBUG / WARNING）。
"""
from __future__ import annotations

import logging
import os

_CONFIGURED = False
_DEFAULT_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def get_logger(name: str) -> logging.Logger:
    """库内统一取 logger 的入口。"""
    return logging.getLogger(name)


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
