Status: resolved
Type: task

## 需求

超平坦世界；矿车、红石块、红石火把、火把、铁轨、充能铁轨；传送装置与传送带。

## 做法

- `config.js`：BLOCKS 78-84 + ITEMS 257/258，`shape` / `cutout` / `power` / `rail` / `belt` / `pad` 标记。
- `textures.js`：程序化贴图 + 物品图标。
- `mesher.js`：`sheetCorners` 支持 `cross` / `plate`，走 `uCutout`，正反双面。
- `carts.js`（新）：矿车实体、上下车、沿轨行驶、死路掉头、充能铁轨靠邻近红石块供电加速。
- `transport.js`（新）：传送带按方向推人（含车上）、传送板两两配对互传（带冷却）、传送珠短距瞬移。
- `world.js` / `generate.js` / `uiActions.js`：超平坦，`pickWorldType` 切三张缓存并清场。
- `crafting.js` / `veilKeys.js` / `helpKeys.js`：配方与文案。

## Answer

已实现。`npx vite build` 通过；probe 27 条断言全过；贴图格 183 / 256。
