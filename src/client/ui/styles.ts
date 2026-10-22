/**
 * dsh-canvas — the browser half's stylesheet.
 *
 * One injected sheet, one class prefix (`dsh-canvas-`), no element resets, and
 * exactly two global selectors (the sidebar rail rules at the foot, which must
 * reach a host-rendered button): the canvas lives inside a host pane it does
 * not own.
 *
 * Colour ships as **two palettes**. Light is the default (the host's light mode is
 * "no `data-ds-dark-theme` on `body`"); dark arrives by the host putting that
 * attribute there, which is exactly how the host's own token sheets switch. The
 * plugin never decides which one is active — it reads the attribute. Neutrals
 * (text, hairlines) ride the host's real alias tokens, so they follow the host's
 * palette *and* any third-party theme that overrides those aliases; the canvas-only
 * surfaces (board, card, soft/slot, accents, sheen) carry both values here because
 * the host has no token for an endless board. The rest of the system is unchanged:
 * no shadows, hairline layering, capsule buttons, and exactly four accents —
 * sunset (running), dusk, twilight (has news) and breeze (material edges).
 */
const STYLE_ID = 'dsh-canvas-styles'

/**
 * 旋转手柄的光标：**一段扁椭圆的弧，两端各接一枚箭头**——双向箭头弯成弧形，就是「旋转」那个手势。
 *
 * 用弧而不是那枚顺时针单箭头（rotate_right）：光标上只画一个头，方向就被读死成「只能朝这一边
 * 转」，而这里的拖拽两个方向都作数。取椭圆不取正圆、弧也短（150°）：正圆绕满一圈会顶到光标
 * 图片的边，而且一个圆环更像「加载中」；扁弧只占了上下很浅的一条，指向明确。
 *
 * CSS 没有「旋转」这个光标关键字，只能自己带一张图（手型 grab 说的是「可以拖走」，是另一回事）。
 * 图里的颜色写死，光标图用不了 CSS 变量；画布底色恒为浅灰（见下面 .dsh-canvas-design），所以取
 * 近黑。`<` `>` `#` 必须转义，否则 URL 会被截断。兜底 default：图挂了也只是退成普通箭头，拖拽照旧。
 */
const ROTATE_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E' +
  '%3Cg fill=\'none\' stroke=\'%23222\' stroke-width=\'2.2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E' +
  // 弧：椭圆心 (12,12.5)、横半轴 8.6、纵半轴 5.2，从 195° 顺时针 150° 到 345°（两枚箭头就落在两端）。
  '%3Cpath d=\'M3.69 11.15A8.6 5.2 0 0 1 20.31 11.15\'/%3E' +
  // 两枚箭头都沿切线朝外（各自背离弧的中点），合成一枚弯过来的双向箭头。
  '%3Cpath d=\'M3.46 8.09 3.69 11.15 6.12 9.27\'/%3E' +
  '%3Cpath d=\'M20.54 8.09 20.31 11.15 17.88 9.27\'/%3E' +
  '%3C/g%3E%3C/svg%3E") 12 12, default'

/** 导出只为测试解析（tests/theme-tokens.spec.ts 把这张表当数据审）；运行时仍走 adoptStyles 注入。 */
export const css = `
/* 画布自己那套变量。**两套配色**：亮色写在前面（宿主亮色模式就是「body 上没有
   data-ds-dark-theme」），暗色由宿主挂上那个属性时覆盖——宿主自己也是这么做
   （ui-theme 那套设计令牌整套按 body[data-ds-dark-theme] 覆盖同名变量）。而
   「现在是亮还是暗」**不归插件管**：ui-theme 解析 light/dark/system（system 走
   prefers-color-scheme），预置引导先把属性写上、ui-layout 的 ThemePresenter
   之后接着维护，插件只读属性、不问配置，于是主题一切换画布跟着换。

   中性色（文字、发丝边）**直接吃宿主的别名令牌**——那些令牌本身就有两套值，
   于是它们自动跟随，连第三方主题（ctx.theme 覆盖同名别名）也一并跟随。
   画布专属的几个（无限画布底 / 卡底 / 悬停选中底 / 凹槽底 / 品牌色 / 流光）
   宿主没有对应语义，就在下面老实写两套。

   ⚠️ v1.38 之前这里写的是 --dsw-alias-bg-elevated 与 --dsw-alias-border-secondary
   两个**宿主的令牌表里并不存在**的名字：兜底值永远生效，看着像接了宿主令牌、
   其实卡底与发丝边是写死的暗色，亮色下必然花（次文字 --dsh-fg-2 更是白底白字）。
   真名是 --dsw-alias-bg-layer-1 与 --dsw-alias-border-l2；「只准用真名」这条已由
   tests/theme-tokens.spec.ts 的白名单钉住。

   画布之外的一切（左栏那一段列表、它的行操作菜单与删除确认框）都走宿主的
   --dsw-* 令牌：那些构件说的是宿主侧栏的事，也该跟着宿主的主题走。它们 portal 在
   宿主 <nav> 里、拿不到画布根上的变量，所以 --dsh-font/--dsh-mono 这两个与主题
   无关的量提在 :root 上。v1.33 之前这里还带一个 .dsh-canvas-floating，是把这套
   变量带过 portal 给右键菜单用的——那两件现在都换成宿主的原语了。 */
:root{
  --dsh-font:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI","Noto Sans SC",sans-serif;
  --dsh-mono:ui-monospace,"Geist Mono","SF Mono",Menlo,monospace;
}

/* ── 亮色（默认那一套） ─────────────────────────────────────────────────── */
.dsh-canvas-root{
  --dsh-surface:#EBEEF2;
  --dsh-card:#FFFFFF;
  --dsh-soft:#F5F6F7;
  --dsh-slot:#E9ECF2;
  /* 输入框自己的底（.dsh-canvas-composer-input）。亮色下是**白纸一张**：表单控件本该
     比画布亮、把内容托出来，而不是比画布更暗地凹下去——那是暗色下的做法。
     所以它不从 --dsh-slot 里取，单开一条，两套值各说各的。 */
  --dsh-field:#FFFFFF;
  /* 高亮底面（引用标签、@候选里键盘走到的那一行）。亮色下取品牌色的淡调，**不用中性灰**：
     「高亮」得像是有颜色的，灰底只说明「比周围深一点」。edge 是同一色的描边，白底上
     一枚淡蓝的标签得靠它把边收住，否则跟纸糊在一起。 */
  --dsh-hl:color-mix(in srgb, var(--dsh-breeze) 14%, #FFFFFF);
  --dsh-hl-edge:color-mix(in srgb, var(--dsh-breeze) 28%, transparent);
  --dsh-mid:#CFD3D6;
  --dsh-hairline:var(--dsw-alias-border-l2,#0000001A);
  --dsh-fg:var(--dsw-alias-label-primary,#0F1115);
  --dsh-fg-2:var(--dsw-alias-label-secondary,#61666B);
  --dsh-fg-3:var(--dsw-alias-label-tertiary,#81858C);
  --dsh-sunset:#C25A0A;
  --dsh-dusk:#6D28D9;
  --dsh-twilight:#6D28D9;
  --dsh-breeze:#4176E6;
  /* 蓝色那一族实心件（元素选择工具、设计面板的选中行、圈选浮标）上的文字。亮色下
     breeze 是**中蓝**，所以字取白。这条与 breeze 成对，谁也不许再在那几处写死色值。 */
  --dsh-on-accent:#FFFFFF;
  /* 黄色那一族实心件：底色与它上面的字，成对。
     --dsh-sunset 本身是**文字**色（行内的 ✓、错误提示、强调字），深一档才在浅底上读得出；
     实心件要的是**亮得醒目的黄**——两件事，所以两条变量。底一亮，白字在上面就只剩
     1.7:1（亮黄的相对亮度是白字的四五倍），字必须翻成深色，于是这一对的字与
     --dsh-on-accent 正好相反。 */
  --dsh-sunset-solid:#F5B820;
  --dsh-on-sunset:#3D2B00;
  --dsh-sheen:#0000000F;
  --dsh-sheen-peak:#0000001F;
  position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;
  background:var(--dsh-surface);color:var(--dsh-fg);font:13px/20px var(--dsh-font);
  -webkit-font-smoothing:antialiased;
}

/* ── 暗色（宿主在 <body> 上挂 data-ds-dark-theme 时覆盖亮色那套） ─────────
   属性由宿主写：预置引导脚本负责首屏之前那一次，ui-layout 的 ThemePresenter
   负责之后每次快照。**亮色＝属性缺席**，所以这里只覆盖，不另开类名。 */
body[data-ds-dark-theme] .dsh-canvas-root{
  --dsh-surface:#0A0A0A;
  --dsh-card:#191919;
  --dsh-soft:#1A1C20;
  --dsh-slot:#0E0F12;
  /* 暗色下输入框仍是**凹**的（比卡底更深），与亮色那套白纸是同一个意思：把内容托出来。 */
  --dsh-field:#0E0F12;
  /* 高亮底面暗色下照旧，连同描边一起回到中性发丝边——亮色那套淡蓝是为白底配的。 */
  --dsh-hl:#1A1C20;
  --dsh-hl-edge:var(--dsh-hairline);
  --dsh-mid:#363A3F;
  --dsh-sunset:#FF7A17;
  --dsh-dusk:#7C3AED;
  --dsh-twilight:#C4B5FD;
  --dsh-breeze:#A0C3EC;
  /* 暗色下强调色是**亮色**，字要翻成近黑——同一枚令牌，两套值各归各的对比度。 */
  --dsh-on-accent:#0A0A0A;
  /* 暗色下黄色那一族照旧（亮橙底 + 近黑的字）：底下是深画布，它本来就是那块亮色，
     不必跟亮色那套走——亮色变亮黄是为了在浅灰画布上站得住。 */
  --dsh-sunset-solid:#FF7A17;
  --dsh-on-sunset:#0A0A0A;
  --dsh-sheen:#FFFFFF14;
  --dsh-sheen-peak:#FFFFFF29;
}

/* ── surface ────────────────────────────────────────────────────────────── */
/* 画布没有头部：命名、新建与切换画布都归左栏的画布管理区，页面只留画布本体，
   所以这一层就是整块画布，从第一个像素起都能按住空格拖动。

   指针的两套语义在这里分工：**默认是选择箭头**（点卡片即选中，拖卡片即移动），
   平移要按住空格——那时整块表面（含卡片与端口）都换成抓手，拖动的是取景框而不是
   卡片。空格按住这件事由 canvas-view 记成 is-space 这个类。 */
.dsh-canvas-body{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
.dsh-canvas-surface{position:absolute;inset:0;overflow:hidden;cursor:default;
  background-image:radial-gradient(circle,var(--dsh-hairline) 1px,transparent 1px);
  background-size:calc(28px * var(--dsh-z)) calc(28px * var(--dsh-z));
  background-position:calc(var(--dsh-px) + 14px) calc(var(--dsh-py) + 14px)}
/* 空格按住：整块表面连同卡片都变抓手（端口除外——它是引用的手势，别被覆盖）。 */
.dsh-canvas-surface.is-space,.dsh-canvas-surface.is-space .dsh-canvas-card{cursor:grab}
/* 输入框正文那枚 I 型光标在按住空格时也让开：那时整块表面都是抓手，指到提示词框上也是
   「拖的是取景框」（按压在捕获阶段就被画布收走了，所以这一枚光标说的正是接下来会发生
   的事）。 */
.dsh-canvas-surface.is-space .dsh-canvas-promptbox-field{cursor:grab}
.dsh-canvas-surface.is-panning,.dsh-canvas-surface.is-panning .dsh-canvas-card{cursor:grabbing}
.dsh-canvas-surface.is-linking{cursor:crosshair}
.dsh-canvas-surface.is-linking .dsh-canvas-card{cursor:crosshair}
.dsh-canvas-layer{position:absolute;left:0;top:0;transform-origin:0 0}

/* ── card ───────────────────────────────────────────────────────────────── */
/* 节点样式对齐参考稿：标题行在顶（只有名字，没有状态点），预览铺满其余全部，
   引用端口悬在左右两侧的垂直中点。卡上不解释状态——运行由流光说，静止就是
   「没事发生」；边框只归用户自己的两个动作（悬停、选中）。 */
/* 卡片自身的圆角写在 --dsh-card-r 上，因为贴在它内缘的两层（标题行与预览）必须用
   **同心**的圆角，而「同心」这件事只有把半径算出来才是真的：两层都铺满卡片的内容
   盒、都没有边框，所以它们的盒角正好压在边框的内缘上——半径各减掉一个边框宽度
   （8 − 1 = 7），圆心才落在同一点。少了这一步，凡是有底色的那层就会在圆角处**盖掉
   卡片的边框**：后代的背景画在祖先的边框之上（CSS 绘制顺序：祖先的边框先画，流内
   块级后代后画），而卡片按设计不能 overflow:hidden（两个引用端口悬在卡外）。左下、
   右下两角的边框整段消失就是这么来的——标题行没有底色，所以上两角安然无恙。 */
/* 宽高是**兜底值**：真正的尺寸由 core/canvas/card-size.ts 的 cardSizeOf 以内联样式
   给出（v1.79 起所有形态一样大，400×252）。这两个数只在样式表被单独阅读时有意义，
   改尺寸请改那边——排位、锚点、命中矩形、取景都读它。 */
.dsh-canvas-card{--dsh-card-r:8px;--dsh-card-inner-r:calc(var(--dsh-card-r) - 1px);
  position:absolute;width:400px;height:252px;box-sizing:border-box;display:flex;flex-direction:column;
  border:1px solid var(--dsh-hairline);border-radius:var(--dsh-card-r);background:var(--dsh-card);user-select:none;
  transition:border-color .12s ease,background .12s ease}
.dsh-canvas-card:hover{border-color:var(--dsh-mid)}
.dsh-canvas-card.is-selected{background:var(--dsh-soft);border-color:var(--dsh-mid)}
/* 连线拖拽的碰撞高亮：指针落进哪张卡，哪张卡亮起 breeze 色的边与光晕——
   放手就在它身上结关联，而不是弹「新增节点」。与 is-selected 的静音灰刻意不同。 */
.dsh-canvas-card.is-link-over{border-color:var(--dsh-breeze);box-shadow:0 0 0 3px var(--dsh-hl-edge)}
.dsh-canvas-card.is-absent .dsh-canvas-card-preview{opacity:.35}
/* 生成中（会话 running）：整张卡片亮起**流光**——一道斜切 25° 的光带从左扫到右，
   1.8s 一趟，不停顿。名字与预览照常显示（陈旧不等于假：卡上留着的是最近一次真正
   存在过的产物），光的往复本身就是「正在产出新内容」的整句话。卡面只微亮一档、
   边框不变色：边框归悬停与选中，随运行变色会让卡片看起来像被框起来警告。

   光带画在独立的子层 .dsh-canvas-shimmer 上，不用卡片自己的 ::after：卡片不能
   overflow:hidden——两个引用端口是悬在卡外的，裁了就没法拖线了。 */
.dsh-canvas-card.is-working{background:var(--dsh-slot)}
.dsh-canvas-shimmer{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none}
.dsh-canvas-shimmer::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;
  background:linear-gradient(90deg,transparent 0%,var(--dsh-sheen) 40%,
    var(--dsh-sheen-peak) 50%,var(--dsh-sheen) 60%,transparent 100%);
  transform:skewX(-25deg) translateX(-120%);animation:dsh-canvas-shimmer 1.8s linear infinite}
.dsh-canvas-card-head{flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;min-width:0;
  border-top-left-radius:var(--dsh-card-inner-r);border-top-right-radius:var(--dsh-card-inner-r)}
.dsh-canvas-card-name{flex:1 1 auto;min-width:0;font:500 12px/16px var(--dsh-font);color:var(--dsh-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 就地改名（F1.12）：名条上按下即抬手就切进输入框，回车或失焦提交，Esc 撤回。
   输入框与名字**同高同字**（16px，border-box：14px 行高 + 上下各 1px 边框），
   于是切换那一刻卡片上别的东西一个像素都不动；底色与发丝边框只是说「这里能写」。
   卡片整体是 user-select:none，输入框必须自己把它要回来，否则选不中已经写着的字。 */
.dsh-canvas-card-namefield{flex:1 1 auto;min-width:0;box-sizing:border-box;height:16px;padding:0 4px;
  font:500 12px/14px var(--dsh-font);color:var(--dsh-fg);background:var(--dsh-surface);
  border:1px solid var(--dsh-mid);border-radius:4px;outline:none;
  -webkit-user-select:text;user-select:text}
.dsh-canvas-card-namefield:focus{border-color:var(--dsh-breeze)}
.dsh-canvas-card-preview{flex:1 1 auto;min-height:0;box-sizing:border-box;padding:0 10px 8px;overflow:hidden;background:var(--dsh-card);
  border-bottom-left-radius:var(--dsh-card-inner-r);border-bottom-right-radius:var(--dsh-card-inner-r)}
.dsh-canvas-card-preview-line{font:11px/16px var(--dsh-mono);color:var(--dsh-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-card-preview-line:first-child{color:var(--dsh-fg-2)}
/* 文本卡片的 markdown 预览：原文头部渲染后的样子。字号压到 11px 一档，块级边距全部
   收紧——卡面只有约 106px 高，字号与留白都按「多看两行」预算。链接不出手（pointer-events:none）：
   卡片整体是拖拽把柄，预览里的链接点下去只会跟拖卡片打架。 */
.dsh-canvas-card-md{max-height:100%;overflow:hidden;font:11px/15px var(--dsh-font);color:var(--dsh-fg-3)}
.dsh-canvas-card-md p{margin:0 0 3px}
.dsh-canvas-card-md h1,.dsh-canvas-card-md h2,.dsh-canvas-card-md h3{margin:3px 0;font:600 11px/15px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-card-md :first-child{margin-top:0}
.dsh-canvas-card-md ul,.dsh-canvas-card-md ol{margin:0 0 3px;padding-left:15px}
.dsh-canvas-card-md li{margin:0}
.dsh-canvas-card-md blockquote{margin:0 0 3px;padding-left:7px;border-left:2px solid var(--dsh-mid)}
.dsh-canvas-card-md pre{margin:0 0 3px;padding:2px 5px;border-radius:3px;background:var(--dsh-soft);overflow:hidden}
.dsh-canvas-card-md pre code{font:10px/14px var(--dsh-mono);color:var(--dsh-fg-2)}
.dsh-canvas-card-md code{font:10px/14px var(--dsh-mono);color:var(--dsh-fg-2)}
.dsh-canvas-card-md a{color:var(--dsh-breeze);pointer-events:none}
.dsh-canvas-card-md hr{border:0;border-top:1px solid var(--dsh-mid);margin:3px 0}
/* 设计卡片的截图与应用卡片的迷你帧：两者都从预览区的内边距里破格而出——截图就该铺满
   卡面（负边距抵掉 10px 左右与 8px 底），下缘的两只圆角继承卡片的内圆角变量。 */
.dsh-canvas-card-shot{display:block;width:calc(100% + 20px);margin:0 -10px -8px;
  border-bottom-left-radius:var(--dsh-card-inner-r);border-bottom-right-radius:var(--dsh-card-inner-r);background:var(--dsh-card)}
.dsh-canvas-card-frame{width:calc(100% + 20px);height:calc(100% + 8px);margin:0 -10px -8px;overflow:hidden;background:var(--dsh-card);
  border-bottom-left-radius:var(--dsh-card-inner-r);border-bottom-right-radius:var(--dsh-card-inner-r)}
/* 帧按 2x 视口渲染再缩回 0.5：页面以两倍尺寸排版，缩下后文字仍然锐——这正是截图的清晰度。 */
.dsh-canvas-card-frame iframe{display:block;width:200%;height:200%;border:0;pointer-events:none;
  transform:scale(.5);transform-origin:0 0}
/* 媒体卡面（F2.7）：产物本身就是画面，所以它铺满预览区——与设计截图同一条破格（负边距抵掉
   10px 左右与 8px 底），下缘两角继承卡片内圆角。图片与视频用 contain 而不是 cover：卡面
   398×224（正好 16:9）而产物什么比例都有，裁掉一块的画面对「这是我生成的那一张」是一种欺骗。 */
.dsh-canvas-card-media{display:block;width:calc(100% + 20px);height:calc(100% + 8px);margin:0 -10px -8px;
  object-fit:contain;background:var(--dsh-soft);
  border-bottom-left-radius:var(--dsh-card-inner-r);border-bottom-right-radius:var(--dsh-card-inner-r)}
/* 音频没有画面：铺满只会得到一片空白，所以它是居中那一条播放器（与全屏预览同一条规矩）。
   控件自己吃指针（见 media-face.ts 第 2 条），控件外面那圈空白不吃——点那里照旧选中卡片。 */
.dsh-canvas-card-media-audio{display:flex;align-items:center;height:100%}
.dsh-canvas-card-media-audio audio{width:100%}
/* 卡面上的那句话（产物还没生成 / 文件过大）：与大纲行同一档字号，文案也与全屏预览同一批，
   不在这里另说一套。 */
.dsh-canvas-card-note{font:11px/16px var(--dsh-font);color:var(--dsh-fg-3)}
.dsh-canvas-card-meta{font:10px/14px var(--dsh-mono);letter-spacing:.6px;color:var(--dsh-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 状态点只剩左侧的实时卡片（tool-view.tsx）在用——画布卡片上那枚已经去掉：
   那边用流光说「在跑」，不再用灯。 */
.dsh-canvas-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsh-fg-3)}
.dsh-canvas-dot[data-state=running]{background:var(--dsh-sunset);animation:dsh-canvas-pulse 1.4s ease-in-out infinite}
.dsh-canvas-dot[data-state=notified]{background:var(--dsh-twilight)}
.dsh-canvas-dot[data-state=idle]{background:var(--dsh-mid)}
.dsh-canvas-dot[data-state=missing]{background:var(--dsh-fg-3);opacity:.5}
.dsh-canvas-port{position:absolute;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;
  border:1px solid var(--dsh-mid);background:var(--dsh-surface);color:var(--dsh-fg-3);
  font:11px/14px var(--dsh-mono);text-align:center;cursor:crosshair;opacity:0}
.dsh-canvas-card:hover .dsh-canvas-port{opacity:1}
.dsh-canvas-card.is-selected .dsh-canvas-port{opacity:1}
.dsh-canvas-port:hover{border-color:var(--dsh-breeze);color:var(--dsh-breeze)}
/* 端口整体悬在卡片外侧，与卡片边缘留 12px 间距（16px 端口 + 12px 间隙 = 28px）。 */
.dsh-canvas-port[data-side=in]{left:-28px}
.dsh-canvas-port[data-side=out]{right:-28px}

/* ── edges ──────────────────────────────────────────────────────────────── */
.dsh-canvas-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
/* 引用线只有一副样子：1px 细线、实线、无箭头、breeze 色。**拖拽中的那一根也是这副
   样子**——它就是这条线本身，只是另一头还跟着手，所以这里没有 pending 变体（那个类
   只作工具标记）。整层 pointer-events:none：线只负责看，永远不拦指针。 */
.dsh-canvas-edge{fill:none;stroke:var(--dsh-breeze);stroke-width:1;stroke-linecap:round;opacity:.85}
/* 选中卡片时它的连线提亮一档：只动不透明度，线型与常态完全一致。 */
.dsh-canvas-edge.is-active{opacity:1}

/* 线放到空白处放手时开的那张「新增节点」：钉在放手点（画布坐标）上，随画布一起
   平移；外层用 scale(1/z) 抵消取景缩放，字号不随视图变。弹层往屏上空间更大的那一
   侧张开（flip 在放手那一刻算定），线头因此不会被弹层自己盖住。 */
.dsh-canvas-dropzone{position:absolute;transform:scale(var(--dsh-inv,1));transform-origin:0 0}
.dsh-canvas-dropmenu{position:absolute;left:0;top:0;z-index:7;transform:translate(10px,10px)}
.dsh-canvas-dropmenu[data-flip-x=true]{transform:translate(calc(-100% - 10px),10px)}
.dsh-canvas-dropmenu[data-flip-y=true]{transform:translate(10px,calc(-100% - 10px))}
.dsh-canvas-dropmenu[data-flip-x=true][data-flip-y=true]{transform:translate(calc(-100% - 10px),calc(-100% - 10px))}
.dsh-canvas-dropmenu-title{padding:4px 10px 5px;font:500 10px/14px var(--dsh-mono);letter-spacing:1.2px;
  text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-dropmenu-hint{padding:5px 10px 4px;font:11px/16px var(--dsh-font);color:var(--dsh-fg-3)}

/* ── note ───────────────────────────────────────────────────────────────── */
.dsh-canvas-note{position:absolute;width:180px;box-sizing:border-box;padding:10px;border-radius:8px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);color:var(--dsh-fg-2);font:12px/18px var(--dsh-font);white-space:pre-wrap;word-break:break-word}
.dsh-canvas-note-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;
  font:500 9px/12px var(--dsh-mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--dsh-fg-3)}

/* ── card session overlay / composer ─────────────────────────────────────── */
.dsh-canvas-overlay{position:absolute;width:380px;box-sizing:border-box;padding:10px 12px;border-radius:8px;
  border:1px solid var(--dsh-mid);background:var(--dsh-card)}
.dsh-canvas-overlay-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;
  font:500 9px/12px var(--dsh-mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-overlay-head .dsh-canvas-spacer{margin-left:auto}
.dsh-canvas-spacer{margin-left:auto}

/* ── 提示词输入框公共件（prompt-input.tsx）────────────────────────────────
   正文是 contenteditable：**内容就是值**——文字照抄、换行一枚 <br>、@文件 记号是一枚
   contenteditable=false 的**引用标签**（图标 + 文件名 + 可选行号），整体不可分隔。
   外形归调用方的皮肤类（.dsh-canvas-composer-input / .dsh-canvas-pickbox-input，落在
   容器上、被正文继承——内边距因此也由皮肤类给在这里，见下面两条）；以下几条只管布局：
   正文在流里撑高（min/max 高度由皮肤给），容器限高时正文自己滚；占位符浮在同一处、指针
   全开（点它等于点进框里）。
   标签那一行是 18px（内边距 2+2、行高 14），与正文行高**等高**——一枚标签不许把行撑开，
   否则插进一句话中间就把整段的行距改了。 */
.dsh-canvas-promptbox{position:relative;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden}
/* cursor:text 必须自己说：cursor 是继承属性，而画布表面（.dsh-canvas-surface）钉着
   cursor:default——整块表面都是选择箭头（见上面 surface 那一段），于是继承下来的默认
   值会压掉浏览器给「可编辑」内容自动出的 I 型光标（宿主那一套只对 input / textarea 的
   UA 样式生效，contenteditable 靠的是「cursor 仍是 auto」才会露出文本光标）。少了这一
   句，鼠标移进提示词框看着就像移在一张图或一块静态文字上——而这是本插件里唯一一处
   contenteditable。 */
.dsh-canvas-promptbox-field{flex:1 1 auto;min-height:0;box-sizing:border-box;width:100%;padding:6px 10px;
  border:none;outline:none;background:transparent;color:var(--dsh-fg);caret-color:var(--dsh-fg);
  font:inherit;tab-size:2;white-space:pre-wrap;overflow-wrap:break-word;overflow:auto;cursor:text}
.dsh-canvas-promptbox-placeholder{position:absolute;inset:0;box-sizing:border-box;padding:6px 10px;
  pointer-events:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:break-word;color:var(--dsh-fg-3)}
/* 引用标签：@文件 记号的那张脸——底色只给这一段，名字亮出来，图标与徽标轻下去。
   整枚是 contenteditable=false 的原子节点，所以它自己不许有可编辑的「里面」。
   四种长相共用一枚标签：代码（纸页）、图片（缩略图，取不到才退回一张画）、视频
   （胶片 + 播放）、音频（波形），标记 / 区域另有十字与框角。缩略图那一枚把标签
   加宽而不是加高——**行高是判据**（见上），宽只影响它那一行排得下几个字。 */
.dsh-canvas-ref-chip{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;
  max-width:220px;margin:0 2px;padding:2px 6px;border-radius:4px;vertical-align:middle;
  background:var(--dsh-hl);box-shadow:0 0 0 1px var(--dsh-hl-edge);
  font:12px/14px var(--dsh-font);color:var(--dsh-fg);user-select:none;cursor:default}
.dsh-canvas-ref-chip-icon{flex:none;width:12px;height:12px;color:var(--dsh-fg-3)}
/* 缩略图：与标签**同高**（18px），上下两条 -2px 的外边距把内容盒那 14px 之外的 4px 吃掉，
   所以标签仍是一行 18px（行高是判据，见上）。**
   尺寸只能是 18，不能更大**：内容盒只有 14px，一枚 20px 的图会从盒子上下各探出 1px，
   而那一圈发丝边是画在盒子**外面**的 box-shadow——探出来的那 1px 正好把它压掉一段，
   看起来就是「标签的边缺了个口」。 */
.dsh-canvas-ref-chip-thumb{flex:none;width:18px;height:18px;box-sizing:border-box;margin:-2px 0 -2px -2px;
  border-radius:4px;border:1px solid var(--dsh-hairline);object-fit:cover;background:var(--dsh-slot)}
/* 名字（超长省略）：标签宽度有上限，而一枚标签始终只有一枚的可读宽度。 */
.dsh-canvas-ref-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-weight:600;color:var(--dsh-breeze)}
/* 徽标：代码类是行号、标记类是坐标——两种读数共用这一格。 */
.dsh-canvas-ref-chip-badge{flex:none;font:11px/14px var(--dsh-mono);color:var(--dsh-fg-3)}

/* 选中卡片下方的那条控制带：引用 chips 与 ⊕ 引入入口 → 提示词输入框 → 模型席位、
   状态点与发送。chips 是「一条 chip = 一条引用边」，所以每枚右上角都挂着自己的删除钮
   （卡片上没有 overflow:hidden，角标才探得出去；文字的截断交给内部的 label）。 */
.dsh-canvas-composer{display:flex;flex-direction:column;gap:8px}
/* position:relative：@ 候选菜单按这一行锚定（它浮在材料行之上，见下面 .dsh-canvas-refmenu）。 */
.dsh-canvas-composer-materials{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:7px}
/* @ 候选：浮在材料行上沿，左沿与带子对齐。行里那枚 data-at 是键盘走到的一枚（与
   「当前席位」那个 ✓ 分开：那是值，这是光标——两件事不该共用一个记号）。 */
.dsh-canvas-refmenu{left:0;right:0;bottom:calc(100% + 6px);max-height:220px;overflow:auto;z-index:8}
.dsh-canvas-menu .dsh-canvas-row[data-at=true]{background:var(--dsh-hl);color:var(--dsh-fg)}
.dsh-canvas-menu .dsh-canvas-row[data-at=true] .dsh-canvas-row-meta{color:var(--dsh-fg-2)}
/* 候选行里那枚小图：就是标签上那枚缩略图的候选版，取回来才画。 */
.dsh-canvas-refthumb{flex:none;width:20px;height:20px;margin-right:2px;box-sizing:border-box;
  border-radius:3px;border:1px solid var(--dsh-hairline);object-fit:cover;background:var(--dsh-slot)}
.dsh-canvas-chip{position:relative;display:inline-flex;align-items:center;max-width:170px;height:26px;box-sizing:border-box;
  padding:0 8px 0 12px;border:1px solid color-mix(in srgb,var(--dsh-breeze) 45%,transparent);border-radius:999px;
  font:12px/24px var(--dsh-font);color:var(--dsh-breeze)}
.dsh-canvas-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-chipdrop{position:absolute;top:-6px;right:-6px;display:inline-flex;align-items:center;justify-content:center;
  width:16px;height:16px;box-sizing:border-box;padding:0;border:1px solid var(--dsh-mid);border-radius:50%;
  background:var(--dsh-card);color:var(--dsh-fg-3);font:11px/1 var(--dsh-font);cursor:pointer;z-index:1}
.dsh-canvas-chipdrop:hover{background:var(--dsh-sunset-solid);border-color:var(--dsh-sunset-solid);color:var(--dsh-on-sunset)}
.dsh-canvas-composer-materialzone{position:relative;display:inline-flex}
.dsh-canvas-composer-materialzone .dsh-canvas-chipbtn{height:26px;padding:0 9px;font:14px/24px var(--dsh-font)}
.dsh-canvas-menu.is-raised{position:absolute;left:0;bottom:28px;z-index:7;box-shadow:none}
.dsh-canvas-composer-menuempty{display:block;padding:7px 10px;font:12px/18px var(--dsh-font);color:var(--dsh-fg-3);white-space:nowrap}
/* 席位选了「媒体生成模型」时的那句提示（v1.73）。它是一句**可行动的警告**，不是状态：
   换一个模型就好了，所以用告警色、允许多行（它比一行长）。 */
.dsh-canvas-composer-menunote{display:block;max-width:240px;padding:7px 10px;font:11px/16px var(--dsh-font);color:var(--dsh-sunset);white-space:normal}
.dsh-canvas-modelbtn[data-media-seat=true]{color:var(--dsh-sunset)}
/* 材料行右上角那颗〔放大〕（⤢）**只有行内有**——它开合的是这条带子。放大态那颗
   〔缩小〕（⤡）不在这儿，它站在弹窗头部右上角（见下面的 .dsh-canvas-promptmodal-shrink）。 */
.dsh-canvas-composer-corner{margin-left:auto}
/* 输入框的内边距归**正文**（.dsh-canvas-promptbox-field，见上面那一段）：正文在流里
   撑高、限高时自己滚，内边距就得长在它身上，卷起来的字才在它自己的边内裁剪。所以皮肤类
   只给盒子与字——这两条是「放大态与行内逐字相同」的落点，别在这儿加 padding。 */
.dsh-canvas-composer-input{flex:none;box-sizing:border-box;width:100%;min-height:54px;max-height:120px;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-field);
  color:var(--dsh-fg);font:12px/18px var(--dsh-font)}
.dsh-canvas-composer-input:focus-within{outline:none;border-color:var(--dsh-mid)}
/* 放大态与行内是**同一个输入框**：字、行高、内边距、圆角一个字都不改，变的只有容器
   给它的余地——外壳更高，它就多占一些（把 54/120 的上下限让开）。这个标记刻意走 data
   属性而不是另加一个类：三行的 class 序列在两种尺寸下逐字相同，而那件事本身就该是真的
   ——真机判据直接比 class 序列，含糊不得。 */
.dsh-canvas-composer-input[data-fullscreen]{flex:1 1 auto;min-height:0;max-height:none}
/* 拖过之后输入框自己揣着一个高度（内联写的），那 120px 的上限得让开；没拖过则一个字
   都不动——今天的 CSS 就是默认那份。 */
.dsh-canvas-composer-input[data-sized]{max-height:none}
.dsh-canvas-composer-foot{display:flex;align-items:center;gap:8px;min-width:0}
/* 控制带右下角那颗把手：拖它就是把这条带子放大。它拖出来的只是**空间**——字号、行高、
   内边距、圆角与那三行结构一律照旧（放大态（⤢）用的是同一个 ComposerBody，连输入框都
   是同一个 .dsh-canvas-composer-input，只是容器更高）。把手贴着外角站（与 chip 的删除
   钮同一套做法），所以它既不占带里的位置、也不跟右下角那颗发送钮抢那一下点击；平时淡
   着、指上去才亮出来。 */
.dsh-canvas-composer-grip{position:absolute;right:-5px;bottom:-5px;display:flex;align-items:flex-end;justify-content:flex-end;
  width:16px;height:16px;box-sizing:border-box;padding:0 3px 3px 0;color:var(--dsh-fg-3);
  cursor:nwse-resize;opacity:.45;touch-action:none}
.dsh-canvas-composer-grip:hover,.dsh-canvas-composer[data-resizing] .dsh-canvas-composer-grip{opacity:1;color:var(--dsh-fg-2)}
.dsh-canvas-modelzone{position:relative;display:inline-flex;flex:none}
.dsh-canvas-modelbtn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 9px;border:none;border-radius:999px;
  background:transparent;color:var(--dsh-fg-3);font:500 11px/22px var(--dsh-font);cursor:pointer;white-space:nowrap;max-width:150px;
  overflow:hidden;text-overflow:ellipsis}
.dsh-canvas-modelbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-modelmenu{left:0;bottom:26px;max-height:280px;overflow:auto;z-index:8}
.dsh-canvas-modelgroup{padding:6px 8px 3px;font:500 9px/12px var(--dsh-mono);letter-spacing:1.2px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-menu .dsh-canvas-row[data-current=true]{color:var(--dsh-fg)}
.dsh-canvas-menu .dsh-canvas-row[data-current=true]::after{content:'✓';margin-left:auto;color:var(--dsh-sunset)}

/* 放大态提示词弹窗：这不是另一个界面，是**同一个控制台换了个壳**——里面装的还是那三行
   （材料行 + 输入框 + 底栏），由同一个 ComposerBody 画出来，字号、行高、内边距与行内
   逐字同一份。外壳只多做一件事：给那三行一圈边距与一点间隙。
   两处按钮各站各的地盘：行内带子右上角是〔放大〕（⤢，管带子的开合），这里头部右上角
   是〔缩小〕（⤡，管这个壳的开合）——所以那颗按钮站在壳的头上，不混进那三行里，材料行
   因此与行内逐项相同。按钮本身还是通用的胶囊按钮（.dsh-canvas-chipbtn），位置由下面
   这一条定：margin-left:auto 推到右沿、flex:none 免得被长标题挤扁、上下各 -4px 把 26px
   的胶囊塞进头部那一行——头部因此还是 43px 高，多一颗按钮没让内容区矮下去。 */
.dsh-canvas-scrim.is-modal{z-index:8}
.dsh-canvas-promptmodal{width:min(720px,100%);height:min(480px,100%)}
.dsh-canvas-promptmodal-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.dsh-canvas-promptmodal-shrink{flex:none;margin:-4px -4px -4px auto}

/* ── fullscreen artifact viewer (F3.8) ──────────────────────────────────── */
/* 双击卡片打开：预览就是**整块画布**——对话框铺满画布区（同宽同高、不留边距、不切角），
   内容按形态各由各的组件渲染；图片 / 视频 / iframe 因此拿到画布的全部面积。
   选择器写成 .dsh-canvas-dialog.dsh-canvas-viewer（而不是单独的 .dsh-canvas-viewer）是
   必须的：通用对话框那条 .dsh-canvas-dialog 的宽度 min(520px,100%) 与单类同权重、
   且在文件里更靠后，只写单类会被它顶掉宽度（旧版就栽在这里，预览一直是 520px 宽）。
   注意本文件是 TS 模板字符串——注释里不要出现反引号，会截断字符串（实测踩过两次）。 */
.dsh-canvas-scrim.is-viewer{z-index:9;padding:0}
.dsh-canvas-dialog.dsh-canvas-viewer{width:100%;height:100%;border:none;border-radius:0}
.dsh-canvas-viewer .dsh-canvas-dialog-head{flex:none}
/* 插槽：把落点摊平。
   头部与条带都是 flex 容器（头部靠 gap:8px 排一排，条带里每一行是 flex:none 的一格），
   而挂进插槽的节点是**另一个组件**画出来的。插槽自己要是成了一个盒子，头部那 8px 会多出
   一份、条带里那几行也不再是对话框的直接子元素、间距与位置全会变。display:contents 让
   插槽不生成盒子，挂进来的东西就落在它们本来该在的地方。 */
.dsh-canvas-slot{display:contents}
.dsh-canvas-viewer-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:auto}
.dsh-canvas-viewer-truncated{flex:none;padding:7px 16px;border-bottom:1px solid var(--dsh-hairline);
  font:11px/16px var(--dsh-mono);color:var(--dsh-sunset)}
/* 预览面渲染的是编辑器里的缓冲区（草稿比磁盘新）。这一条把话说在前面，否则
   「切到预览还是旧文」会被读成刚才的字丢了。用 breeze 而不是 sunset：它不是
   告警，只是说明你正看着未落盘的那一份。 */
.dsh-canvas-viewer-draft{flex:none;padding:7px 16px;border-bottom:1px solid var(--dsh-hairline);
  font:11px/16px var(--dsh-mono);color:var(--dsh-breeze)}
.dsh-canvas-viewer-note{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px;
  color:var(--dsh-fg-3);font:13px/20px var(--dsh-font);text-align:center}
/* 文本节点的编辑面：编辑区就是整块画布面积——预览与编辑是同一弹窗的两种尺寸。 */
.dsh-canvas-viewer-editor{flex:1 1 auto;min-height:0;box-sizing:border-box;width:100%;padding:18px 24px;resize:none;
  border:none;outline:none;background:transparent;color:var(--dsh-fg);
  font:13px/22px var(--dsh-mono);tab-size:2}
.dsh-canvas-viewer-status{font:500 11px/16px var(--dsh-font);color:var(--dsh-fg-3);letter-spacing:.4px}
/* 预览 / 编辑是一条**单选组**，不是一枚标签会翻转的按钮：底槽凹进（slot 面 + 发丝边），
   选中的那一半落成实心拇指（mid 面 + 白字）。旧写法按钮上写的是**另一面**的名字，
   想知道「现在在哪一面」得反推；单选组把这件事直接画出来。
   两半等宽（min-width），所以点的时候指头不用跟着字的宽度挪。 */
.dsh-canvas-modeswitch{display:inline-flex;flex:none;align-items:center;gap:2px;height:24px;box-sizing:border-box;
  padding:2px;border:1px solid var(--dsh-hairline);border-radius:999px;background:var(--dsh-slot)}
.dsh-canvas-modeswitch-opt{display:inline-flex;align-items:center;justify-content:center;height:18px;
  min-width:48px;padding:0 10px;border:none;border-radius:999px;background:transparent;cursor:pointer;
  font:500 11px/18px var(--dsh-font);letter-spacing:.4px;color:var(--dsh-fg-3)}
.dsh-canvas-modeswitch-opt:hover{color:var(--dsh-fg)}
.dsh-canvas-modeswitch-opt[aria-checked=true]{background:var(--dsh-mid);color:var(--dsh-fg)}
.dsh-canvas-modeswitch-opt:focus-visible{outline:1px solid var(--dsh-breeze);outline-offset:1px}
/* ── 元素选择（F3.14） ────────────────────────────────────────────────────
   按下工具按钮之后发生的事分两层：页面里那层由 host 注入的探针画（它才看得见页面），
   弹窗这层由这里画（它才拿得到画布主题）。两层的颜色同源——都是 breeze。 */
.dsh-canvas-picktool[data-on=true]{background:var(--dsh-breeze);color:var(--dsh-on-accent)}
.dsh-canvas-picktool[data-on=true]:hover{background:var(--dsh-breeze);color:var(--dsh-on-accent);filter:brightness(1.06)}
/* 元素选择那两条提示（「正在选元素」与它的回话）都**浮在帧上、不占排版位**，共用这一层。
   不占位是判据，不是省地方：圈与提示词框拿帧的位置当锚，而锚是这一笔出生那一刻量好的
   ——提示条只要排进流里，出现或消失的那一瞬就会把帧顶走一整条，圈与框整个错开（发送后
   回话冒出来、选中区偏掉，就是这个）。层本身不接指针；里面要给按钮的（回话的 ×）自己
   开回来。左侧那道实色与链接说明区分：这两条说的是**我们**正在做的这件事，链接那条说的
   是页面自己的事。 */
.dsh-canvas-frame-notestack{position:absolute;left:0;right:0;top:0;z-index:1;pointer-events:none;
  display:flex;flex-direction:column}
.dsh-canvas-frame-note.is-pick{border-left:3px solid var(--dsh-breeze);padding-left:13px}
/* 元素选择的回话：发出去是一件事、产物真的变了是另一件事，两句话都说出来。它带一个能点的
   ×，所以这一条把指针开回来——占住的只是帧顶上这一条，与它从前排在流里时占的那一条同高。 */
.dsh-canvas-viewer-picked{pointer-events:auto;flex:none;display:flex;align-items:center;gap:8px;
  padding:8px 16px 8px 13px;border-bottom:1px solid var(--dsh-hairline);
  border-left:3px solid var(--dsh-breeze);background:var(--dsh-slot);
  font:12px/18px var(--dsh-font);color:var(--dsh-breeze)}
/* 选中的那一圈：探针收起自己的高亮之后由这里一直画着。fixed 与帧的视口坐标同源，
   pointer-events:none 保证它永远不抢页面的鼠标。标贴用 --dsh-card 当字色——亮色下是
   白字压在 breeze 上、暗色下是深字压在浅蓝上，两套都读得清。

   改动跑起来时圈里会多一层 .dsh-canvas-shimmer（就是卡片上那道流光，连同它的令牌与
   keyframes 一起复用，见上面 is-working 那一段）：**动作只有一套语义，光在动 = 正在产出**，
   这里说的正是页面里那一段在改。它在圈内裁切（那一层自己 overflow:hidden），所以光带扫的
   是**选中的那个区域**，不会溢出到页面别处。 */
.dsh-canvas-pickhold{position:fixed;z-index:1;box-sizing:border-box;pointer-events:none;
  border:1px solid var(--dsh-breeze);border-radius:2px;box-shadow:0 0 0 3px var(--dsh-sheen)}
.dsh-canvas-pickhold-tag{position:absolute;left:-1px;top:-19px;max-width:240px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:3px 3px 0 0;
  background:var(--dsh-breeze);color:var(--dsh-on-accent);font:11px/16px var(--dsh-mono)}
/* 提示词框：浮在第三个来源的内容之上（用户自己的页面），所以这一层是全画布唯一带
   阴影的浮层——阴影用的是画布自己那对双值令牌，亮暗两套各自成立。 */
.dsh-canvas-pickbox{position:fixed;z-index:2;display:flex;flex-direction:column;box-sizing:border-box;
  overflow:hidden;border:1px solid var(--dsh-mid);border-radius:10px;background:var(--dsh-card);
  color:var(--dsh-fg);box-shadow:0 8px 28px var(--dsh-sheen-peak)}
.dsh-canvas-pickbox-head{flex:none;display:flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;
  border-bottom:1px solid var(--dsh-hairline)}
.dsh-canvas-pickbox-tag{flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:500 11px/16px var(--dsh-mono);color:var(--dsh-breeze)}
.dsh-canvas-pickbox-file{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:11px/16px var(--dsh-mono);color:var(--dsh-fg-3)}
/* 框里装的就是要发出去的那段提示词，只是**前半个身子没画出来**：元素定位与节点源码
   （几十行）折成了框内第一枚标签（.dsh-canvas-ref-chip，那几十行原文仍是值的一部分，
   整枚可删）。剩下的是用户自己写的要求。等宽正文区与内边距照旧——框里比控制带松一档，
   10/12 而不是 6/10。 */
.dsh-canvas-pickbox-input{flex:1 1 auto;min-height:0;box-sizing:border-box;width:100%;
  border:none;background:transparent;color:var(--dsh-fg);
  font:12px/18px var(--dsh-mono);tab-size:2}
.dsh-canvas-pickbox-input .dsh-canvas-promptbox-field,
.dsh-canvas-pickbox-input .dsh-canvas-promptbox-placeholder{padding:10px 12px}
.dsh-canvas-pickbox-error{flex:none;max-height:52px;overflow:auto;padding:6px 12px;
  border-top:1px solid var(--dsh-hairline);font:11px/16px var(--dsh-font);color:var(--dsh-sunset)}
.dsh-canvas-pickbox-foot{flex:none;display:flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;
  border-top:1px solid var(--dsh-hairline)}
.dsh-canvas-pickbox-hint{flex:1 1 auto;min-width:0;font:11px/16px var(--dsh-font);color:var(--dsh-fg-3)}
.dsh-canvas-viewer-confirm,.dsh-canvas-viewer-error{flex:none;display:flex;align-items:center;gap:8px;
  padding:8px 16px;border-bottom:1px solid var(--dsh-hairline);font:12px/18px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-viewer-error{color:var(--dsh-sunset);flex-wrap:wrap}
.dsh-canvas-viewer-errmain{flex:0 1 auto;min-width:0}
/* 被拒的那次写入把原生错误也留在下面一行：它写着是哪个 syscall、哪条暂存路径——
   对要修的人（或要提 issue 的人）这就是全部诊断，但不该是写作者在正文顶上先读到的东西。 */
.dsh-canvas-viewer-errdetail{flex:1 1 100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:10px/14px var(--dsh-mono);color:var(--dsh-fg-3)}
.dsh-canvas-media{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
.dsh-canvas-media img,.dsh-canvas-media video{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px}
/* 音频面板：一段音频没有画面，铺满只会得到一片空白，所以这里是**一列**——播放条
   占满宽度、文件名在它下面。flex:0 0 auto 让这一列在面板中央按内容高度收拢。 */
.dsh-canvas-media-audio{flex-direction:column;gap:10px;flex:0 0 auto}
.dsh-canvas-media-audio audio{width:100%;min-width:280px}
.dsh-canvas-media-label{color:var(--dsh-fg-3);font:12px/18px var(--dsh-font);max-width:100%;overflow-wrap:anywhere;text-align:center}
/* 设计预览：viewer-body 的 flex 子元素（不是 absolute——那会逃到外层定位祖先、
   盖住头部）。画布手感在类里：grab 光标、触屏不滚动、canvas 绝对铺满。 */
.dsh-canvas-design{flex:1 1 auto;min-height:0;position:relative;overflow:hidden;background:#e9ebef;touch-action:none;cursor:grab}
.dsh-canvas-design.is-panning{cursor:grabbing}
/* 编辑模式：鼠标默认是选择元素；空格按住变抓手（平移），拖动中保持抓手。 */
.dsh-canvas-design.is-editing{cursor:default}
.dsh-canvas-design.is-editing.is-space{cursor:grab}
.dsh-canvas-design.is-editing.is-space.is-panning{cursor:grabbing}
.dsh-canvas-design canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.dsh-canvas-design-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:var(--dsh-fg-3);font:13px/19px var(--dsh-font);pointer-events:none}
/* 视口 HUD（左下角）：缩放控制、适应容器、快捷键提示。中性色走宿主别名令牌，
   暗色自动跟随；键盘快捷键跟聚焦走（画布 tabIndex=0），聚焦不画 outline。 */
.dsh-canvas-design:focus{outline:none}
.dsh-canvas-design-hud{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:2px;
  padding:3px;border-radius:8px;border:1px solid var(--dsh-hairline);background:var(--dsh-card);
  box-shadow:0 1px 4px rgba(0,0,0,.12);user-select:none;cursor:default}
.dsh-canvas-design-hud button{border:none;background:transparent;color:var(--dsh-fg-2);cursor:pointer;
  font:12px/16px var(--dsh-font);padding:3px 8px;border-radius:6px}
.dsh-canvas-design-hud button:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-design-hud-pct{min-width:52px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-canvas-design-hud-hint{padding:3px 8px;margin-left:2px;border-left:1px solid var(--dsh-hairline);
  color:var(--dsh-fg-3);font:10px/16px var(--dsh-font);white-space:nowrap}
/* 编辑态的 dock（画布顶部中间）：撤销 / 重做 / 单选 / 多选。
   浮层的左右两条边由 design-panels.tsx 按面板宽度给（它才知道两块面板之间那段空当在
   哪儿），这里只管垂直位置与横向摆正中。浮层本身不吃指针——空当上那点画布还要能点，
   只有这枚胶囊吃。 */
.dsh-canvas-design-dock-layer{position:absolute;top:12px;display:flex;justify-content:center;
  pointer-events:none;z-index:2}
.dsh-canvas-design-dock{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);box-shadow:0 2px 10px rgba(0,0,0,.16);
  user-select:none;cursor:default;pointer-events:auto}
.dsh-canvas-design-dock button{display:inline-flex;align-items:center;justify-content:center;
  border:none;background:transparent;color:var(--dsh-fg-2);cursor:pointer;
  font:12px/16px var(--dsh-font);padding:3px 9px;border-radius:999px}
.dsh-canvas-design-dock button:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
/* 撤销/重做没得走时是灰的：按钮**在**（位置不跳、含义一眼认得），只是按不动。它俩办完事
   就走，所以没有持续高亮——只有按不动这一种状态。 */
.dsh-canvas-design-dock button:disabled{color:var(--dsh-fg-3);opacity:.45;cursor:default}
.dsh-canvas-design-dock button:disabled:hover{background:transparent;color:var(--dsh-fg-3)}
/* 单选/多选是「现在在哪一面」：永远有一枚亮着，与模式开关同一副画法。 */
.dsh-canvas-design-dock-modes{display:inline-flex;align-items:center;gap:2px}
.dsh-canvas-design-dock-modes button[aria-checked=true]{background:var(--dsh-mid);color:var(--dsh-fg)}
.dsh-canvas-design-dock-sep{width:1px;height:16px;margin:0 3px;background:var(--dsh-hairline)}
/* 属性条（底部居中，单选时出现）：字段与 HUD 同一族壳。 */
.dsh-canvas-design-props{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;
  align-items:center;gap:10px;max-width:calc(100% - 300px);padding:5px 10px;border-radius:8px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);box-shadow:0 1px 4px rgba(0,0,0,.12);
  user-select:none;cursor:default}
.dsh-canvas-design-props .prop{display:flex;align-items:center;gap:4px;font:11px/16px var(--dsh-font);color:var(--dsh-fg-3)}
.dsh-canvas-design-props .prop-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:11px/16px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-design-props input[type=color]{width:22px;height:22px;padding:0;border:1px solid var(--dsh-hairline);
  border-radius:4px;background:none;cursor:pointer}
.dsh-canvas-design-props input[type=number],.dsh-canvas-design-props input[type=text]{width:56px;
  border:1px solid var(--dsh-hairline);border-radius:4px;padding:2px 5px;background:var(--dsh-soft);
  color:var(--dsh-fg);font:11px/16px var(--dsh-font);outline:none}
.dsh-canvas-design-props input[type=text]{width:130px}
.dsh-canvas-design-props button{border:none;background:transparent;color:var(--dsh-fg-2);cursor:pointer;
  font:11px/16px var(--dsh-font);padding:3px 6px;border-radius:6px}
.dsh-canvas-design-props button:hover{background:var(--dsh-soft);color:var(--dsh-sunset)}
/* 设计预览的模式开关复用 markdown 的 .dsh-canvas-modeswitch（同一副开关）。 */
/* 编辑态侧栏：左右通栏，高度与画布对齐（top/bottom 都到边）。左栏上下两段——
   页面（固定份额、自身滚动）+ 图层树（吃掉剩余高度）；右栏属性一整列。
   面板之间用发丝线分段，不再是浮岛卡片。

   侧栏是**定宽列**：内容按这条宽度排版、越界一律裁掉，横向永不出现滚动条。
   overscroll-behavior 挡住「滚到头还往下传」——面板滚到底再滚一下，不该把底下
   的 viewer-body 带着滚（那是另一根滚动条）。 */
.dsh-canvas-design-side{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;
  width:180px;box-sizing:border-box;overflow:hidden;overscroll-behavior:contain;
  pointer-events:auto;z-index:1;cursor:default;background:var(--dsh-card)}
.dsh-canvas-design-side-left{left:0;border-right:1px solid var(--dsh-hairline)}
/* 右栏宽度**由 React 写在行内 style 上**（设计页 200px / AI 页 300px，见 design-panels.tsx）：
   判据是标签页，而标签页的状态就在那一层——宽度跟着状态走，不隔着一条选择器。这里只留那
   180ms 的伸缩：换标签是**同一个面板**变宽，跳一下就成了另一块东西。 */
.dsh-canvas-design-side-right{right:0;border-left:1px solid var(--dsh-hairline);
  transition:width .18s ease}
/* 改稿在跑（一笔交给会话去改的图层还没落地）：面板只看着。整列不接指针——列表点不动、
   字段改不了，连滚都不用想（这是锁，不是「禁用几个按钮」）。视觉上只把内容压淡一档，
   面板自己那句「改稿进行中」仍是可读的。 */
.dsh-canvas-design-side.is-locked{pointer-events:none}
.dsh-canvas-design-side.is-locked .dsh-canvas-design-panel-list,
.dsh-canvas-design-side.is-locked .dsh-canvas-design-form,
.dsh-canvas-design-side.is-locked .dsh-canvas-design-ai-box{opacity:.5}
/* 改稿圈：一笔在跑的改稿圈住的那批图层，每层一枚方块。位置由 viewer 的 draw 按当前视口
   直写（镜头动它跟着动，不付 React 渲染），方块自己 overflow:hidden——光带扫的是**被改
   的那一块**，不溢到别处。圈与元素选择那一圈同一副视觉语言：光在动 = 正在产出。 */
.dsh-canvas-design-hold{position:absolute;inset:0;pointer-events:none}
.dsh-canvas-design-hold-box{position:absolute;box-sizing:border-box;overflow:hidden;border-radius:2px;
  border:1px solid var(--dsh-breeze);box-shadow:0 0 0 3px var(--dsh-sheen)}
/* 选中框（编辑态单选中）：八枚缩放手柄 + 顶边正中一枚旋转手柄。
   框体**不吃指针**——它正好盖住节点本身，吃了就把点选与拖移一起挡在门外；只有手柄吃。
   几何（left/top/宽高/旋转角）由 viewer 的 paintFrame 每帧直写，所以这里不写任何尺寸。
   不设 z-index：靠 DOM 次序落在画布之上、左右面板之下（节点滑到面板底下时该被面板盖住）。 */
.dsh-canvas-design-frame{position:absolute;box-sizing:border-box;pointer-events:none;
  border:1px solid var(--dsh-breeze);will-change:left,top,width,height,transform}
.dsh-canvas-design-handle{position:absolute;width:8px;height:8px;box-sizing:border-box;border-radius:1px;
  border:1px solid var(--dsh-breeze);background:var(--dsh-card);pointer-events:auto}
.dsh-canvas-design-handle.is-nw{left:-4px;top:-4px;cursor:nwse-resize}
.dsh-canvas-design-handle.is-n{left:calc(50% - 4px);top:-4px;cursor:ns-resize}
.dsh-canvas-design-handle.is-ne{right:-4px;top:-4px;cursor:nesw-resize}
.dsh-canvas-design-handle.is-e{right:-4px;top:calc(50% - 4px);cursor:ew-resize}
.dsh-canvas-design-handle.is-se{right:-4px;bottom:-4px;cursor:nwse-resize}
.dsh-canvas-design-handle.is-s{left:calc(50% - 4px);bottom:-4px;cursor:ns-resize}
.dsh-canvas-design-handle.is-sw{left:-4px;bottom:-4px;cursor:nesw-resize}
.dsh-canvas-design-handle.is-w{left:-4px;top:calc(50% - 4px);cursor:ew-resize}
/* 旋转柄浮在顶边之上，用一枚连杆交代它跟谁连着——不连杆会像是悬在别处的一颗点。 */
.dsh-canvas-design-rotate-arm{position:absolute;left:50%;top:-24px;width:1px;height:24px;
  background:var(--dsh-breeze);pointer-events:none}
.dsh-canvas-design-rotate{position:absolute;left:calc(50% - 5px);top:-30px;width:10px;height:10px;
  box-sizing:border-box;border-radius:50%;border:1px solid var(--dsh-breeze);background:var(--dsh-card);
  pointer-events:auto;cursor:${ROTATE_CURSOR}}
/* 容器名称签（Figma 的 frame label）：每份容器一枚，浮在左上角之外。
   容器不吃指针；名称本身可单击改名。位置由 viewer 的 paintLabels 每帧直写
   （世界左上角 → 屏幕坐标），名字在屏幕像素里**不随缩放变大**——Figma 也这样。
   不设 z-index：与选中框同一条理由——靠 DOM 次序落在画布之上、左右面板之下。 */
.dsh-canvas-design-labels{position:absolute;inset:0;pointer-events:none;user-select:none}
.dsh-canvas-design-labels.is-locked{opacity:.5}
.dsh-canvas-design-labels.is-locked .dsh-canvas-design-label-name{pointer-events:none}
.dsh-canvas-design-label{position:absolute;display:flex;flex-direction:column;align-items:flex-start;
  transform:translateY(-100%);padding-bottom:5px}
.dsh-canvas-design-label-name{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;
  max-width:220px;padding:0 5px;border:1px solid transparent;border-radius:4px;background:transparent;
  color:var(--dsh-fg-3);font:12px/16px var(--dsh-font);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  pointer-events:auto;cursor:text}
.dsh-canvas-design-label-name svg{flex:none}
.dsh-canvas-design-label-name:hover{border-color:var(--dsh-hairline);color:var(--dsh-fg-2)}
.dsh-canvas-design-label.is-active .dsh-canvas-design-label-name{color:var(--dsh-breeze);border-color:var(--dsh-breeze)}
.dsh-canvas-design-label-input{box-sizing:border-box;height:18px;padding:0 4px;border:1px solid var(--dsh-breeze);
  border-radius:4px;background:var(--dsh-card);color:var(--dsh-fg);font:12px/16px var(--dsh-font);
  outline:none;pointer-events:auto}
/* 右栏只有属性一段：吃满整列高度（表单自身滚动）。 */
.dsh-canvas-design-side-right>.dsh-canvas-design-panel{flex:1 1 auto}
/* 左栏上段（页面）：限高防吞掉图层树；下段（图层）panel-grow 吃剩余，两段发丝线分段。 */
.dsh-canvas-design-side-left>.dsh-canvas-design-panel:not(.dsh-canvas-design-panel-grow){flex:0 1 auto;max-height:40%}
.dsh-canvas-design-side-left>.dsh-canvas-design-panel-grow{border-top:1px solid var(--dsh-hairline)}
/* 左栏通栏后 HUD（缩放控制器）让出侧栏宽度。 */
.dsh-canvas-design.is-editing .dsh-canvas-design-hud{left:calc(180px + 12px)}
.dsh-canvas-design-panel{display:flex;flex-direction:column;min-height:0;
  border:none;overflow:hidden;user-select:none}
.dsh-canvas-design-panel-grow{flex:1 1 auto}
.dsh-canvas-design-panel-head{flex:none;display:flex;align-items:center;justify-content:space-between;
  padding:6px 10px;border-bottom:1px solid var(--dsh-hairline);font:11px/16px var(--dsh-font);
  color:var(--dsh-fg-3)}
.dsh-canvas-design-panel-head button{border:none;background:transparent;color:var(--dsh-fg-2);cursor:pointer;
  font:12px/16px var(--dsh-font);padding:0 4px;border-radius:4px}
.dsh-canvas-design-panel-head button:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
/* 两个列表都**只纵向滚**：只写 overflow-y 时另一轴会被算成 auto（「一边非 visible，
   另一边 visible 就上升为 auto」），于是内容一旦撑宽就冒出横向滚动条。这里显式写死
   hidden——面板定宽，横向本就没有可滚之物；真撑宽是下面那些盒子的毛病，得去改它们。 */
.dsh-canvas-design-panel-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;
  overscroll-behavior:contain;margin:0;padding:4px;list-style:none}
.dsh-canvas-design-panel-list ul{margin:0;padding:0;list-style:none}
.dsh-canvas-design-panel-empty{margin:0;padding:10px;font:11px/17px var(--dsh-font);color:var(--dsh-fg-3)}
.dsh-canvas-design-panel-list li>div{display:flex;align-items:center;gap:4px;box-sizing:border-box;
  width:100%;height:24px;padding-right:4px;border-radius:5px;cursor:pointer}
.dsh-canvas-design-panel-list li>div:hover{background:var(--dsh-soft)}
.dsh-canvas-design-panel-list li>div.is-active{background:var(--dsh-breeze)}
.dsh-canvas-design-panel-list li>div.is-active .dsh-canvas-design-row-name,
.dsh-canvas-design-panel-list li>div.is-active .dsh-canvas-design-glyph,
.dsh-canvas-design-panel-list li>div.is-active .dsh-canvas-design-caret{color:var(--dsh-on-accent)}
.dsh-canvas-design-layer.is-hidden .dsh-canvas-design-row-name,
.dsh-canvas-design-layer.is-hidden .dsh-canvas-design-glyph{opacity:.4}
.dsh-canvas-design-caret{flex:none;width:12px;text-align:center;border:none;background:transparent;
  color:var(--dsh-fg-3);font:9px/16px var(--dsh-font);padding:0;cursor:pointer}
.dsh-canvas-design-glyph{flex:none;width:14px;text-align:center;color:var(--dsh-fg-3);font:10px/16px var(--dsh-font)}
.dsh-canvas-design-glyph svg{display:block;margin:0 auto}
.dsh-canvas-design-row-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:11px/18px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-design-row-name input[type=text]{box-sizing:border-box;width:100%;min-width:0;
  border:1px solid var(--dsh-hairline);
  border-radius:3px;padding:0 4px;background:var(--dsh-soft);color:var(--dsh-fg);font:11px/18px var(--dsh-font);outline:none}
/* 行尾两枚开关（锁定 / 显隐）：图标是 14px 线性 SVG，按钮用自己的盒子对齐图标，
   不吃字体的行高——不然一行里两套「字形」的基线对不上。 */
.dsh-canvas-design-row-act{flex:none;display:inline-flex;align-items:center;justify-content:center;height:16px;
  border:none;background:transparent;color:var(--dsh-fg-3);cursor:pointer;
  font:10px/16px var(--dsh-font);padding:0 2px;border-radius:4px;opacity:0}
.dsh-canvas-design-row-act svg{display:block}
/* 悬停提示（行内小图标）：气泡**摊在行内**——默认落在元素下方，贴到列表下沿时翻到上方
   （翻转由 is-up 决定，见 panels 的 placeTip）。横向仍留在面板的裁切边内（侧栏与列表都是
   overflow:hidden/auto），因此不必 portal 也不会被裁掉一半。文字走 data-tip，开合只切
   opacity；气泡是按钮/图标的子元素，所以按钮那点 opacity:0（未悬停时藏着）也一起管住它。 */
.dsh-canvas-design-tip{position:relative}
.dsh-canvas-design-tip::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:0;z-index:1;
  padding:1px 6px;border-radius:4px;
  background:var(--dsh-fg);color:var(--dsh-card);font:11px/16px var(--dsh-font);
  white-space:nowrap;pointer-events:none;opacity:0}
/* 行尾两枚开关贴着面板右沿：气泡改从元素右沿向左展开，别顶出面板。 */
.dsh-canvas-design-tip:not(.is-right)::after{left:auto;right:0}
.dsh-canvas-design-tip.is-up::after{top:auto;bottom:calc(100% + 6px)}
.dsh-canvas-design-tip:hover::after{opacity:1}
.dsh-canvas-design-panel-list li>div:hover .dsh-canvas-design-row-act{opacity:1}
/* 隐藏图层的眼睛常显——不然盖了眼睛的行看起来像凭空消失。 */
.dsh-canvas-design-layer.is-hidden .dsh-canvas-design-row-act[data-tip='显示']{opacity:1}
.dsh-canvas-design-row-act:hover{color:var(--dsh-fg)}
/* 页面行那三枚动作（复制/重命名/删除）：当前页常显——页面这一栏的操作本来就只有这三件，
   全藏进悬停里等于没有；确认态那一行也常显，「删除 / 取消」两枚若是藏着，这一问就没法回答。 */
.dsh-canvas-design-panel-list li>div.dsh-canvas-design-page.is-active .dsh-canvas-design-row-act,
.dsh-canvas-design-panel-list li>div.dsh-canvas-design-page.is-confirming .dsh-canvas-design-row-act{opacity:1}
/* 删除那一枚悬停转红：一行里没有别的地方在说这一步不可逆。 */
.dsh-canvas-design-row-act.is-danger:hover{color:var(--dsh-sunset)}
/* 确认删除的那一行染一层警示色（盖在 hover/active 之上：它是这一刻唯一要回答的事）。 */
.dsh-canvas-design-panel-list li>div.dsh-canvas-design-page.is-confirming{
  background:color-mix(in srgb, var(--dsh-sunset) 14%, transparent)}
/* 确认那一格的两枚按钮是**字**不是图标：按字排（11px、给点内边距），不必挤成 16px 的方框。 */
.dsh-canvas-design-page-act{flex:none;border:none;background:transparent;cursor:pointer;
  color:var(--dsh-fg-2);font:11px/16px var(--dsh-font);padding:1px 5px;border-radius:4px}
.dsh-canvas-design-page-act:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-design-page-act.is-danger{color:var(--dsh-sunset)}
/* 属性面板表单：两列几何、整行外观，字段壳沿用属性条一族。
   宽度全是**定宽派生**：列宽来自侧栏、字段吃满一行、输入框吃满剩余——谁也不靠
   自己的固有宽度说话。input[type=number] 的固有宽约 125px，一进 1fr 轨道就
   把它顶出去（实测 scrollWidth 362 vs clientWidth 200），所以轨道写 minmax(0,1fr)
   拆掉自动最小尺寸、输入框 width:100% + border-box 由父级宽度定死。 */
/* 分块之间留出**一眼能分块**的空当：块内紧、块间松（Figma 的属性栏也是靠空白分块，
   不靠分隔线）。 */
.dsh-canvas-design-form{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px;box-sizing:border-box;width:100%;
  padding:12px 10px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
.dsh-canvas-design-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px}
.dsh-canvas-design-field{display:flex;align-items:center;gap:6px;min-width:0;box-sizing:border-box;
  font:11px/16px var(--dsh-font);color:var(--dsh-fg-3)}
.dsh-canvas-design-field>span{flex:none;width:36px;white-space:nowrap}
/* 几何四格是单字标签（X/Y/W/H），犯不上占 32px——省下的全归输入框。 */
.dsh-canvas-design-grid2 .dsh-canvas-design-field>span{width:14px}
.dsh-canvas-design-field input[type=number],.dsh-canvas-design-field input[type=text]{flex:1 1 auto;
  min-width:0;width:100%;box-sizing:border-box;
  border:1px solid var(--dsh-hairline);border-radius:4px;padding:2px 5px;background:var(--dsh-soft);
  color:var(--dsh-fg);font:11px/16px var(--dsh-font);outline:none}
.dsh-canvas-design-field input[type=color]{flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;
  height:22px;padding:0;border:1px solid var(--dsh-hairline);
  border-radius:4px;background:none;cursor:pointer}
.dsh-canvas-design-danger{border:1px solid var(--dsh-hairline);background:transparent;color:var(--dsh-sunset);
  cursor:pointer;font:11px/16px var(--dsh-font);padding:4px 8px;border-radius:6px}
.dsh-canvas-design-danger:hover{background:var(--dsh-soft)}
/* 属性面板标签栏（设计/AI）：面板头部换成两个平铺标签，底线高亮当前页。
   下划线用 border-bottom 压在容器发丝线上（margin-bottom:-1px 盖住它）。 */
.dsh-canvas-design-tabs{flex:none;display:flex;gap:2px;padding:6px 8px 0;
  border-bottom:1px solid var(--dsh-hairline);user-select:none}
.dsh-canvas-design-tab{flex:1 1 0;border:none;background:transparent;color:var(--dsh-fg-3);cursor:pointer;
  font:11px/16px var(--dsh-font);padding:4px 0 6px;border-radius:4px 4px 0 0;
  border-bottom:2px solid transparent;margin-bottom:-1px}
.dsh-canvas-design-tab:hover{color:var(--dsh-fg-2)}
.dsh-canvas-design-tab.is-active{color:var(--dsh-fg);border-bottom-color:var(--dsh-breeze)}
/* 模块小节：**加粗标题** + 内容；标题行右侧挂「＋添加」。标题比正文字号大一号、颜色提一档，
   块与块的间隔由 .dsh-canvas-design-form 的 gap 给。 */
.dsh-canvas-design-module{display:flex;flex-direction:column;gap:8px}
.dsh-canvas-design-module-head{display:flex;align-items:center;justify-content:space-between;
  font:600 12px/18px var(--dsh-font);color:var(--dsh-fg-2);letter-spacing:.01em}
.dsh-canvas-design-module-head button{border:none;background:transparent;color:var(--dsh-fg-2);cursor:pointer;
  font:11px/14px var(--dsh-font);padding:0 4px;border-radius:4px}
.dsh-canvas-design-module-head button:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-design-module-empty{font:11px/16px var(--dsh-font);color:var(--dsh-fg-3);opacity:.7}
/* 动态数组的一格（边框/效果）：发丝线小盒子里排两列字段。 */
.dsh-canvas-design-item{display:flex;flex-direction:column;gap:6px;padding:6px;
  border:1px solid var(--dsh-hairline);border-radius:6px;box-sizing:border-box}
.dsh-canvas-design-item-row{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-canvas-design-item-row input[type=color]{flex:none;width:34px;height:22px;padding:0;
  border:1px solid var(--dsh-hairline);border-radius:4px;background:none;cursor:pointer}
.dsh-canvas-design-item-row .dsh-canvas-design-field{flex:1 1 auto}
.dsh-canvas-design-item-remove{flex:none;width:18px;height:18px;border:none;background:transparent;
  color:var(--dsh-fg-3);cursor:pointer;font:12px/18px var(--dsh-font);border-radius:4px;align-self:center}
.dsh-canvas-design-item-remove:hover{background:var(--dsh-soft);color:var(--dsh-sunset)}
/* 下拉与勾选：跟数字/文本输入同一族壳。裸 select（模块级）与条目内 select 都要盖到。 */
.dsh-canvas-design-form select,.dsh-canvas-design-item select{flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;
  border:1px solid var(--dsh-hairline);border-radius:4px;padding:2px 3px;background:var(--dsh-soft);
  color:var(--dsh-fg);font:11px/16px var(--dsh-font);outline:none;cursor:pointer}
.dsh-canvas-design-check{display:flex;align-items:center;justify-content:space-between;gap:6px;
  font:11px/16px var(--dsh-font);color:var(--dsh-fg-3);cursor:pointer}
.dsh-canvas-design-check input[type=checkbox]{margin:0;accent-color:var(--dsh-breeze);cursor:pointer}
/* AI 标签页：一个提示词框（内联的选中图层 + 用户写的要求）+ 底部一行（模型席位、发送）。
   框与正文分两层，与元素选择那个提示词框同一副做法：框负责边距与底色，正文那层吃内边距。
   内联标签画在正文里（引用标签那一枚，与画布输入框、元素选择共用），所以「当前选中的
   图层」不是框外的一句提示，而是**值里那一段的另一种画法**。 */
.dsh-canvas-design-ai{flex:1 1 auto;min-height:0;width:100%;display:flex;flex-direction:column;gap:8px;
  box-sizing:border-box;padding:10px;overflow-y:auto;overscroll-behavior:contain}
/* 框与正文都吃满可用宽高：宽度写死 100%（面板是定宽列，这一层不该有自己的固有宽度），
   高度靠 flex:1 从 AI 页身上领——里面那个 contenteditable 自己再 flex:1 吃掉剩余。 */
.dsh-canvas-design-ai-box{flex:1 1 auto;width:100%;min-height:120px;display:flex;flex-direction:column;
  box-sizing:border-box;overflow:hidden;border:1px solid var(--dsh-hairline);border-radius:6px;
  background:var(--dsh-soft)}
.dsh-canvas-design-ai-box:focus-within{border-color:var(--dsh-breeze)}
.dsh-canvas-design-ai-input{flex:1 1 auto;min-height:0;box-sizing:border-box;width:100%;
  border:none;background:transparent;color:var(--dsh-fg);font:12px/18px var(--dsh-font);
  -webkit-user-select:text;user-select:text}
.dsh-canvas-design-ai-input .dsh-canvas-promptbox-field,
.dsh-canvas-design-ai-input .dsh-canvas-promptbox-placeholder{padding:8px 10px}
.dsh-canvas-design-ai-foot{flex:none;display:flex;align-items:center;gap:8px}
/* 席位在底栏最左，菜单因此也向上开在那一角（模型菜单的 bottom 由这里定，它在控制带里是
   26px——那是行高更高的一栏）。 */
.dsh-canvas-design-ai-foot .dsh-canvas-modelmenu{bottom:24px}
.dsh-canvas-design-ai-notice{margin:0;font:11px/16px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-design-ai-error{margin:0;font:11px/16px var(--dsh-font);color:var(--dsh-sunset)}
/* 帧区：帧与「浮在它上面」的提示条共用的一块定位上下文。它接过 viewer-body 里那份
   剩余高度（flex:1），帧照旧铺满它。 */
.dsh-canvas-frame-area{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dsh-canvas-frame{flex:1 1 auto;width:100%;height:100%;border:none;background:#fff}
/* 预览里的链接闸门拦下一条站内链接时，那句话挂在这里（iframe 之上、头顶工具条之下）。
   用 breeze 而不是 sunset：页面本身没错，只是这份地址在内联快照里无从解析。 */
.dsh-canvas-frame-note{flex:none;display:flex;align-items:center;gap:8px;padding:8px 16px;
  border-bottom:1px solid var(--dsh-hairline);background:var(--dsh-slot);
  font:12px/18px var(--dsh-font);color:var(--dsh-breeze)}
.dsh-canvas-frame-notetext{flex:1 1 auto;min-width:0}
.dsh-canvas-pre{flex:none;margin:0;padding:16px 20px;font:12px/19px var(--dsh-mono);color:var(--dsh-fg-2);
  white-space:pre-wrap;word-break:break-word}
.dsh-canvas-tablewrap{flex:1 1 auto;min-height:0;padding:12px 16px;overflow:auto}
.dsh-canvas-table{border-collapse:collapse;font:12px/18px var(--dsh-mono);color:var(--dsh-fg-2)}
.dsh-canvas-table th,.dsh-canvas-table td{border:1px solid var(--dsh-hairline);padding:5px 10px;text-align:left;
  max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-table th{position:sticky;top:0;background:var(--dsh-soft);color:var(--dsh-fg);font-weight:500}

/* Markdown 渲染（markdown 形态的全屏视图）。标记由 renderMarkdown 生成——
   先整体转义再拼标签——所以这里的排版类不会遇到外来属性。 */
.dsh-canvas-md{flex:none;padding:20px 28px 28px;max-width:820px;font:14px/24px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-md>*:first-child{margin-top:0}
.dsh-canvas-md h1,.dsh-canvas-md h2,.dsh-canvas-md h3,.dsh-canvas-md h4{margin:26px 0 10px;color:var(--dsh-fg);
  font-weight:600;line-height:1.35}
.dsh-canvas-md h1{font-size:22px}.dsh-canvas-md h2{font-size:18px}
.dsh-canvas-md h3{font-size:15px}.dsh-canvas-md h4{font-size:14px}
.dsh-canvas-md p{margin:10px 0}
.dsh-canvas-md ul,.dsh-canvas-md ol{margin:10px 0;padding-left:22px}
.dsh-canvas-md li{margin:4px 0}
.dsh-canvas-md a{color:var(--dsh-breeze);text-decoration:none}
.dsh-canvas-md a:hover{text-decoration:underline}
.dsh-canvas-md blockquote{margin:12px 0;padding:2px 14px;border-left:3px solid var(--dsh-mid);color:var(--dsh-fg-3)}
.dsh-canvas-md hr{margin:20px 0;border:none;border-top:1px solid var(--dsh-hairline)}
.dsh-canvas-md pre{margin:12px 0;padding:12px 14px;border-radius:8px;background:var(--dsh-slot);
  border:1px solid var(--dsh-hairline);overflow:auto}
.dsh-canvas-md pre code{font:12px/19px var(--dsh-mono);color:var(--dsh-fg-2);background:none;padding:0}
.dsh-canvas-md code{font:12px/19px var(--dsh-mono);background:var(--dsh-soft);border-radius:4px;padding:1px 5px;color:var(--dsh-fg)}

/* ── floating chrome ────────────────────────────────────────────────────── */
.dsh-canvas-toolbar{position:absolute;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-toolbar.is-horizontal{flex-direction:row}
.dsh-canvas-chipbtn{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 12px;border:none;border-radius:999px;
  background:transparent;color:var(--dsh-fg-2);font:500 12px/16px var(--dsh-font);cursor:pointer;white-space:nowrap}
.dsh-canvas-chipbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-chipbtn[data-primary=true]{background:var(--dsh-sunset-solid);color:var(--dsh-on-sunset)}
.dsh-canvas-chipbtn[data-primary=true]:hover{filter:brightness(1.08);background:var(--dsh-sunset-solid)}
.dsh-canvas-chipbtn[disabled]{opacity:.45;cursor:default}
.dsh-canvas-chipbtn svg{display:block}
/* 胶囊上那枚〔导出〕的锚：要挑格式的形态（文本节点 md/txt/docx/pdf、设计稿 fig/png/pdf/pptx）
   都把菜单从这颗钮下面垂下来。
   锚是 inline-flex 的一层 span——胶囊那一排是 flex 的行，菜单不能参与它的排版，只能在
   锚里绝对定位。宽度按内容撑（.dsh-canvas-menu 自己那 150px 下限够用），左缘与钮对齐。 */
.dsh-canvas-pillmenu{position:relative;display:inline-flex;align-items:center}
.dsh-canvas-pillmenu>.dsh-canvas-menu{position:absolute;left:0;top:30px;z-index:7}
/* 〔导入〕那颗钮背后的原生文件选择框（F2.7，v1.81）：只用来接一次点击，不能占位。
   用 display:none 而不是 hidden 属性——后者的「不显示」是 UA 样式里的 display:none，
   宿主那套 [hidden]{display:block} 一类的重置会把它顶回来，于是胶囊里会多出一个原生
   「选择文件」控件。它也不吃指针：点击永远从胶囊那枚钮发起。 */
.dsh-canvas-fileinput{display:none}
.dsh-canvas-zoombar{position:absolute;left:12px;bottom:12px;display:flex;flex-direction:row;align-items:center;gap:2px;padding:4px;border-radius:999px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-iconbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;
  background:transparent;color:var(--dsh-fg-2);cursor:pointer}
.dsh-canvas-iconbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-zoomlevel{font:500 10px/28px var(--dsh-mono);color:var(--dsh-fg-3);text-align:center;letter-spacing:.6px;min-width:34px}
.dsh-canvas-minimap{position:absolute;right:12px;bottom:12px;width:132px;height:84px;box-sizing:border-box;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-slot);overflow:hidden}
.dsh-canvas-minimap-card{position:absolute;width:10px;height:7px;border-radius:1px;background:var(--dsh-mid)}
.dsh-canvas-minimap-card.is-selected{background:var(--dsh-sunset-solid)}

/* ── bottom dock ────────────────────────────────────────────────────────── */
/* 底部中央的 dock：左「新增」、右「快捷键」，都向上弹层。挂在空态之上
   （DOM 顺序在空态之后），所以空画布上也能点到。 */
.dsh-canvas-dockzone{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:5}
/* 宽度靠 padding 撑开，不要写 width:N%。dockzone 是绝对定位且自身没有宽度
   （shrink-to-fit），dock 的百分比会解析到它身上，与内容互相依赖成循环；
   浏览器按 auto 破环后胶囊只有十几像素，加号的 hover 圆就会溢出胶囊，
   而且菜单开合会带着胶囊宽度一起抖。左右各留 14px，圆钮 hover 时有余量。 */
.dsh-canvas-dock{display:flex;align-items:center;justify-content:center;box-sizing:border-box;height:36px;
  gap:4px;padding:0 14px;border-radius:999px;border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-dockbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;
  background:transparent;color:var(--dsh-fg-2);cursor:pointer}
.dsh-canvas-dockbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
/* 新增是 dock 里的主按钮：实心圆 + 画布的强调色（与卡片上那枚 primary 胶囊同源），
   落在一排幽灵钮的最左。写成两个类是为了让底色/尺寸的覆盖稳稳压过 .dsh-canvas-dockbtn
   的幽灵底与 hover（同权重就靠书写顺序，太脆）。 */
.dsh-canvas-dockbtn.dsh-canvas-dockadd{width:26px;height:26px;background:var(--dsh-sunset-solid);color:var(--dsh-on-sunset)}
.dsh-canvas-dockbtn.dsh-canvas-dockadd:hover{background:var(--dsh-sunset-solid);color:var(--dsh-on-sunset);filter:brightness(1.08)}
.dsh-canvas-dockbtn.dsh-canvas-dockadd:active{filter:brightness(.94)}
.dsh-canvas-menu{display:flex;flex-direction:column;min-width:150px;padding:4px;border-radius:12px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-menu .dsh-canvas-row svg{flex:none;color:var(--dsh-fg-3)}
/* 快捷键说明弹层：左列键帽、右列动作，一 key 一行。键帽按等宽字排（键位上本来就是
   等宽的手感），宽度用 min-width 兜住单字符；键帽列再钉一个 86px 的下限——一 key
   一行之后行数变多，右列若还各自起头就看不出是一张表了（英文的长键名如
   Double-click 比 86 宽时会自己长出去，宁可那一行不齐也不截字）。 */
.dsh-canvas-keys{min-width:268px;max-width:320px;padding:8px 10px;gap:4px}
.dsh-canvas-keys-title{padding:0 0 3px;font:500 10px/14px var(--dsh-mono);letter-spacing:1.2px;
  text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-keys-row{display:flex;align-items:center;gap:8px}
.dsh-canvas-keys-caps{display:flex;align-items:center;gap:3px;flex:none;min-width:86px}
.dsh-canvas-keys-caps kbd{min-width:16px;padding:1px 5px;border:1px solid var(--dsh-hairline);border-radius:4px;
  background:var(--dsh-soft);color:var(--dsh-fg);font:11px/15px var(--dsh-mono);text-align:center;white-space:nowrap}
.dsh-canvas-keys-label{flex:1 1 auto;font:12px/17px var(--dsh-font);color:var(--dsh-fg-2)}

/* ── empty / 提示条 ─────────────────────────────────────────────────────── */
.dsh-canvas-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;color:var(--dsh-fg-3)}
.dsh-canvas-empty-title{font:500 13px/20px var(--dsh-font);color:var(--dsh-fg-2)}
/* 一档一口气。这一层只声明**家族色**（就是这条规则自己的 --dsh-notice），底、描边、字由下面
   那条共用规则算出来——于是「加一档」只加一行，也不会出现「底换了字忘了换」那类半截改。
   家族色一律取画布调色板里的**文字色**那一档（sunset 是文字色、sunset-solid 才是实心底）：
   亮色下底取淡调、字取原色，两边都读得出来；拿实心底那档当字色，亮色下就是黄字压黄底。
   它不是主题令牌，是这一条自己的底色族，所以不进调色板、也不该被别处引用。 */
/* 中性那一档（info，也是没挂 data-tone 时的默认长相）：只是告诉你一件事，不抢任何东西。 */
.dsh-canvas-notice,.dsh-canvas-notice[data-tone="info"]{--dsh-notice:var(--dsh-fg-3)}
.dsh-canvas-notice[data-tone="ok"]{--dsh-notice:var(--dsh-breeze)}
.dsh-canvas-notice[data-tone="warn"]{--dsh-notice:var(--dsh-sunset)}
/* 错误条只有一档（错就是错），所以它直接就是家族色的持有者，不用挂 data-tone。 */
.dsh-canvas-notice[data-tone="error"],.dsh-canvas-error{--dsh-notice:var(--dsh-twilight)}
/* 画布左上角那一条：一句话 + 一枚关闭。错误条与回执条共用这副骨架，也共用上面那几档口气
   ——**颜色说口气，字说事情**，两者一起给出去，用户不必读完一行字才知道刚才成了没有。
   两条不会同时出现（每次动作都先清空回执），所以叠在同一位置是安全的。
   底与描边一律 color-mix 在画布调色板上算：两套主题各算各的，不必为一口再开令牌。 */
.dsh-canvas-error,.dsh-canvas-notice{position:absolute;left:12px;right:12px;top:12px;
  display:flex;align-items:flex-start;gap:8px;padding:8px 8px 8px 12px;border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dsh-notice) 42%, transparent);
  background:color-mix(in srgb, var(--dsh-notice) 14%, var(--dsh-card));
  color:var(--dsh-notice);font:12px/18px var(--dsh-mono)}
/* 一句话占满剩下的宽度；长错误（mono 的一整行路径）照折行，不把关闭顶出去。 */
.dsh-canvas-strip-text{flex:1 1 auto;min-width:0;word-break:break-word}
/* 一枚 × ：底透明、颜色继承这一档，所以三条口气下它自己就换了色（不必另写三份）。 */
.dsh-canvas-strip-close{flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  box-sizing:border-box;width:18px;height:18px;padding:0;border:none;border-radius:5px;
  background:transparent;color:inherit;font:500 14px/1 var(--dsh-font);cursor:pointer;opacity:.7}
.dsh-canvas-strip-close:hover{background:color-mix(in srgb, var(--dsh-notice) 20%, transparent);opacity:1}

/* ── folder picker ──────────────────────────────────────────────────────── */
.dsh-canvas-scrim{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:5}
.dsh-canvas-dialog{width:min(520px,100%);max-height:100%;display:flex;flex-direction:column;border:1px solid var(--dsh-hairline);
  border-radius:8px;background:var(--dsh-card);overflow:hidden}
.dsh-canvas-dialog-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsh-hairline);
  font:500 12px/18px var(--dsh-font);color:var(--dsh-fg)}
.dsh-canvas-dialog-path{padding:8px 14px;border-bottom:1px solid var(--dsh-hairline);font:10px/16px var(--dsh-mono);
  letter-spacing:.6px;color:var(--dsh-fg-3);word-break:break-all}
.dsh-canvas-dialog-list{flex:1 1 auto;overflow:auto;padding:6px}
.dsh-canvas-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 10px;border:none;border-radius:8px;
  background:transparent;color:var(--dsh-fg-2);font:12px/18px var(--dsh-font);text-align:left;cursor:pointer}
.dsh-canvas-row:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-row-meta{margin-left:auto;font:10px/14px var(--dsh-mono);color:var(--dsh-fg-3)}
.dsh-canvas-dialog-body{padding:12px 14px;font:12px/19px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-dialog-error{padding:8px 14px;border-top:1px solid var(--dsh-hairline);font:11px/16px var(--dsh-mono);
  color:var(--dsh-twilight);word-break:break-all}
/* 删除画布的确认框从**侧栏**长出来，要盖住的是整个视口（不是某一块画布），所以这一档
   遮罩改成 fixed。 */
.dsh-canvas-scrim.is-floating{position:fixed;z-index:61;pointer-events:auto}
.dsh-canvas-dialog-foot{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid var(--dsh-hairline)}
.dsh-canvas-input{flex:1 1 auto;height:28px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsh-hairline);border-radius:999px;
  background:var(--dsh-slot);color:var(--dsh-fg);font:12px/18px var(--dsh-font)}
.dsh-canvas-input:focus{outline:none;border-color:var(--dsh-mid)}

/* ── main column seat ───────────────────────────────────────────────────── */
/* 主区域的画布席位。宿主的主栏不自带定位祖先，而画布本体是 position:absolute
   铺满父容器的，所以这一层既要撑满主栏，也要做那个参照。 */
.dsh-canvas-seat{position:relative;display:flex;flex-direction:column;flex:1 1 auto;height:100%;min-width:0;min-height:0;overflow:hidden}

/* ── card panel (conversation view ring) ────────────────────────────────── */
.dsh-canvas-panel{display:flex;flex-direction:column;gap:16px;padding:20px;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsh-fg);
  background:var(--surface-primary,var(--dsh-surface));font:13px/20px var(--dsh-font)}
.dsh-canvas-panel-head{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-canvas-panel-title{font:500 14px/20px var(--dsh-font);color:var(--dsh-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-eyebrow{font:500 9px/14px var(--dsh-mono);letter-spacing:1.4px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-fields{display:flex;flex-direction:column;gap:6px}
.dsh-canvas-field{display:flex;gap:10px;min-width:0}
.dsh-canvas-field-key{flex:none;width:64px;font:9px/18px var(--dsh-mono);letter-spacing:1.2px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-field-value{flex:1 1 auto;min-width:0;font:12px/18px var(--dsh-mono);color:var(--dsh-fg-2);word-break:break-all}
.dsh-canvas-block{border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-card);padding:10px 12px}
.dsh-canvas-block .dsh-canvas-eyebrow{margin-bottom:8px;display:block}
.dsh-canvas-chain{display:flex;flex-direction:column;gap:6px}
.dsh-canvas-chain-row{display:flex;align-items:center;gap:8px;min-width:0;font:12px/18px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-chain-arrow{color:var(--dsh-breeze);font:12px/18px var(--dsh-mono)}
.dsh-canvas-muted{color:var(--dsh-fg-3)}
.dsh-canvas-panel-actions{display:flex;flex-wrap:wrap;gap:6px}

/* ── motion ─────────────────────────────────────────────────────────────── */
/* 动作只有一套语义：光在动 = 正在生成。流光一趟 1.8s、匀速不停顿——光带自左
   （-120%，此时只有 gradient 透明的尾巴在卡内）扫到右（+120%），亮点正好从卡上
   横穿一次。 */
@keyframes dsh-canvas-shimmer{from{transform:skewX(-25deg) translateX(-120%)}to{transform:skewX(-25deg) translateX(120%)}}
@keyframes dsh-canvas-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){
  /* 减少动态效果下**不熄灭流光**，只把动感降下来：速度减半、光带减淡。曾经的做法是
     animation:none 加光带停在正中——实测那样整张卡片看上去毫无反馈，与「卡住」无从
     区分，而光在动是这张卡唯一的进行中信号（减少，不等于抹掉）。左侧的实时卡片（见
     tool-view）仍按用户偏好停掉状态点的脉动。 */
  .dsh-canvas-shimmer::after{animation-duration:3.6s;opacity:.6}
  .dsh-canvas-dot[data-state=running]{animation:none}
  /* 侧栏换宽也在这条偏好里：直接切，不做那 180ms 的伸缩。 */
  .dsh-canvas-design-side-right{transition:none}
}

/* ── sidebar 画布区（F1.7）──────────────────────────────────────────────── */
/* 画布在左栏是一个包裹：header（标题 + 新建按钮）与画布列表。宿主的面板行只渲染
   一枚按钮（图形 + 文字），塞不下第二枚按钮，也塞不下一棵列表；所以行只在**收起**
   时露面——那时它就是「画布」的图标，点一下即新建；展开态由包裹接管（canvas-nav.tsx
   经 createPortal 把它挂进宿主的列表容器，位置仍在流的原位）。

   取宿主的主题令牌（--dsw-*，都带兜底），因为这一段落在侧栏表面上，不是画布那块
   深色底：侧栏换主题时它跟着换。字号行高对齐宿主的面板行，两段看起来是同一列里
   的东西。 */
.dsh-canvas-navpane{flex:none;display:flex;flex-direction:column;gap:2px}
.dsh-canvas-navhead{display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:36px;padding:7px 8px;
  color:var(--dsw-alias-label-secondary,#7D8187)}
.dsh-canvas-navtitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:500 14px/22px var(--dsh-font)}
.dsh-canvas-navadd{display:flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;
  border:none;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dsh-canvas-navadd:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navlist{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
/* 行体与它右侧的操作按钮同住一个 li：按钮绝对定位在行的右端，所以行体照旧铺满
   整个宽度，也不参与布局——露出来的时候标题不会跟着挪一下。 */
.dsh-canvas-navitem{position:relative}
/* 右侧留给操作按钮：常驻的 30px 内边距是给它预留的位子（名字本来就带省略号，
   少这 16px 只是早一点截断），这样按钮露面时不会压住名字，也不必推挤它。 */
.dsh-canvas-navrow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 30px 6px 20px;
  border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#7D8187);
  font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dsh-canvas-navrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navrow[data-active=true]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2));
  color:var(--dsw-alias-label-primary,#fff);font-weight:500}
.dsh-canvas-navname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 行右侧的操作按钮：指针落到这一行才露面（常驻会让列表看起来是一排省略号）。
   行的:hover 与 :focus-within 是两条入口——前者给指针，后者给键盘（Tab 到行体即
   显形，再 Tab 一下就落在按钮上）。与左栏工作区那一段同宽同色：16px 图形、4px
   圆角、三级文字色，悬停升到一级。菜单开着时也留着（data-menu），这时指针可能
   已经移到菜单上，而这一行仍是「正在说哪张画布」的唯一交代。 */
.dsh-canvas-navactions{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:none;align-items:center}
.dsh-canvas-navitem:hover .dsh-canvas-navactions,
.dsh-canvas-navitem:focus-within .dsh-canvas-navactions,
.dsh-canvas-navitem[data-menu=true] .dsh-canvas-navactions{display:inline-flex}
.dsh-canvas-navicon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;padding:0;
  border:none;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary,#7D8187);cursor:pointer}
.dsh-canvas-navicon:hover{color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navempty{padding:2px 8px 6px 20px;font:12px/18px var(--dsh-font);color:var(--dsw-alias-label-secondary,#7D8187);opacity:.7}
/* 打开目录失败的那句话：贴在列表下面，说的还是这一列的事。下一次开菜单即清掉。 */
.dsh-canvas-naverror{padding:2px 8px 6px 20px;font:11px/16px var(--dsh-font);color:var(--dsw-alias-state-error-primary,#C0392B);word-break:break-all}

/* ── 画布行操作菜单与删除确认框（F1.5 修订）────────────────────────────── */
/* 两件浮层都是宿主的原语（Menu / Modal），皮与骨都在宿主那边，本表只管删除
   确认框正文里那几行字——画布根目录、进行中、失败原因。这三行说的是这张画布自己
   的事，宿主不知道它们该长什么样，也就必须由插件给。它们跨 portal 落在 body 上，
   所以只能用宿主的 --dsw-* 令牌与自带兜底的字体栈：画布那套 --dsh-* 变量只活在
   .dsh-canvas-root 里，在这里全是空值。宿主的 Modal 正文已经带了 24px 左右内边距，
   这一层只管字。 */
.dsh-canvas-navmodal-path{font:12px/18px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-tertiary,#7D8187);
  overflow-wrap:anywhere}
.dsh-canvas-navmodal-status{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#7D8187)}
.dsh-canvas-navmodal-error{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#C0392B);
  overflow-wrap:anywhere}

/* ── sidebar rail（本表仅有的全局选择器，两条，特此记名）────────────────── */
/* 折叠是宿主在框架元素上发布的一个稳定属性（data-sidebar-collapsed），而宿主的
   按钮类名是打包哈希、插件够不到；能控制的只有按钮里的图形，于是 :has() 从图形
   反选按钮：展开态把宿主那一行整行藏掉（它的标题与包裹的 header 是同一句话，不该
   写两遍；display:none 连无障碍树与 Tab 焦点一起移除），收起态还给它，并把包裹
   整棵藏起来——rail 只有 36px，本来也摆不下列表，那时图标就是唯一入口。 */
button:has(svg.dsh-canvas-nav-anchor){display:none}
[data-sidebar-collapsed] button:has(svg.dsh-canvas-nav-anchor){display:flex}
[data-sidebar-collapsed] .dsh-canvas-navpane{display:none}
`

/** Inject the canvas stylesheet once. */
export function adoptStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.appendChild(style)
}
