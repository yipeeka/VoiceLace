import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      message: "",
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "页面渲染失败",
    };
  }

  componentDidCatch(error) {
    console.error("UI crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div className="glassCard" style={{ maxWidth: 680, width: "100%" }}>
            <h2>页面发生错误</h2>
            <p className="muted">已阻止整页白屏。你可以刷新页面，或回到文本页继续操作。</p>
            <pre className="codeBlock compactLog">{this.state.message}</pre>
            <div className="controlRow">
              <button type="button" className="primaryButton" onClick={() => window.location.reload()}>
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
