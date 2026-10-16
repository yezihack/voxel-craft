Type: task
Status: needs-triage
Blocked by: 02

# DOM 作答面板（点选为主）

`QuizPanel.vue` + `uiActions.js` 的 `openQuiz` / `answerQuiz` / `closeQuiz`。

- **点选为主，不要求键盘输入汉字**。3–4 年级打字极慢，一旦要求打字产品就死了。
  题型落到：点字、点词、拖拽排序、连词成句。
- 面板打开时必须退出指针锁定、关闭时锁回去 —— 照抄 `openBag` / `closeBag` 那套，
  包括「浏览器冷却导致锁定被拒」时退化成暂停遮罩的兜底。
- 判定一律走 `quiz.js` 的 `judge()`，组件里**不许出现**字符串比较式的判分。

## Answer

## Comments
