import GlassCard from "../shared/GlassCard";

export default function TextWorkspaceCard({
  projectName,
  setProjectName,
  currentProject,
  projects,
  sourceText,
  setSourceText,
  isParsing,
  parseProgress,
  error,
  onCreateProject,
  onSelectProject,
  onFillDemo,
  onParse,
  onCancelParse,
}) {
  return (
    <GlassCard>
      <h2>文本输入</h2>
      <p className="muted">粘贴小说、章节内容或测试样例，为 LLM 解析剧本做准备。</p>
      <div className="controlRow">
        <input className="textInput" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="新项目名称" />
        <button type="button" className="primaryButton ghostButton" onClick={onCreateProject}>
          新建项目
        </button>
      </div>
      <div className="controlRow">
        <select className="textInput" value={currentProject?.id || ""} onChange={(event) => onSelectProject(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button type="button" className="primaryButton ghostButton" onClick={onFillDemo}>
          填充示例
        </button>
      </div>
      <textarea
        className="textArea"
        value={sourceText}
        onChange={(event) => setSourceText(event.target.value)}
        placeholder="在这里输入文本，例如：旁白：暮色渐浓。林黛玉：宝哥哥，你来了。"
      />
      <div className="controlRow">
        <button type="button" className="primaryButton" onClick={onParse} disabled={isParsing || !sourceText.trim()}>
          {isParsing ? `解析中 ${parseProgress}%` : "开始解析"}
        </button>
        <button type="button" className="primaryButton ghostButton" onClick={onCancelParse} disabled={!isParsing}>
          取消解析
        </button>
        <span className="muted">{currentProject ? `将写入项目：${currentProject.name}` : "未选择项目"}</span>
      </div>
      {error ? <div className="errorText">{error}</div> : null}
    </GlassCard>
  );
}
