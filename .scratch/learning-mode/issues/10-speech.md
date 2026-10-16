Type: task
Status: needs-triage
Blocked by: —

# 语音朗读：speak() 抽象 + speechSynthesis 实现

`src/game/learning/speech.js`，对外只暴露 `speak(text, lang)`。

- 现有 `audio.js` 只有振荡器合成音，**没有**任何语音能力，这是新增。
- `speak()` 必须能在「无语音可用」时被安全调用：没有 `speechSynthesis`、
  音色缺失、用户关掉开关，三种情况都**静默返回**，不抛错、不弹提示。
- 绝不允许出现「朗读完再做某件事」这类依赖语音时序的逻辑（ADR-0005）。
- iOS Safari 必须由用户手势触发 —— 朗读只能挂在点击/按键的调用栈里，
  不能挂在「走近学堂自动播」这种路径上。

## Answer

## Comments
