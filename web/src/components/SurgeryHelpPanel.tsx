import { HelpDisclosure } from "./ui/help-disclosure";

export function SurgeryHelpPanel() {
  return (
    <HelpDisclosure title="这是在演示什么？">
      <ol>
        <li>右侧是标准三维面部模型，青色是医生标注的 <b>RSTL 皮肤张力线</b>。</li>
        <li>标一个肿物 → 做一个梭形切除（把那块组织去掉）。</li>
        <li>周围皮肤被<b>预张力</b>拉着把伤口合上，并有轻微回弹。</li>
        <li>颜色 = 闭合<b>新增</b>的张力（已扣除皮肤静息张力）：远处保持肤色，只有伤口处会变。</li>
        <li><b>沿 RSTL 切</b>：观察闭合时伤口周围新增张力如何局部变化。</li>
        <li>该页面只提供力学直觉辅助，不和切口候选规划混用。</li>
      </ol>
    </HelpDisclosure>
  );
}
