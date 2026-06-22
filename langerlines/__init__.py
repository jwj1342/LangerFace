"""朗格线 / RSTL 面部投射系统 (Langer / RSTL facial line projection).

把皮肤张力线（RSTL / Langer 线）稳定地叠加到人脸照片、视频或实时摄像头画面上，
作为面部手术切口规划的**决策辅助可视化**。

医学声明：本系统是可视化辅助工具，不是手术指令，也不是受监管的医疗器械。
内置的线条图谱为示意性首版，必须经临床医生校验后方可参考。详见 docs/MEDICAL.md。
"""

from .config import Config, LineStyle, SYSTEM_RSTL, SYSTEM_LANGER

__all__ = ["Config", "LineStyle", "SYSTEM_RSTL", "SYSTEM_LANGER"]
__version__ = "0.1.0"
