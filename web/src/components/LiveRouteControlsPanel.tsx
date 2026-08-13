import { Card } from "./ui/card";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";

export function LiveRouteControlsPanel() {
  return (
    <Card>
      <Label>显示模式</Label>
      <Hint className="live-inline-top">
        2D 实时贴合。Live 工作台以 MediaPipe 个体化 RSTL 为唯一运行时路径。
      </Hint>
    </Card>
  );
}
