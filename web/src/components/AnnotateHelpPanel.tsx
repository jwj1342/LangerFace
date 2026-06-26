export function AnnotateHelpPanel() {
  return (
    <details className="card help-doc" open>
      <summary>标注帮助</summary>
      <ol>
        <li>先加载 FLAME 标准脸；如果标注自定义头模，只能导出 xyz 折线。</li>
        <li>选择 RSTL 或 Langer，填写线名和面部分区。</li>
        <li>点击“开始一条线”，然后在 3D 脸表面逐点点击。</li>
        <li>每条线至少 2 个点；点够后点击“保存当前线”。</li>
        <li>相邻控制点会沿网格表面连接，不会直接穿过头模；跨区域时可多点控制走向。</li>
        <li>继续填写下一条线并保存，直到完成该区域。</li>
        <li>在标准脸上标注后导出待复核图谱草案；通过临床评审后再进入项目资产。</li>
      </ol>
      <p>快捷键：Ctrl/⌘ + Z 撤销上一个点；如果当前没有正在画的线，会恢复上一条已保存线继续编辑。</p>
    </details>
  );
}
