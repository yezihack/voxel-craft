Type: task
Status: needs-triage
Blocked by: —

# 第 8 种结构：学堂

`dims.js` 加 `collectAcademy`，`STRUCT_NAME[8] = '学堂'`，`collectStruct` 加 `case 8`。

三个必须处理的点：

1. **重分 `structAt` 的 hash 概率区间**。学堂要和村庄/遗迹/神殿抢同一批网格锚点，
   不重分的话村庄会明显变稀有。
2. **收集交互点**。学堂里的「讲席」位置必须在结构生成时登记出来
   （结构形状是纯函数、按坐标查询，事后枚举不出来），供 06 挂题干用。
3. 形状函数走 `structShapeCache` 那套缓存，别自己另建一份缓存。

验收：主世界里能走进一所学堂，且村庄出现频率没有肉眼可见的下降。

## Answer

## Comments
