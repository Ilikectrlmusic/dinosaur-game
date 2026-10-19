# SAURIAN — 奔向荒野

使用 Three.js 制作的 3D 恐龙骑乘跑酷游戏。所有模型、沙漠纹理、肖像和音效均在本地生成，无需远程素材或 API 密钥。

在线游玩：**[SAURIAN — 奔向荒野](https://ilikectrlmusic.github.io/dinosaur-game/)**

## 发布

推送到 `main` 后，GitHub Actions 会安装锁定版本的依赖、验证游戏规则、构建并发布到 GitHub Pages。发布流程见 `.github/workflows/pages.yml`。仓库的 Settings → Pages → Source 使用 **GitHub Actions**。

Vite 构建使用相对资源路径，因此游戏可在 GitHub Pages 的仓库子路径下直接运行。

## 运行

需要 Node.js 20.19+（或 22.12+）。

```sh
npm ci
npm run dev
```

开发服务器默认端口 5173。`npm run build` 生成 `dist/`，`npm run preview` 检查生产构建。

## 操作

| 按键                        | 操作                                   |
| --------------------------- | -------------------------------------- |
| Space / ↑ / W               | 跳跃                                   |
| 按住 ↓ / S                  | 伏低身体                               |
| V                           | 第一／第三人称视角                     |
| Esc / P                     | 暂停、继续                             |
| R                           | 重新出发                               |
| M                           | 音效开关                               |
| F                           | 全屏                                   |
| 鼠标左键拖动 / 手指拖动画面 | 环顾视角（第一人称转头，第三人称环绕） |
| 双击画面                    | 镜头回正                               |

游戏使用一条赛道，通过跳跃和低头躲避障碍。手机左侧按钮按住低头，右侧按钮跳跃，拖动画面可围绕骑手转动视角。三位骑手外观不同；三种难度影响初速度、加速上限与障碍间隔。最佳距离按难度单独保存于浏览器。

速度随存活时间持续增加，达到对应难度的上限后保持。仙人掌有矮、中、高三种高度，均可通过提前起跳越过。翼龙有两档飞行高度：低飞的需要跳过，低头无效；高飞的只能按住低头从下方穿过，跳跃会撞上。随着提速，障碍的出现间隔也会缩短，同时保留落地和切换姿势的时间。

碰撞后使用 cannon-es 刚体、地面接触和受限关节模拟恐龙与骑手翻滚，保留碰撞瞬间的位置和动量。音效通过 Web Audio 实时合成，需用户首次点击后才能播放。模型为程序化平滑网格，不依赖外部 3D 资产。浏览器中未启用 WebGL 时会显示恢复说明。

## 验证

```sh
npm run build
npm test
```

默认测试使用 Chromium。读取 `CHROMIUM_PATH`，没有设置时尝试 `/usr/bin/chromium`；可安装 Playwright Chromium 后通过该变量指定路径。

手机 Safari 回归使用 Playwright WebKit：安装 `npx playwright install --with-deps webkit` 后运行 `npx playwright test --project=mobile-webkit`。如需指定已有的 WebKit 启动器，可设置 `WEBKIT_PATH`。测试覆盖单赛道、镜头居中、长按与触摸取消，以及连续死亡后重开、返回营地和动画异常恢复。
