# 桌宠(Desktop Pet)实验性功能设计

> 状态:M1(悬浮窗 + 占位团子 + 设置开关)、M2(状态机 + WS 事件驱动)、M3(多宠物/目录扫描/外部格式兼容)、M4(拖拽方向/review/工具脉冲/气泡/点击)、M5(右键菜单 + 点击穿透;悬浮菜单/信息气泡/小跟班/时间维度/散步/交互重排)、M6(视觉归一)已实现

## M5 实现要点(2026-08-21):右键菜单 + 点击穿透

- 右键菜单(前端自绘;原生 muda 菜单无法定制样式,弃用):PetWindow `onContextMenu` 在窗内弹自绘菜单——换宠物(悬停浮出子菜单,200ms 延迟关闭防平移误收;窗口仅 240 宽,子菜单浮左侧与主菜单部分重叠,靠 z-index 盖住)、点击穿透(带"已开启"徽标)、隐藏桌宠;关闭路径:遮罩点外关闭、遮罩上再右键换位重开、**窗口失焦(onFocusChanged)或 Esc 关闭**(补原生菜单的"点桌面其他地方收起"行为);菜单按实测尺寸收边在 240x250 窗口内(先 `visibility:hidden` 测量再落位防闪);菜单动作直调 `petSetActive` / `petSetClickThrough` / `petSetEnabled` 命令,Rust 侧无菜单代码。与 M5 P1 交互重排共存:单击 = 开关 pet-menu 悬浮菜单,双击 = 唤回主窗,右键 = 本自绘菜单。
- 点击穿透:配置 `pet_click_through`(desktop-config.json);开启即 `set_ignore_cursor_events(true)`,拖动/右键/点击全部失效——**唯一关闭入口是设置页开关**(桌宠卡内已写明);`pet::show()` 建窗时按配置补齐。
- `PetConfig` 载荷加 `clickThrough`(与 M5 P5 的 `wander` 并存),`pet_config_get` 与 `pet:config-changed` 共用 `pet_config_json`,设置页经事件同步开关/宠物/穿透/散步状态。
- 宠物包导入(2026-08-21):设置页"导入 zip"选文件,字节传 `pet_import_zip` 命令;Rust 侧 `pet::import_zip` 解压到 `<config_dir>/pets/<slug>`(与 skins 目录同级)。slug 决策:先读包内 pet.json 的标识字段(slug → id → displayName → name,清洗后首个合法候选生效),zip 文件名只作兜底——petdex 下载的包文件名都叫 zip.zip,按文件名命名会互相撞车。只解 pet.json 与 spritesheet.webp/png 三个文件(条目经 `enclosed_name` 过滤防 zip slip),包内可放根目录或子目录(取最浅一份);无 pet.json 但有精灵图时按 petdex 布局兜底生成最小 pet.json;落盘后过 `parse_pet_dir` 校验,失败清目录报错;同名目录已存在则拒绝。导入成功前端刷新列表并直接 `petSetActive` 换上新宠物。依赖 `zip` crate(default-features=false + deflate,纯 Rust 后端)。

## M3 实现要点(2026-08-18)

- 宠物来源四处:内置注册表(打包 spritesheet,`pet.rs::builtin_pets()`;素材在 `src/assets/pets/<slug>/`,前端 `import.meta.glob` 按 slug 取图)、`<config_dir>/pets/*`(source `custom`,与 skins 目录同级,zip 导入落这里)、`<kimi_home>/pets/*`(source `kimi-code`,兼容旧布局)、`~/.petdex/pets/*`(source `petdex`);slug=目录名,去重 custom > kimi-code > petdex,坏条目跳过。
- pet.json 三格式归一化(Rust `pet.rs::parse_pet_dir`):`schema=="kimi-desktop-pet/1"` 原生格式;`schemaVersion=="kimi-pet.v0"`(FeiZhuLulu/kimi-pet,animations 映射 thinking/tool_use/editing/terminal→running、waiting_approval→waiting、success→jumping、error→failed);无标记按 petdex 布局兜底(192x208、8 帧/行、固定行序)。展示名统一按 `name` → `displayName` → slug 取(kimi-pet.v0 在 displayName 后另有 `id` 兜底)。
- 外部精灵图走自定义协议 `pet://`(Windows 前端 URL 形态 `http://pet.localhost/<slug>`,lib.rs `register_uri_scheme_protocol` 实现,slug 白名单防路径穿越,优先 spritesheet.webp 其次 .png);CSP img-src 已放行。
- 配置 `pet_slug` 存 desktop-config.json;命令 `pet_list`/`pet_active_get`/`pet_set_active`(均不建窗,sync 即可);切换时 emit `pet:config-changed`(载荷完整 PetConfig `{enabled, slug}`),桌宠窗与设置页都靠它重载。
> 参考:[crafter-station/petdex](https://github.com/crafter-station/petdex)

## M5+M6 实现要点(2026-08-21):悬浮菜单 / 信息气泡 / 小跟班 / 时间维度 / 散步 / 视觉归一

- **交互重排(P1)**:单击宠物 = 开/关悬浮菜单(`pet_menu_toggle`,waving 点击反馈保留);双击 = 唤回主窗(新 async 命令 `pet_restore_main`,包 `restore_main` 的 unminimize+show+focus)。桌宠与主窗**不互斥**、常驻(互斥联动方案已否决,未实施)。
- **悬浮菜单(P3)**:新 Tauri 窗口 label `pet-menu`,`index.html?window=pet-menu` 分流渲染 `src/components/pet/PetMenu.tsx`;锚定宠物窗顶边居中 + 屏幕 clamp;Rust 侧 `on_window_event` 失焦收起(`ever_focused` 守卫防建窗抢焦误收,hide 不 close 保留前端状态);会话列表走 REST `/api/v1/sessions` 10s 轮询(窗口 hidden 暂停);钉选会话存 desktop-config.json `menu_pinned_sessions`(`pet_menu_pin_toggle`/`pet_menu_pins_get`);快捷行「主窗口/统计/设置」走 async 命令 `pet_menu_navigate`(先 `restore_main` 再 emit `app:navigate {view, sessionId?}`,主窗 App.tsx listen 切 view;先 restore 后 emit,主窗隐藏时 webview 存活、listen 不丢)。
- **跳会话已落地**:官方 web UI(0.37.2 起)支持 `/sessions/<id>` 路径路由(核实依据:前端产物 `selectSession`/`onSessionRoutePopState`);ShellHome 消费 `stores/ui.ts` 的 `pendingSessionFocus`,拼 `/sessions/<id>?_=<ts>#token` 重载 iframe。新 capability `src-tauri/capabilities/pet-menu.json`(只放 event listen/unlisten)。
- **信息气泡(P2)**:新事件 `pet:bubble {text, tone: info|warn}`(`emit_bubble`,同类 2s 合并、全局 1s 限流)。触发源:turn.ended 概要(时长优先取载荷 `durationMs`,缺失回退自算;工具数按会话累计 `tool.call.started`)、approval.requested 详情(`tool_input_display.command` → `action` → `tool_name` 依次取,截断 40 字符,同会话 waiting 中不重复;字段名经 `server/events/*.jsonl` 实测)、配额提醒(ws.rs 新周期任务 5min 轮询 `/api/v1/oauth/usage`,≥80% info / ≥95% warn,每档每自然日一次)。前端气泡 warn 档变色、220px 截断;STATE_BUBBLE 摘掉 jumping(概要气泡取代)。
- **小跟班(P4)**:`review_agents` 泛化为 `active_subagents: HashMap<subagentId, name>`,review 判定 = 任一 name 含 "review";新事件 `pet:minions {count}`(数量变化即发,STALE 清空补发 0)。前端 MinionSprite 独立小 canvas(DOM overlay,0.45 缩放 idle 行循环 + CSS bob),最多 3 只,>3 挂「+N」角标;不进 displayed 优先级链。
- **时间维度 + 散步(P5)**:PetState 新增 `tired`(running 分支细分:任一会话 turn 连续运行 >3min)与 `sleep`(idle 分支:last_activity >5min);init() 巡检改 500ms tick 无条件 recompute,时长到点无新事件也切换。前端 `resolveAnim` 回退 tired→running、sleep→idle,STATE_BUBBLE 各加一句;时段彩蛋纯前端(localStorage `kimi.petGreetedDate` 每日一句按本地时段)。闲置散步:配置 `pet_wander`(缺省开,设置页开关,新命令 `pet_set_wander`;`pet_config_json` 载荷统一加 `wander`),async 命令 `pet_nudge(dx)`(clamp 宠物所在显示器范围);前端 30-60s 随机走 100-300px(仅 idle/sleep 且无 minions 且未拖拽),撞边自动反向,移动时复用 running-left/right 动画。
- **契约三处同步**:`kimi-api.ts` / `tauri.ts` / `lib.rs` 注册一致——命令 `pet_restore_main` / `pet_menu_toggle` / `pet_menu_hide` / `pet_menu_navigate` / `pet_menu_pin_toggle` / `pet_menu_pins_get` / `pet_set_wander` / `pet_nudge`,事件订阅 `onPetBubble` / `onPetMinions` / `onPetMenuVisible`。

### M6 视觉归一(2026-08-21):菜单 = 宠物的大气泡

- **菜单锚定角色头顶**:`menu_position` 不再贴 pet 窗顶边,改锚 sprite 视觉头顶——sprite 在窗内水平居中、底边贴窗底,头顶 y = 窗顶 + 窗高 − frame_h×scale(frame 高取当前激活宠物的 PetMeta,`resolve_pet` 解析,回退内置 208;缩放用 pet 窗自身 scale_factor,兼容混合 DPI),菜单底边留 3px 间距。屏幕 clamp 保留:上方空间不够时菜单顶贴上沿,宁可盖住角色头顶也不裁菜单。
- **尾巴 + 生长动效(PetMenu)**:卡片底部中央加 12px 旋转正方形小三角(-mt-1.5 半叠卡片底边,bg/border 与卡片一致防透明窗穿帮),卡片 max-h 让出 6px;入场动效 origin-bottom、opacity/scale/translate 150ms ease-out,组件常驻故由 visibilitychange 在每次重show时重播,关闭无动画。
- **气泡归位(PetWindow)**:气泡从窗口顶部改贴角色头顶(`bottom: frameH + 4`,meta 未加载回退 208),带下指小三角(warn 档同步变色),圆角加大 + 100ms 淡入上浮(theme.css `pet-bubble-in`);单行截断(220px)使 42px 顶部空间(250−208)恰好容纳气泡+三角,窗口尺寸 240×250 不变。
- **互斥与跟随**:菜单 show/hide 广播 `pet:menu-visible {visible}`(menu_toggle 收拢路径改走 menu_hide 统一发事件;payload 无敏感信息);PetWindow 在菜单开着期间丢弃新气泡(showBubble 入口拦截,时段问候一并压制)、展开瞬间清除已显示气泡。动则收菜单:拖拽首次判定(onMouseMove 超阈值置 dragging 时)与闲置散步触发(petNudge 前)各调一次 `petMenuHide()`(未开时幂等 no-op)。

## 目标

在桌面悬浮一只宠物,实时反映 Kimi Code agent 的工作状态(闲置 / 工作中 / 等审批 / 完成 / 出错)。实验性功能,默认关闭。

## 已确认的决策

| 决策点 | 结论 |
| --- | --- |
| 资产格式 | pet.json schema 自建;spritesheet 物理布局兼容 petdex(192x208 帧、状态行序),可直接复用 petdex 社区宠物图 |
| 默认形象 | 内置一只 Kimi 官方形象,同时支持加载 petdex 宠物 |
| 窗口形态 | 独立悬浮窗(透明、无边框、置顶、可拖动) |
| 驱动粒度 | 细粒度 tool-call 驱动,带节流与状态优先级 |

## 事件清单(实据)

来自本机 `~/.kimi-code/server/events/*.jsonl`(服务端事件日志)的真实事件类型:

```
turn.started / turn.ended            turn 边界
turn.step.started / turn.step.completed
tool.call.started / tool.result      工具调用(细粒度驱动的核心)
event.approval.requested / event.approval.resolved   审批
event.session.status_changed / event.session.work_changed
prompt.submitted / prompt.completed
session.meta.updated / skill.activated / agent.created
```

`tool.call.started` 载荷含 `name`(工具名)、`turnId`、`toolCallId`、`display.kind`(file_io 等),为后续"按工具类型做不同反应"留了余地。

**WS 推送确认(已实据闭环)**:二进制(kimi.exe)证据 + 桌面端 ws.log 实测双重确认,v1 通道会推 `tool.call.started`:

1. 服务端事件流水(journal)中该事件带 `seq`/`epoch`/`session_id`,与 WS v1 帧信封完全一致;
2. 二进制内 v1 会话事件集合(`une = {"turn.started","turn.step.*","thinking.delta","assistant.delta","tool.use","tool.call.started","tool.call.delta","tool.progress","tool.result","agent.status.updated","prompt.completed","prompt.aborted","error"}`)明确包含 `tool.call.started`;
3. ws.log 实测(2026-08):`tool.call.started` / `turn.step.started` / `turn.ended` / `event.session.work_changed` 均有 EVT 记录;`prompt.submitted`/`turn.started` 未见推送(客户端侧事件),激活 running 由 `turn.step.started` / `tool.call.started` 覆盖;
4. volatile 帧(`assistant.delta` 等)占比最大,状态机显式跳过。

**订阅只对存活会话生效(08-18 实测定位)**:服务端 `createSessionState` 走 `getLiveSessionById`,历史会话未被任何客户端打开时,`subscribe` 会被拒并在 ack 里回 `not_found`(服务端源码:全局事件 `session.meta.updated`/`event.session.*` 无条件广播给所有连接,非全局事件只发 per-session targets)。桌面端曾对 ack 一律忽略,导致被拒会话在本地订阅集合里"假订阅"、永不重试,该会话只剩全局广播,桌宠全程不动。修复:ws.rs 对 subscribe/client_hello 的 ack 做 `not_found`/`resync_required` 对账(移出订阅集合待重试),并用全局事件到达作为"会话已存活"信号即时补订(替代原 `event.session.created` 单点钩子)。

## 状态机

spritesheet 状态行沿用 petdex 约定:`idle / running / waiting / jumping / waving / failed / running-left / running-right / review`。

| 事件 | 目标状态 | 优先级 |
| --- | --- | --- |
| `prompt.submitted` / `turn.started` | running | 中 |
| `tool.call.started` | running(脉冲,200ms 节流合并) | 中 |
| `event.approval.requested`、`work_changed`(pending_interaction=approval/question) | waiting | 高 |
| `event.approval.resolved` | 回落 running | 高 |
| `turn.ended` | jumping(成功)/ failed(带 error) | 高,播完回 idle |
| 静默 ~5s(无 turn 活动) | idle | 低 |

规则:volatile 帧(`assistant.delta` 等)不参与驱动;高优先级状态压住低优先级;running 脉冲只刷新动画不打断 waiting/failed。

**多会话聚合**(宠物全局一只,Rust 侧按会话跟踪活动后聚合):

- `waiting` 取并集:任一会话 pending approval/question 即进入,全部解决才退出;
- `running`:任一会话有活跃 turn;
- `jumping` / `failed`:turn.ended 触发一次性播放;若当前处于 waiting 则延后到 waiting 解除再播;
- `idle`:所有会话静默 ~5s 后进入;
- 状态聚合在 Rust 侧完成,前端只接收最终状态,不在渲染层做会话算术。

## 资产与加载

```
~/.kimi-code/pets/<slug>/
├── pet.json               自建 schema(见下)
└── spritesheet.webp|png   兼容 petdex 布局(192x208 帧,8x9 / 8x11 网格)
```

pet.json(schema `kimi-desktop-pet/1`):

```json
{
  "schema": "kimi-desktop-pet/1",
  "slug": "kimi",
  "name": "Kimi",
  "author": "Moonshot AI",
  "frame": { "width": 192, "height": 208 },
  "grid": { "cols": 8, "rows": 9 },
  "defaultFps": 8,
  "states": {
    "idle":    { "row": 0, "frames": 8, "fps": 4,  "loop": true },
    "running": { "row": 7, "frames": 8, "loop": true },
    "waiting": { "row": 6, "frames": 8, "fps": 4,  "loop": true },
    "jumping": { "row": 4, "frames": 8, "loop": false },
    "failed":  { "row": 5, "frames": 8, "loop": false }
  },
  "source": "builtin"
}
```

- `states` 的行号默认按 petdex 约定行序(idle / running-right / running-left / waving / jumping / failed / waiting / running / review);加载 petdex 宠物(`~/.petdex/pets/`,无 `schema` 字段)时按该行序自动映射,无需转换;
- 状态行的启用节奏:running-left / running-right / review / waving 已分别在 M4(拖拽方向/review/点击反馈)启用;tired / sleep 为 M5 时长显示态,无独立素材行,前端 resolveAnim 回退 running / idle;
- 启动扫描 `~/.kimi-code/pets/`,可选兼容扫描 `~/.petdex/pets/`;
- 内置 Kimi 官方形象打包进应用资源,作为默认宠物(`source: "builtin"`);
- pet.json 写盘遵循仓库原子写约定(临时文件 + 替换)。

## 架构落点

遵循「API 契约先行」约定:

1. `platform/kimi-api.ts`:`listPets()` / `getActivePet()` / `setActivePet(slug)` / `setPetEnabled(bool)` + `pet:state` 事件订阅;
2. `platform/tauri.ts`:对应 invoke 与 listen 实现;
3. Rust 侧:
   - `lib.rs` 注册命令;新增 `pet.rs` 负责宠物目录扫描、悬浮窗创建/销毁(参考 `lib.rs:1350` 建窗方式:transparent、decorations=false、always_on_top、skip_taskbar、shadow=false);
   - `ws.rs` `handle_frame` 已能拿到全量会话事件,在其中按上表做状态判定后 `app.emit("pet:state", ...)`,只发给宠物窗口;
4. 渲染层:`PetWindow` 组件(独立入口),canvas 逐帧绘制 spritesheet,按 `pet:state` 事件切状态行;拖动用 Tauri 的 `start_dragging`;
5. 设置页:实验性 toggle(默认关)+ 宠物选择列表。

**已踩过的坑(M1 实测)**:创建/销毁悬浮窗的命令必须是 `async`。Tauri 同步命令跑在主线程,而 `WebviewWindowBuilder::build()` 需要主线程事件循环参与 WebView2 初始化,同步命令里建窗会死锁(命令 enter 后无返回,配置已写但窗口不出现)。M2 新增涉及窗口操作的命令同样遵守。

## 安全与边界

- 宠物窗口只渲染本地精灵图,不发起网络请求,不接触 token;与现有「Bearer 不出本机」红线无交集;
- 悬浮窗不抢焦(focusable=false);点击穿透已在 M5 落地(设置页 + 右键菜单开关);
- 仅 Windows 验证,代码保持跨平台可行即可。

## 里程碑

- M1:悬浮窗 + 内置宠物 idle 动画 + 设置开关(不接事件,可拖动);
- M2:状态机 + WS 事件驱动(含 tool-call 脉冲、节流);
- M3:宠物目录扫描与切换、petdex 目录兼容;
- M4:方向拖拽动画(running-left/right)+ review 状态 + 工具差异化反应(pet:tool 脉冲)+ 台词气泡 + 点击交互(见「M4 实现要点」);
- M5:右键菜单(换宠物/点击穿透/隐藏桌宠)+ 点击穿透 + 悬浮菜单(会话列表/钉选/快捷导航/跳会话)+ 信息气泡(pet:bubble:turn 概要/审批详情/配额提醒)+ 小跟班 overlay(pet:minions)+ 时间维度(tired/sleep)+ 闲置散步 + 单击/双击交互重排(见顶部两节「M5 实现要点」);
- M6:视觉归一(菜单锚角色头顶 + 尾巴/入场动效 + 气泡归位 + 菜单开着压制气泡 + 动则收菜单,见「M5+M6 实现要点」)。

## M4 实现要点(2026-08-18 定稿)

启用三个闲置状态行,触发规则:

| 状态 | 触发 | 退出 |
| --- | --- | --- |
| running-left | 鼠标拖拽桌宠向左移动 | 拖拽结束(松开左键) |
| running-right | 鼠标拖拽桌宠向右移动 | 拖拽结束(松开左键) |
| review | 会话中 spawn 了 review 类子代理 | 该子代理 completed/failed/suspended |

**拖拽方向(running-left/right)——纯前端本地状态,不进 Rust 状态机**:

- `PetWindow` 用 `getCurrentWindow().onMoved`(Tauri v2 窗口移动事件,OS 拖拽期间持续触发)比较相邻位置 dx:dx 超过小阈值(如 4px)按符号切 running-left/right,停手/松开(onMouseUp)回到 Rust 状态机的当前状态;
- 显示优先级:拖拽状态本地覆盖一切(用户在把玩宠物,此时任务状态让位),即 `displayed = dragState ?? rustState`;
- `PetState` 类型加 `'running-left' | 'running-right'`,但 Rust 永远不 emit 这两个值。

**review(进行中)——Rust 状态机新增聚合输入**:

- 进入:`subagent.spawned` 且 `subagentName` 含 "review"(大小写不敏感;CLI 无内置 review profile,该名字来自用户/项目自定义子代理,如 `~/.kimi-code/subagents/review.md`);
- 退出:`subagent.completed` / `subagent.failed` / `subagent.suspended`(按 `subagentId` 配对);
- 事件载荷已核实(服务端源码):spawned 带 `subagentId`/`subagentName`;completed/failed/suspended 带 `subagentId`;均在 v1 推送集合内(仅 transcript 订阅者被抑制,我们是纯 v1,不受影响);
- 聚合与优先级:按 `subagentId` 建集合(与 active_turns 同构),**waiting > 一次性动作 > review > running > idle**;STALE 清扫连同 active_turns 一起清;
- Rust `PetState` 加 `Review`("review"),spritesheet 用 petdex 行序第 8 行。

**素材侧配套**(三种 pet.json 归一化都要补 states):

- 内置团子:running-left=行 2、running-right=行 1(M3 规范化时已用战斗行+镜像填充)、review=行 8;
- petdex 兜底布局:行序里本来就有这三行(1/2/8),states 映射补齐即可;
- `kimi-pet.v0`:无对应动画,不映射(前端缺失回退 idle/running,现有兜底逻辑已覆盖);
- `kimi-desktop-pet/1` 原生格式:pet.json 声明了就用,未声明同样走前端回退。

**验证**:拖拽左右看方向动画;让 agent 跑一个 review 子代理(如「用 review 子代理检查 X」)看 review 状态;`cargo check` + `npm run typecheck` 必过。

### M4 扩展项:工具差异化反应 / 台词气泡 / 点击交互

**按工具类型差异化反应——`pet:tool` 事件 + 前端本地 oneshot,不进主状态机**:

- 事件源复用 `tool.call.started`,载荷已核实(schema):`name` + `display.kind` ∈ `command` / `file_io`(operation: read|write|edit|glob|grep)/ `diff` / `search` / `url_fetch` / `agent_call` / `skill_call`;
- 高频事件**不进 Rust 主状态机**(oneshot 单槽会被工具脉冲打爆,且与 jumping/failed 语义冲突);Rust 侧新增独立事件 `pet:tool {kind}`,同类 kind 1s 节流合并后 emit;
- 前端收到 `pet:tool` 作为本地 oneshot overlay:查 `meta.states["tool:<kind>"]`(schema 的 states 本就是开放 map,宠物作者可在 kimi-desktop-pet/1 里声明任意 `tool:*` 扩展行),没声明回退 running 行,播一遍(时长 frames/fps)后回基底状态;**内置团子不声明 tool:* 行,差异化先只由气泡文案体现**,动作差异留给外部宠物作者。

**台词气泡——纯前端组件,复用现有事件流**:

- PetWindow 内宠物上方绝对定位一个气泡(窗口 240x250 内顶部余量够用,不改窗口尺寸),短文本显示 2~3s 淡出;
- 文案映射(前端常量):`pet:tool` kind → 「读文件…」「改代码…」「跑命令…」「搜一下…」「抓网页…」「叫外援…」;状态跃迁 → jumping「搞定!」、failed「出错了…」、waiting「等你审批」;
- 气泡与动画解耦:动画怎么切不受影响,气泡只是文本层。

**点击交互——waving 行启用,与拖拽共存**:

- 判别顺序:mousedown 只记录起点,**移动超 5px 才 startDragging**(实测:mousedown 立即拖会让 OS 接管手势,webview 收不到 mouseup,点击永远判不出);原位快速松开(< 300ms)判定为点击;
- 点击反应:waving 行(petdex 行 3,M3 已用微笑行填充)播一遍 + 气泡随机一句回应(M5 P1 起单击语义改为开/关悬浮菜单,waving 反馈保留;双击唤回主窗);
- 点击 oneshot 播完自动回基底(本地定时器,不等 Rust 事件);拖过则不触发。

**前端显示优先级最终形态**:`dragState(拖拽方向)> localOneshot(waving / tool:* 脉冲)> rustState(waiting > 一次性动作 > review > running > idle)`。本地两层都在 PetWindow 内闭环,Rust 只新增 `pet:tool` 一个事件,主状态机不动。

## 开放问题

1. ~~WS v1 是否推送 `tool.call.started`~~ 已确认(二进制事件集合 + ws.log 实测 EVT 记录);
2. Kimi 官方形象的 spritesheet 由谁产出(可按 petdex 布局用 hatch-pet 类工具生成;在此之前可用占位图先把 M1/M2 跑通);
3. ~~多会话并发时状态聚合策略~~ 已定稿(见「状态机」节末尾)。
