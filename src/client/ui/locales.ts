/**
 * dsh-canvas — product copy for the browser half (zh / en).
 *
 * Register the namespace in `client/index.tsx` through
 * `ctx.locale.register(NS, { zh, en })`. Both dictionaries carry the identical
 * key set — `en` is typed against `keyof typeof zh`, so a key added to one and
 * forgotten in the other is a compile error rather than an English sentence
 * appearing inside the Chinese UI.
 *
 * The two dictionaries are also the declaration source for the namespace: the
 * merge at the bottom is what makes `t` on a canvas slot component typed to
 * exactly these keys. The framework interpolates `{name}` parameters, so no
 * local formatter is needed.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'dsh-canvas'

export const zh = {
  // Label / guides
  'canvas.label': '画布',
  'canvas.workbench': '画布工作台',
  'canvas.guide.title': '画布',
  'canvas.guide.description': '把文件夹变成一张可对话的产物画布',
  'canvas.guide.preview': '画布卡片',
  'canvas.guide.preview.description': '以画布卡片的形态查看这份产物',

  // Board chrome
  'canvas.stats': '{cards} 张卡片 · {sources} 条引用',
  'canvas.loading': '正在读取画布…',
  'canvas.empty.projects': '还没有画布项目。',
  'canvas.empty.board': '这个文件夹里还没有产物。',
  'canvas.zoom.in': '放大',
  'canvas.zoom.out': '缩小',

  // Board dock
  'canvas.dock.add': '新增卡片',
  'canvas.dock.keys': '快捷键',
  'canvas.dock.text': '文本',
  'canvas.dock.app': '应用',
  'canvas.dock.design': '设计',
  'canvas.dock.image': '图片',
  'canvas.dock.video': '视频',
  'canvas.dock.audio': '音频',

  // 引用线拖到空白处放手时弹出的「新增节点」（F4.8）
  'canvas.drop.title': '新增节点',
  'canvas.drop.hint': '点空白处取消',

  // 快捷键说明（表体与键位同在 src/client/shortcuts.ts：印出来的就是按得动的）
  // 一张键一枚行：并排两枚键的行读起来要在脑子里拆开，所以方向与缩放都各占一行。
  'canvas.keys.title': '键盘快捷键',
  'canvas.keys.space': '按住并拖动，平移画布',
  'canvas.keys.up': '画布上移',
  'canvas.keys.left': '画布左移',
  'canvas.keys.down': '画布下移',
  'canvas.keys.right': '画布右移',
  'canvas.keys.zoomOut': '缩小画布',
  'canvas.keys.zoomIn': '放大画布',
  'canvas.keys.wheel': '平移视图；按住 Ctrl / ⌘ 即缩放',
  'canvas.keys.card': '移动卡片',
  'canvas.keys.preview': '全屏预览产物',
  'canvas.key.wheel': '滚轮',
  'canvas.key.dragCard': '拖动卡片',
  'canvas.key.dblclick': '双击卡片',

  // Actions
  'canvas.action.newProject': '新增画布项目',
  'canvas.action.pickProject': '选择文件夹',
  'canvas.action.chat': '对话',
  'canvas.action.manual': '手动输入',
  'canvas.action.link': '建立引用',
  'canvas.action.export': '导出',
  'canvas.action.publish': '发布',
  'canvas.action.import': '导入',
  'canvas.action.arrange': '按引用链摆位',
  'canvas.action.tidy': '归纳整理',
  'canvas.action.grid': '网格整理',
  'canvas.action.reconcile': '引用对账',
  'canvas.action.refresh': '刷新',
  'canvas.action.collapse': '收起',
  'canvas.action.dismiss': '关闭',
  'canvas.action.locate': '在画布中定位',
  'canvas.action.joinBoard': '加入画布',
  'canvas.action.remove': '从画布移除',
  'canvas.action.cancel': '取消',
  'canvas.action.confirm': '确认',
  'canvas.action.delete': '删除',
  'canvas.action.retry': '重试',
  'canvas.board.arrange': '自动排版',
  // 清理失效卡片（F1.11）：只在板上真有这种卡时才出现的按钮
  'canvas.board.prune': '清理失效卡片 ({count})',
  'canvas.board.prune.hint':
    '这些卡片的产物确实丢了（改过名或被删）。还没有写过产物的空卡、以及一时读不到的卡都不算在内；移除只是把它们从画布上拿开',
  'canvas.prune.title': '移除 {count} 张失效卡片？',
  'canvas.prune.done': '已移除 {count} 张失效卡片',
  'canvas.prune.partial': '已移除 {removed} 张；还有 {skipped} 张一时读不到，留在板上没有动',

  // Card overlay / panel
  'canvas.panel.latest': '最新一条',
  'canvas.composer.material': '引入其它节点产物',
  'canvas.composer.reference': '引用上游产物文件',
  'canvas.composer.referenceMeta': '文件引用',
  'canvas.composer.noReference': '没有可引用的文件',
  'canvas.composer.drop': '删除这条引用关系',
  // 引用标签的类型名（候选行右侧那枚小注）。标签的长相按它选：代码是纸页、图片是缩略图、
  // 视频是胶片、音频是波形，标记 / 区域是图上的一个点 / 一个框。
  'canvas.ref.type.code': '文件',
  'canvas.ref.type.image': '图片',
  'canvas.ref.type.video': '视频',
  'canvas.ref.type.audio': '音频',
  'canvas.ref.type.mark': '标记',
  'canvas.ref.type.region': '区域',
  'canvas.ref.type.element': '元素',
  'canvas.composer.placeholder': '输入提示词，发送给这张卡片…',
  'canvas.composer.send': '发送',
  // 右上角那颗按钮的两副面孔：行内是「放大」（⤢），放大态是「缩小」（⤡）。同一颗、
  // 同一个位置，只是方向反过来。
  'canvas.composer.enlarge': '放大输入框',
  'canvas.composer.shrink': '缩小输入框',
  'canvas.composer.resize': '拖动改这一条控制带的大小',
  'canvas.composer.empty': '画布上还没有其它卡片。',
  'canvas.composer.model': '模型',
  'canvas.composer.modelLoading': '正在加载模型目录…',
  'canvas.composer.modelEmpty': '该提供方暂无可用模型。',
  'canvas.composer.modelMediaSeat':
    '这里是对话模型的位置，而当前选的是视频 / 图片生成模型——下一次请求会失败，请换一个。出图 / 出视频用哪个模型，与这里无关。',
  'canvas.composer.modelAuto': '自动',
  'canvas.composer.modelMedia': '这张卡的生成模型',
  'canvas.composer.modelMediaNote':
    '这里选的是**这张卡的生成模型**——出图 / 出视频用它。不选就是「自动」：按模型名去 DSH 模型配置里找这一类的第一个。它不影响这张卡的对话。',
  'canvas.composer.modelNoFamily': '该提供方没有这一类的模型。',
  'canvas.panel.title': '卡片',
  'canvas.card.rename': '改卡片名（产物会跟着改名）',
  'canvas.panel.path': '产物',
  'canvas.panel.kind': '形态',
  'canvas.panel.size': '大小',
  'canvas.panel.updated': '更新于',
  'canvas.panel.sources': '引用来源',
  'canvas.panel.noSources': '还没有引用来源。',
  'canvas.panel.downstream': '被谁引用',
  'canvas.panel.intents': '待处理意图',
  'canvas.panel.noIntents': '没有排队中的意图。',
  'canvas.panel.session': '会话',

  // Fullscreen artifact viewer (F3.8)
  'canvas.viewer.loading': '正在读取产物…',
  'canvas.viewer.absent': '产物文件还没生成。',
  'canvas.viewer.tooLarge': '文件过大，无法在此预览。',
  'canvas.viewer.truncated': '内容过大，这里只显示了前一部分。',
  // 文本节点的编辑面（同一弹窗的第二种尺寸，不是第二个弹窗）
  'canvas.viewer.edit': '编辑',
  'canvas.viewer.preview': '预览',
  'canvas.viewer.mode': '预览或编辑',
  'canvas.viewer.save': '保存',
  'canvas.viewer.saved': '已保存',
  'canvas.viewer.dirty': '未保存',
  // 停手即自动落盘（节流），这三种状态把这件事讲明白
  'canvas.viewer.saving': '保存中…',
  'canvas.viewer.autosave': '自动保存',
  'canvas.viewer.draftPreview': '以下渲染的是编辑器里的草稿，尚未落盘。',
  // 预览里的站内链接（宿主注入的闸门拦下并报上来的那一类）。话要说全：这不是
  // 「坏了」，是内联快照里这条地址**无从解析**——然后给出真能走的下一步。
  'canvas.viewer.linkBlocked': '「{href}」指向画布内的文件，预览不跟随：预览是一份内联快照，没有服务器，相对地址没有可解析的基准（跟下去只会把预览顶掉，落到宿主页面的 401 上）。要看它，把该文件建成卡片，或用左栏「打开画布目录」交给文件管理器。',
  'canvas.viewer.linkBlocked.dismiss': '知道了',
  'canvas.viewer.writeBlocked': '写入被拒：这个位置不允许改写文件（权限或沙箱限制），自动保存已暂停——改动仍在编辑器里，没有丢。修好后点「重试」。',
  'canvas.viewer.autosaveOff': '自动保存已暂停',
  'canvas.viewer.retry': '重试',
  'canvas.viewer.discard.title': '有未保存的修改，仍要关闭吗？',
  'canvas.viewer.discard.confirm': '放弃修改',
  'canvas.viewer.discard.cancel': '继续编辑',
  // 文本节点的导出（客户端本地生成，不走宿主那条部署能力接缝）。四种格式各有去处，
  // 没有哪一个能当默认，所以「导出」点开是一张四行的菜单；PDF 那一行是**直接排字节**
  // 落盘（pdf-lib + 内嵌 Noto Sans SC 子集），不再借打印对话框。
  'canvas.export.menu': '导出文本',
  'canvas.export.md': 'Markdown（.md）',
  'canvas.export.txt': '纯文本（.txt）',
  'canvas.export.docx': 'Word 文档（.docx）',
  'canvas.export.pdf': 'PDF 文档（.pdf）',
  'canvas.export.absent': '产物文件还没生成，没有可导出的内容。',
  'canvas.export.truncated': '产物过大，这次只读到了前一部分；照这样导出会静默丢掉后面，所以先不导。',
  // 媒体卡（图片 / 视频 / 音频）的导出（v1.83）。它是**原样下载**，所以这里没有「转成
  // 另一种格式失败」这一类；没成只有两种说法：太大（去画布目录取）、内容读不出来。
  'canvas.export.mediaTruncated':
    '这个产物太大，超过一次能取回的上限；照这样下载只能得到半份或空文件，所以先不导。它就在画布目录里，可以直接取。',
  'canvas.export.mediaFailed': '导出失败：{reason}',
  'canvas.export.done': '已导出 {name}',
  // 导入本地文件当产物（F2.7，v1.81）。三句拒绝各说各的下一步：换一个文件 / 先压小 /
  // 挑错文件了——合成一句「导入失败」就等于让用户自己猜。
  'canvas.import.done': '已导入 {name}',
  'canvas.import.replaced': '已用 {name} 替换了这张卡的产物',
  'canvas.import.unsupported': '只能导入图片、视频或音频；这个文件不是这三种中的任何一种。',
  'canvas.import.tooLarge': '这个文件超过 {limit}MB，先压小再导入。',
  'canvas.import.empty': '这个文件是空的（0 字节），导进去卡片上也没有东西可显示。',
  'canvas.export.pdfFailed': 'PDF 生成失败：{reason}',
  // 应用节点的导出（F10.1）：没有格式可选，也没必要有——产物的「另一种形式」就是它自己
  // 装进一个压缩包。所以「导出」在这里是一击，不是菜单；四种 md/docx 那种分叉不适用。
  'canvas.export.bundleDone': '已导出 {name}（{count} 个文件）',
  'canvas.export.bundleEmpty': '这个应用目录里没有可打包的文件。',
  'canvas.export.bundleTruncated': '应用目录太大，超出一次导出能可靠搬运的范围；照这样导出会缺文件，所以先不导。',
  'canvas.export.bundleFailed': '打包失败：{reason}',
  // 设计节点的导出（F10.1，v1.59）：四样出路各要一样东西（Figma 的 kiwi schema / 一台
  // 渲染器 / DOM / 排版引擎），而它们全在浏览器里，所以「导出」同样是一张菜单。图片与 PPT
  // 要 CanvasKit 才画得出来——取不到时如实说不导，不交一份没有样式的图出去。
  'canvas.export.menuDesign': '导出设计',
  'canvas.export.fig': 'Figma 文件（.fig）',
  'canvas.export.png': '图片（.png）',
  'canvas.export.pptx': 'PPT（.pptx）',
  'canvas.export.designBroken': '这份设计文档读不了（旧版信封或者内容被改坏了），让模型重新生成一份。',
  'canvas.export.designEmpty': '这份设计里还没有容器，没有可以画的东西。',
  'canvas.export.designNoEngine': '取不到设计渲染引擎，图片与 PPT 这次导不了；刚更新过插件的话刷新一下页面。',
  'canvas.export.designFailed': '导出失败：{reason}',
  'canvas.export.designPacked': '已导出 {name}（{count} 份）',
  'canvas.export.working': '正在导出…',
  // 引擎侧「画不出来」的四种码（`design-failure.ts`）：引擎只交码与名字（它不知道界面语言），
  // 文案在这儿出——与 import-plan 的「宿主报枚举、客户端出文案」同一条分工。
  'canvas.export.designUnrenderable': '「{unit}」画不出来，这一趟先不导出了。',
  'canvas.export.designNoFont': '取不到中文字面（插件资产没装上），这一趟先不导出了。',
  'canvas.export.designNoPages': '这一趟没有要导出的页面。',
  'canvas.export.designSvgUnreadable': '这一页的矢量图读不了。',
  // 设计文档解码的六种码（`core/artifact/design/document.ts` 的 DesignDocumentError）：
  // 预览器按码出这一句；core 里那条中文消息留给诊断与模型。
  'canvas.design.notDesign': '不是一份设计文档（缺少文件头）。',
  'canvas.design.legacy': '旧版设计文件（v1），请让模型重新生成这份设计。',
  'canvas.design.future': '设计文档版本过新（{detail}）。',
  'canvas.design.badJson': '设计文档内容损坏（JSON 解不开）。',
  'canvas.design.badSnapshot': '设计文档内容损坏（快照结构不对）。',
  'canvas.design.badNode': '设计文档内容损坏（节点缺 id）。',
  'canvas.design.engineInitFailed': '设计预览引擎初始化失败。',
  'canvas.design.engineLoadFailed': '设计预览引擎加载失败，请刷新页面重试。',
  'canvas.design.sendFailed': '发送失败，请重试。',
  'canvas.design.truncated': '设计文档为空或被截断，无法渲染。',
  'canvas.design.empty': '这份设计还没有内容。',
  // 元素选择（F3.14）：在跑起来的页面上点一个元素，把它的源码嵌进提示词交给这张卡
  // 的会话去改。三句话各管一件事——工具叫什么、这一击不会落到页面上、发出去之后呢。
  'canvas.pick.tool': '元素选择',
  'canvas.pick.armed': '元素选择：页面暂时变成只读的——鼠标移到哪儿就圈住哪个元素，单击即选中。页面自己的悬停、按钮、输入都收不到这一下；按 Esc 退出。',
  'canvas.pick.title': '修改这个元素',
  'canvas.pick.hint': '接着在框里写下要改什么，⌘/Ctrl+Enter 发送',
  'canvas.pick.send': '发送修改',
  'canvas.pick.sending': '发送中…',
  'canvas.pick.sent': '已把这条要求发给这张卡的会话。产物改好后这里会自动刷新——在那之前，预览还是旧的那一份。',
  'canvas.pick.waiting': '等产物…',
  'canvas.pick.waitingHint': '改动正在跑：这一圈上的光扫到停下就是改完了，框会自己收起。',
  'canvas.pick.repick': '先关掉提示词框，再重新选元素',
  'canvas.pick.updated': '产物已更新。',
  'canvas.pick.failed': '发送失败：{message}',
  // 元素标签：那一枚「◫ 节点名」把附进去的定位与源码收成了一个字——悬停时在这里交代
  // 它折的是什么（只是草稿的另一种画法，发出去的提示词一个字不变）。
  'canvas.pick.blockDetail': '元素 {label} · 产物 {file}（已附上节点定位与源码）',

  // Right-pane artifact tab / fullscreen viewer
  'canvas.view.outside': '这份产物不在任何画布项目中。',

  // Sidebar canvas area
  // 画布区在左栏是一个包裹：header（标题 + 新建）+ 画布列表。标题就是画布区的名字，
  // 新建按钮的文案是动作名（见 canvas.action.*）。收起时包裹整棵不显示，只剩宿主
  // 那一行的图标，点它就等于新建。
  'canvas.manage.new': '画布',
  'canvas.manage.add': '新建画布',
  'canvas.manage.picking': '请在系统选择器中选定一个文件夹…',

  // 画布行的操作菜单（F1.5 修订）：行右侧一枚省略号，点开是「关于这张画布本身」的两个
  // 动作。无障碍名带上画布名——左栏有好几行，只说「画布操作」读不出说的是哪一张。
  // 「删除」说的是画布本身，文案必须把「磁盘上什么都没少」写在前头。
  'canvas.menu.aria': '「{name}」的操作',
  'canvas.menu.open': '打开画布目录',
  'canvas.menu.openFailed': '打不开这个目录：{message}',
  'canvas.menu.remove': '删除画布',
  'canvas.menu.remove.title': '删除这张画布？',
  'canvas.menu.remove.pending': '正在删除画布…',
  'canvas.menu.remove.desc': '只把「{name}」从画布列表里移开：磁盘上的文件夹与文件原样保留，内容不会丢——这个目录里的板面文件也留着，把文件夹重新加成画布，排版与引用关系就从它回来。',

  // Folder picker
  'canvas.picker.title': '选择一个文件夹作为画布项目',
  'canvas.picker.parent': '上一级',
  'canvas.picker.here': '就选这个文件夹',
  'canvas.picker.empty': '这里没有子文件夹。',
  'canvas.picker.name': '项目名称',

  // Notes
  'canvas.note.placeholder': '写下一条共享便签…',
  'canvas.note.add': '加一条便签',

  // Tool live view
  'canvas.tool.title': '画布：{name}',
  'canvas.tool.pending': '等待结果…',
  'canvas.tool.failed': '调用失败：{message}',

  // 文件引入（F5.3）：把上游产物按 @路径 交给卡片会话，读取由模型决定
  'canvas.reference.files': '已把 {count} 个上游产物作为文件引用交给这张卡的会话（要不要读、读哪一段由它决定）',
  'canvas.reference.filesEmpty': '这张卡片还没有引用来源，没有可引用的文件。',
  'canvas.reference.filesNone': '上游产物的路径都写不成 @引用，已在消息里说明。',
  'canvas.reference.skipped': '另有 {count} 个上游的路径无法写成 @引用，已在消息里说明。',

  // Errors and time
  'canvas.error': '操作失败：{message}',
  'canvas.error.unknown': '未知错误',
  'canvas.time.now': '刚刚',
  'canvas.time.minutes': '{n} 分钟前',
  'canvas.time.hours': '{n} 小时前',
  'canvas.time.days': '{n} 天前',
  'canvas.time.months': '{n} 个月前',
  'canvas.time.years': '{n} 年前',
} satisfies Record<string, string>

/** Every dictionary key of the canvas namespace. */
export type CanvasKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-canvas': CanvasKey
  }
}

export const en = {
  // Label / guides
  'canvas.label': 'Canvas',
  'canvas.workbench': 'Canvas workbench',
  'canvas.guide.title': 'Canvas',
  'canvas.guide.description': 'Turn a folder into a canvas of talkative artifacts',
  'canvas.guide.preview': 'Canvas card',
  'canvas.guide.preview.description': 'View this artifact as a canvas card',

  // Board chrome
  'canvas.stats': '{cards} CARDS · {sources} SOURCES',
  'canvas.loading': 'Reading the board…',
  'canvas.empty.projects': 'No canvas projects yet.',
  'canvas.empty.board': 'No artifacts in this folder yet.',
  'canvas.zoom.in': 'Zoom in',
  'canvas.zoom.out': 'Zoom out',

  // Board dock
  'canvas.dock.add': 'New card',
  'canvas.dock.keys': 'Shortcuts',
  'canvas.dock.text': 'Text',
  'canvas.dock.app': 'Web app',
  'canvas.dock.design': 'Design',
  'canvas.dock.image': 'Image',
  'canvas.dock.video': 'Video',
  'canvas.dock.audio': 'Audio',

  // The "new node" popup a source-edge drag opens when it is let go on empty space (F4.8)
  'canvas.drop.title': 'New node',
  'canvas.drop.hint': 'Click empty space to cancel',

  // Shortcut sheet (the rows and the keys live together in src/client/shortcuts.ts)
  // One key per row: a row that prints two keys has to be split apart in the head.
  'canvas.keys.title': 'Keyboard shortcuts',
  'canvas.keys.space': 'Hold and drag to pan',
  'canvas.keys.up': 'Move the board up',
  'canvas.keys.left': 'Move the board left',
  'canvas.keys.down': 'Move the board down',
  'canvas.keys.right': 'Move the board right',
  'canvas.keys.zoomOut': 'Zoom out',
  'canvas.keys.zoomIn': 'Zoom in',
  'canvas.keys.wheel': 'Pan the view; hold Ctrl / ⌘ to zoom',
  'canvas.keys.card': 'Move the card',
  'canvas.keys.preview': 'Open the artifact fullscreen',
  'canvas.key.wheel': 'Wheel',
  'canvas.key.dragCard': 'Drag card',
  'canvas.key.dblclick': 'Double-click',

  // Actions
  'canvas.action.newProject': 'New canvas project',
  'canvas.action.pickProject': 'Choose a folder',
  'canvas.action.chat': 'Chat',
  'canvas.action.manual': 'Type it myself',
  'canvas.action.link': 'Link source',
  'canvas.action.export': 'Export',
  'canvas.action.publish': 'Publish',
  'canvas.action.import': 'Import',
  'canvas.action.arrange': 'Arrange by source chain',
  'canvas.action.tidy': 'Tidy up',
  'canvas.action.grid': 'Grid',
  'canvas.action.reconcile': 'Reconcile references',
  'canvas.action.refresh': 'Refresh',
  'canvas.action.collapse': 'Collapse',
  'canvas.action.dismiss': 'Dismiss',
  'canvas.action.locate': 'Locate on board',
  'canvas.action.joinBoard': 'Add to canvas',
  'canvas.action.remove': 'Remove from board',
  'canvas.action.cancel': 'Cancel',
  'canvas.action.confirm': 'Confirm',
  'canvas.action.delete': 'Delete',
  'canvas.action.retry': 'Retry',
  'canvas.board.arrange': 'Auto-arrange',
  'canvas.board.prune': 'Clear {count} missing',
  'canvas.board.prune.hint':
    'These artifacts are really gone (renamed or deleted). Seats that never had an artifact, and files no probe could read, are not counted; removing these only takes them off the board',
  'canvas.prune.title': 'Remove {count} missing cards?',
  'canvas.prune.done': 'Removed {count} missing cards',
  'canvas.prune.partial': 'Removed {removed}; {skipped} could not be read just now and were left in place',

  // Card overlay / panel
  'canvas.panel.latest': 'Latest',
  'canvas.composer.material': 'Bring in another node’s artifact',
  'canvas.composer.reference': 'Reference upstream files',
  'canvas.composer.referenceMeta': 'file reference',
  'canvas.composer.noReference': 'Nothing to reference',
  'canvas.composer.drop': 'Remove this material link',
  'canvas.ref.type.code': 'File',
  'canvas.ref.type.image': 'Image',
  'canvas.ref.type.video': 'Video',
  'canvas.ref.type.audio': 'Audio',
  'canvas.ref.type.mark': 'Mark',
  'canvas.ref.type.region': 'Region',
  'canvas.ref.type.element': 'Element',
  'canvas.composer.placeholder': 'Type a prompt to send to this card…',
  'canvas.composer.send': 'Send',
  // Two faces of the same corner button: 〔enlarge〕(⤢) on the strip, 〔shrink〕(⤡)
  // once the box is at full size — same button, same spot, opposite direction.
  'canvas.composer.enlarge': 'Enlarge the prompt box',
  'canvas.composer.shrink': 'Shrink the prompt box',
  'canvas.composer.resize': 'Drag to resize this control strip',
  'canvas.composer.empty': 'No other cards on the board yet.',
  'canvas.composer.model': 'Model',
  'canvas.composer.modelLoading': 'Loading the model catalog…',
  'canvas.composer.modelEmpty': 'No models available from this provider.',
  'canvas.composer.modelMediaSeat':
    'This seat is for chat models, but a video / image generation model is selected — the next request will fail. Pick another one; which model draws the image or video is unrelated to this choice.',
  'canvas.composer.modelAuto': 'Auto',
  'canvas.composer.modelMedia': 'Generation model for this card',
  'canvas.composer.modelMediaNote':
    'This picks the **generation model for this card** — the one that draws the image or renders the video. "Auto" means the first model of that family in your DSH model config. It does not affect this card’s conversation.',
  'canvas.composer.modelNoFamily': 'No model of this type from this provider.',
  'canvas.panel.title': 'Card',
  'canvas.card.rename': 'Rename the card (its artifact is renamed with it)',
  'canvas.panel.path': 'Artifact',
  'canvas.panel.kind': 'Kind',
  'canvas.panel.size': 'Size',
  'canvas.panel.updated': 'Updated',
  'canvas.panel.sources': 'Material',
  'canvas.panel.noSources': 'No material yet.',
  'canvas.panel.downstream': 'Feeds into',
  'canvas.panel.intents': 'Queued intents',
  'canvas.panel.noIntents': 'Nothing queued.',
  'canvas.panel.session': 'Session',

  // Fullscreen artifact viewer (F3.8)
  'canvas.viewer.loading': 'Reading the artifact…',
  'canvas.viewer.absent': 'The artifact has not been written yet.',
  'canvas.viewer.tooLarge': 'The file is too large to preview here.',
  'canvas.viewer.truncated': 'The content is large; only its first part is shown.',
  // The text node's editor face — one dialog at two sizes, not two dialogs
  'canvas.viewer.edit': 'Edit',
  'canvas.viewer.preview': 'Preview',
  'canvas.viewer.mode': 'Preview or edit',
  'canvas.viewer.save': 'Save',
  'canvas.viewer.saved': 'Saved',
  'canvas.viewer.dirty': 'Unsaved',
  // Typing settles and the text is written — these three name that behaviour
  'canvas.viewer.saving': 'Saving…',
  'canvas.viewer.autosave': 'Autosave',
  'canvas.viewer.draftPreview': 'This renders the editor buffer, which is not on disk yet.',
  // A link into the canvas, stopped by the guard the host installs. Say the whole
  // thing: this is not a breakage, the address has nothing to resolve against —
  // and then name the two routes that do work.
  'canvas.viewer.linkBlocked': '"{href}" points at a file inside the canvas, and the preview does not follow it: a preview is an inlined snapshot with no server, so a relative address has no base to resolve against (following it would only replace the preview with the host page\'s 401). To open it, make that file a card, or use "Open canvas folder" in the left rail.',
  'canvas.viewer.linkBlocked.dismiss': 'Got it',
  'canvas.viewer.writeBlocked':
    'The write was refused: this location does not allow the file to be replaced (permissions or a sandbox), so autosave has stopped. Your text is still in the editor — nothing is lost. Press Retry once it is fixed.',
  'canvas.viewer.autosaveOff': 'Autosave stopped',
  'canvas.viewer.retry': 'Retry',
  'canvas.viewer.discard.title': 'You have unsaved changes. Close anyway?',
  'canvas.viewer.discard.confirm': 'Discard',
  'canvas.viewer.discard.cancel': 'Keep editing',
  // Text-node export (produced in the browser; the deployment's export capability is
  // not involved). Four formats, four destinations and no sensible default, so the
  // button opens a four-row menu; the PDF row writes real PDF bytes right here
  // (pdf-lib plus an embedded Noto Sans SC subset) instead of going through a print
  // dialog.
  'canvas.export.menu': 'Export text',
  'canvas.export.md': 'Markdown (.md)',
  'canvas.export.txt': 'Plain text (.txt)',
  'canvas.export.docx': 'Word document (.docx)',
  'canvas.export.pdf': 'PDF document (.pdf)',
  'canvas.export.absent': 'Nothing to export yet — the artifact has not been written.',
  'canvas.export.truncated':
    'The artifact is too large to read whole and only its first part came over; exporting that would silently drop the rest, so nothing was exported.',
  // Media export (v1.83) hands the artifact over as-is, so there is no
  // "could not convert to another format" case here — only too large, and
  // unreadable.
  'canvas.export.mediaTruncated':
    'This artifact is too large to fetch in one piece here; downloading it as-is would give you a partial or empty file, so nothing was exported. It is in the canvas folder — you can copy it from there.',
  'canvas.export.mediaFailed': 'Could not export: {reason}',
  'canvas.export.done': 'Exported {name}',
  // Importing a local file as the artifact (F2.7, v1.81). Each refusal names its own
  // next step — pick another file / shrink it / you grabbed the wrong one — because
  // one blanket "import failed" would leave the user guessing.
  'canvas.import.done': 'Imported {name}',
  'canvas.import.replaced': 'Replaced this card’s artifact with {name}',
  'canvas.import.unsupported': 'Only images, videos and audio can be imported — this file is none of those.',
  'canvas.import.tooLarge': 'This file is over {limit}MB; shrink it before importing.',
  'canvas.import.empty': 'This file is empty (0 bytes), so the card would have nothing to show.',
  'canvas.export.pdfFailed': 'Could not build the PDF: {reason}',
  // The application node's export (F10.1) has no format to choose and needs none:
  // the only other form its artifact takes is itself, packed into an archive. So
  // the button is a single click here rather than a menu.
  'canvas.export.bundleDone': 'Exported {name} ({count} files)',
  'canvas.export.bundleEmpty': 'This application folder has no files to pack.',
  'canvas.export.bundleTruncated':
    'The application folder is too large to carry out in one export; packing it now would leave files behind, so nothing was exported.',
  'canvas.export.bundleFailed': 'Could not pack it: {reason}',
  // The design node's export (F10.1, v1.59): each of the four ways out needs
  // something (Figma's kiwi schema / a renderer / the DOM / a layout engine) and
  // all of it lives in the browser, so this is a menu too. Images and PPT need
  // CanvasKit — when it is missing we say so instead of handing over a blank.
  'canvas.export.menuDesign': 'Export design',
  'canvas.export.fig': 'Figma file (.fig)',
  'canvas.export.png': 'Image (.png)',
  'canvas.export.pptx': 'PPT (.pptx)',
  'canvas.export.designBroken':
    'This design document cannot be read (an older envelope, or its contents were damaged) — ask the model to generate it again.',
  'canvas.export.designEmpty': 'This design has no containers yet, so there is nothing to draw.',
  'canvas.export.designNoEngine':
    'The design renderer is not available, so images and PPT cannot be exported right now; reload the page if the plugin was just updated.',
  'canvas.export.designFailed': 'Could not export it: {reason}',
  'canvas.export.designPacked': 'Exported {name} ({count} items)',
  'canvas.export.working': 'Exporting…',
  // The four coded "cannot draw it" failures from the engine (design-failure.ts):
  // the engine only reports a code and a name — it does not know the UI language —
  // and the wording lives here (same split as import-plan's enum-vs-locale).
  'canvas.export.designUnrenderable': '"{unit}" could not be drawn, so this export was stopped.',
  'canvas.export.designNoFont': 'The CJK font is unavailable (plugin assets are missing), so this export was stopped.',
  'canvas.export.designNoPages': 'There are no pages to export.',
  'canvas.export.designSvgUnreadable': 'The vector graphic of this page could not be read.',
  // The six decode codes (DesignDocumentError in core document.ts): the viewer maps
  // the code to these lines; the message kept in core is for diagnostics and the model.
  'canvas.design.notDesign': 'Not a design document (the file header is missing).',
  'canvas.design.legacy': 'A legacy (v1) design file — ask the model to regenerate this design.',
  'canvas.design.future': 'The design document is from a newer version ({detail}).',
  'canvas.design.badJson': 'The design document is damaged (JSON could not be parsed).',
  'canvas.design.badSnapshot': 'The design document is damaged (the snapshot structure is wrong).',
  'canvas.design.badNode': 'The design document is damaged (a node is missing its id).',
  'canvas.design.engineInitFailed': 'The design preview engine failed to initialize.',
  'canvas.design.engineLoadFailed': 'The design preview engine failed to load; reload the page and try again.',
  'canvas.design.sendFailed': 'Sending failed; please try again.',
  'canvas.design.truncated': 'The design document is empty or truncated, so it cannot be rendered.',
  'canvas.design.empty': 'This design has no content yet.',
  // The element picker (F3.14): click an element on the running page and its own
  // source goes into a prompt handed to this card's conversation.
  'canvas.pick.tool': 'Select element',
  'canvas.pick.armed': 'Selecting an element: the page goes read-only — the element under the pointer is outlined, and a click picks it. The page\'s own hover, buttons and inputs never see that click; press Esc to leave.',
  'canvas.pick.title': 'Edit this element',
  'canvas.pick.hint': 'Write what to change in the box, then ⌘/Ctrl+Enter',
  'canvas.pick.send': 'Send',
  'canvas.pick.sending': 'Sending…',
  'canvas.pick.sent': 'Handed this request to the card\'s conversation. The preview reloads itself once the artifact is rewritten — until then it is still the old one.',
  'canvas.pick.waiting': 'Waiting…',
  'canvas.pick.waitingHint': 'The change is running: the light sweeping that outline stops when it lands, and the box closes itself.',
  'canvas.pick.repick': 'Close the prompt box before picking another element',
  'canvas.pick.updated': 'The artifact is updated.',
  'canvas.pick.failed': 'Could not send: {message}',
  // The locator block: the node locator & source, packed for display only — the
  // prompt that goes out is byte-for-byte what it always was.
  // The element tag: that one 「◫ node」 holds the whole attached locator and source — this
  // is what hovering it spells out (a display change only, the prompt is untouched).
  'canvas.pick.blockDetail': 'Element {label} · {file} (locator & source attached)',

  // Right-pane artifact tab / fullscreen viewer
  'canvas.view.outside': 'This file is not inside a canvas project.',

  // Sidebar canvas area
  'canvas.manage.new': 'Canvas',
  'canvas.manage.add': 'New canvas',
  'canvas.manage.picking': 'Pick a folder in the system dialog…',

  // A canvas row's action menu (F1.5 revision): the ellipsis on the right of the row. The
  // accessible name carries the canvas name — the column has several rows, and
  // a bare "Canvas actions" cannot say which one.
  'canvas.menu.aria': 'Actions for “{name}”',
  'canvas.menu.open': 'Open canvas folder',
  'canvas.menu.openFailed': 'Could not open this folder: {message}',
  'canvas.menu.remove': 'Delete canvas',
  'canvas.menu.remove.title': 'Delete this canvas?',
  'canvas.menu.remove.pending': 'Deleting canvas…',
  'canvas.menu.remove.desc': 'This only takes “{name}” off the canvas list: the folder and its files stay exactly where they are, nothing on disk is lost — the board file inside that folder stays too, so adding the folder as a canvas again brings the layout and source edges back.',

  // Folder picker
  'canvas.picker.title': 'Choose a folder as a canvas project',
  'canvas.picker.parent': 'Parent',
  'canvas.picker.here': 'Use this folder',
  'canvas.picker.empty': 'No subfolders here.',
  'canvas.picker.name': 'Project name',

  // Notes
  'canvas.note.placeholder': 'Write a shared note…',
  'canvas.note.add': 'Add a note',

  // Tool live view
  'canvas.tool.title': 'Canvas: {name}',
  'canvas.tool.pending': 'Waiting for a result…',
  'canvas.tool.failed': 'The call failed: {message}',

  // Errors and time
  'canvas.error': 'Action failed: {message}',
  'canvas.error.unknown': 'Unknown error',

  // Session references (F5.3–F5.5): the second channel under a source edge
  // File references (F5.3): upstream artifacts handed over as @paths, read on demand
  'canvas.reference.files': 'Handed {count} upstream artifact(s) to this card\'s conversation as file references — reading them is the model\'s call',
  'canvas.reference.filesEmpty': 'This card has no sources yet, so there is no file to reference.',
  'canvas.reference.filesNone': 'None of the upstream paths could be written as an @reference; the message says which.',
  'canvas.reference.skipped': '{count} upstream path(s) could not be written as an @reference; the message says which.',
  'canvas.time.now': 'now',
  'canvas.time.minutes': '{n}min ago',
  'canvas.time.hours': '{n}h ago',
  'canvas.time.days': '{n}d ago',
  'canvas.time.months': '{n}mo ago',
  'canvas.time.years': '{n}y ago',
} satisfies Record<CanvasKey, string>

/** Namespace-bound translate function; params interpolate into `{name}` slots. */
export type Translate = TranslateNS<typeof NS>
