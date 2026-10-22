/**
 * dsh-canvas — Host Typert manifest.
 *
 * The manifest tells the model layer what this package offers. It is not
 * generated: the descriptors come straight from {@link DSH_CANVAS_INVOCATIONS}
 * — the same array the browser half mounts — so the two faces cannot describe
 * different contracts. The member list below is documentation for the model,
 * and `tests/contract.spec.ts` asserts the identity of the shared array.
 */
import type { TypertContribution, TypertMemberModel, TypertServiceModel } from '@deepseek-ai/dsh-typert-registry'
import { DSH_CANVAS_INVOCATIONS, PACKAGE_NAME } from './contract.ts'

/** Package identity — must match `package.json`, `build.mjs` and `cordis.patch.yml`. */
export const TYPERT_PACKAGE = PACKAGE_NAME

/** One documented method of a Remote service. */
const member = (name: string, signature: string, summary: string): TypertMemberModel => ({
  kind: 'method',
  name,
  signature,
  summary,
})

/** The `canvas` namespace: seating, source edges, notes. */
const CANVAS_MEMBERS: readonly TypertMemberModel[] = [
  member('listProjects', 'listProjects(signal?): Promise<Project[]>', '列出所有画布项目。'),
  member('createProject', 'createProject(name, path, signal?): Promise<ProjectBinding>', '把目录绑定为新画布项目，并扫描其中的产物。'),
  member('removeProject', 'removeProject(projectId, signal?): Promise<boolean>', '移除画布项目（不删除磁盘文件）。'),
  member('listFolders', 'listFolders(path, signal?): Promise<FolderEntry[]>', '列出目录下的可选文件夹，供选择器使用。'),
  member('setActiveProject', 'setActiveProject(projectId, signal?): Promise<Project>', '记录用户当前打开的画布：画布级工具按它取项目。'),
  member('readBoard', 'readBoard(projectId, signal?): Promise<BoardSnapshot>', '读取画布座次、引用边与便利贴。'),
  member('setViewport', 'setViewport(projectId, viewport, signal?): Promise<Project>', '记录画布视图状态。'),
  member('setStyle', 'setStyle(projectId, style, signal?): Promise<StyleProfile>', '设置项目风格档案。'),
  member('moveCard', 'moveCard(projectId, cardId, position, signal?): Promise<BoardCard>', '移动一张卡片。'),
  member('arrange', 'arrange(projectId, strategy, signal?): Promise<BoardSnapshot>', '按引用链、网格或归纳策略重新摆位。'),
  member('linkSource', 'linkSource(projectId, upstream, downstream, signal?): Promise<BoardSource>', '建立一条引用边：下游产物引用上游产物。'),
  member('unlinkSource', 'unlinkSource(projectId, sourceId, signal?): Promise<boolean>', '删除一条引用边。'),
  member('getSources', 'getSources(projectId, cardId, signal?): Promise<SourceChain>', '解析一张卡片的引用链（直接上游、间接上游、下游）。'),
  member('reconcile', 'reconcile(projectId, signal?): Promise<BoardSource[]>', '按产物里写到的引用对账，补齐自动生成的边。'),
  member('createNote', 'createNote(projectId, text, position, signal?): Promise<Note>', '在画布上创建共享便利贴。'),
  member('removeNote', 'removeNote(projectId, noteId, signal?): Promise<boolean>', '删除便利贴。'),
]

/** The `card` namespace: artifact digests, writes, injection, export. */
const CARD_MEMBERS: readonly TypertMemberModel[] = [
  member('createCard', 'createCard(projectId, file, kind, position, signal?): Promise<BoardCard>', '为产物文件落一张新卡：file 是项目内相对路径，卡片 id 由画布铸出（6 位随机字母），返回值携带。'),
  member('renameCard', 'renameCard(projectId, cardId, name, signal?): Promise<BoardCard>', '改卡片名（F1.12）：名字写进卡片，并连同磁盘上那一项一起改（文件形态改文件名、目录形态改目录名，入口页跟着搬）；撞名自动带 -2…-99 序号；产物就在画布根目录上、或名字里没有一个能当文件名的字则拒绝。'),
  member('setMediaModel', 'setMediaModel(projectId, cardId, model, signal?): Promise<BoardCard>', '记下这张卡由哪个模型生成（F2.7）：图片 / 视频 / 音频卡底栏那颗下拉框选的就是它，空串回到「自动」（按模型族在模型配置里挑）。不改会话——会话用哪个模型说话是另一件事。'),
  member('setAspect', 'setAspect(projectId, cardId, aspect, signal?): Promise<BoardCard>', '记下产物真实的宽高比（F3.11）：浏览器把图 / 视频解码出来量一次再回写，卡片于是按产物自己的比例坐，而不是一律 16:9。它只改这张卡的占位，不改产物一个字节。'),
  member('importArtifact', 'importArtifact(projectId, cardId, name, content, signal?): Promise<BoardCard>', '把用户本地选中的一个文件导入成这张卡的产物（F2.7）：字节落在画布目录里，卡片改成指向它，形态按新文件名重判。只接受图片 / 视频 / 音频。'),
  member('scaffoldWebapp', 'scaffoldWebapp(projectId, name, position, signal?): Promise<BoardCard>', '新建应用节点：建一个文件夹，写入 web components + shadcn 风格的 web 应用脚手架，并落成卡片。'),
  member('scaffoldDesign', 'scaffoldDesign(projectId, name, position, signal?): Promise<BoardCard>', '新建设计节点：写入一份含空白容器的场景图设计文档（.design v2），并落成卡片。'),
  member('readDesign', 'readDesign(projectId, cardId, signal?): Promise<DesignDocument>', '读取设计文档的 JSON 结构（容器与图层树，scene-graph 快照）。'),
  member('editDesign', 'editDesign(projectId, cardId, ops, signal?): Promise<DesignEditResult>', '对设计文档应用批量结构化编辑 op（upsert/setProps/move/delete/reorder）。'),
  member('removeCard', 'removeCard(projectId, cardId, signal?): Promise<boolean>', '从画布移除卡片（不删除磁盘文件）。'),
  member('removeMissingCards', 'removeMissingCards(projectId, signal?): Promise<number>', '一次移除板上所有产物已不在磁盘上的卡片，返回移除了几张；不删除磁盘文件。'),
  member('readSummary', 'readSummary(projectId, cardId, signal?): Promise<CardSummary>', '读取一张卡片产物的摘要。'),
  member('readArtifact', 'readArtifact(projectId, cardId, signal?): Promise<ArtifactView>', '读取一张卡片产物的全屏视图载荷（全文或媒体 data URL）。'),
  member('readBundle', 'readBundle(projectId, cardId, signal?): Promise<BundleView>', '读取一张应用类卡片产物的整个目录（文件清单与内容），供浏览器本地打包成压缩包；依赖目录与超预算的文件会被跳过并如实记录。'),
  member('readSources', 'readSources(projectId, cardId, signal?): Promise<CardSummary[]>', '读取一张卡片的全部引用来源摘要。'),
  member('referenceFiles', 'referenceFiles(projectId, cardId, signal?): Promise<ReferencedFiles>', '把引用来源以「文件引用」注入卡片会话：上游产物按 @工作区相对路径 命名（模型自己 read 按需读取），不复制内容；路径无法写成 @引用的会在 skipped 里说明。'),
  member('injectCard', 'injectCard(projectId, cardId, sourceCardId, mode, signal?): Promise<CardSummary>', '把上游产物注入卡片会话。'),
  member('openSession', 'openSession(projectId, cardId, signal?): Promise<SessionBinding>', '打开（或复用）卡片绑定的 Agent 会话。'),
  member('releaseSession', 'releaseSession(projectId, cardId, signal?): Promise<boolean>', '释放卡片会话；日志保留，重开即续。'),
  member('writeText', 'writeText(projectId, cardId, content, signal?): Promise<WriteResult>', '整文件写回产物（F8.1 双击改字）。'),
  member('editText', 'editText(projectId, cardId, content, version, signal?): Promise<WriteResult>', '带版本守卫的整文件替换：内容已被改动则失败。'),
  member('queueIntent', 'queueIntent(projectId, cardId, kind, payload, image, signal?): Promise<PendingIntent[]>', '把结构化编辑意图排队，供卡片会话下一轮取用。'),
  member('readPending', 'readPending(projectId, cardId, signal?): Promise<PendingIntent[]>', '读取排队中的结构化意图。'),
  member('exportCard', 'exportCard(projectId, cardId, format, signal?): Promise<ExportResult>', '导出产物为指定格式。'),
  member('publishCard', 'publishCard(projectId, cardId, signal?): Promise<ExportResult>', '把产物发布到子域名。'),
  member('sendMessage', 'sendMessage(projectId, cardId, prompt, signal?): Promise<SessionBinding>', '把用户在卡片输入框里写的提示词提交给卡片会话，作为下一轮对话。'),
  member('readLastPrompt', 'readLastPrompt(projectId, cardId, signal?): Promise<LastPrompt>', '读取用户对该卡片会话最近一条自己发出的消息（F3.9，供输入框回填）。'),
]

/** The one contribution this package makes to the Host registry. */
export const TYPERT_MANIFEST: TypertContribution = {
  package: TYPERT_PACKAGE,
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'canvas',
        exportName: 'CanvasRuntime',
        summary: '画布座次、项目与引用链。',
        description: '画布座次、项目与引用链。',
        tags: [],
        members: CANVAS_MEMBERS,
        types: [],
      } satisfies TypertServiceModel,
      {
        key: 'card',
        exportName: 'CardRuntime',
        summary: '卡片产物读写、注入与导出。',
        description: '卡片产物读写、注入与导出。',
        tags: [],
        members: CARD_MEMBERS,
        types: [],
      } satisfies TypertServiceModel,
    ],
    events: [],
    objects: [],
  },
  invocations: DSH_CANVAS_INVOCATIONS,
}
