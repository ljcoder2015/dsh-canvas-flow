// SPDX-License-Identifier: MIT OR Apache-2.0
// dsh-canvas 桥（fork 差异面，见 vendor/rigby2d/FORK.md）：iframe 里的编辑器与画布宿主
// （React）之间的唯一通信面。上游代码不感知本文件——只通过 main.js 里的一行 install 接入。
//
// 协议（postMessage，targetOrigin 由宿主注入）：
//   → { type: 'dsh:ready' }            桥装好，宿主收到后才允许发 open
//   ← { type: 'dsh:open', kind: 'rigby' | 'dragonbones',
//        project: { name, base64 }, files: [{ name, base64 }] }   载入项目（工作档或 DragonBones 三件套）
//   → { type: 'dsh:saved', files: [{ name, base64 }] }           编辑器保存落盘的文件（.rigby + 图集）
//   → { type: 'dsh:dirty', dirty: boolean }                      脏标记变化（关档前拦截用）
//
// fs 对象对齐 platform.js 的抽象（readFile/readText/writeFile/writeText/mkdir/list/finish/reusable）：
// 打开时收下的文件进内存文件集，写入收集在 written，finish() 统一回传宿主并并回文件集——
// 连续保存、图集随工作档一起回来的路都走得通。

const encoder = new TextEncoder();

function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 可写版 memoryFs：打开时收下的文件只读，写入收集到 finish() 统一回传宿主。 */
function bridgeFs(files) {
  const byName = new Map(files.map((f) => [f.name, f]));
  const written = new Map();
  const get = (p) => {
    const f = byName.get(p) ?? byName.get(p.split('/').pop());
    if (!f) throw new Error(`file not found: ${p}`);
    return f;
  };
  return {
    readFile: async (p) => new Uint8Array(await get(p).arrayBuffer()),
    readText: async (p) => get(p).text(),
    writeFile: async (p, bytes) => {
      written.set(p, bytes);
    },
    writeText: async (p, text) => {
      written.set(p, encoder.encode(text));
    },
    mkdir: async () => {},
    list: async () => [...byName.keys()],
    // 宿主桥可复用：openFrom 会把 saveTarget 指回这个 fs，Ctrl+S 落到 finish() 的回传。
    reusable: true,
    finish: async () => {
      if (!written.size) return;
      const payload = [...written].map(([name, bytes]) => ({ name, base64: bytesToB64(bytes) }));
      // 并回文件集再清账：下一次保存的图集/工作档都从最新内容出发。
      for (const [p, bytes] of written) byName.set(p, new File([bytes], p.split('/').pop()));
      written.clear();
      window.parent.postMessage({ type: 'dsh:saved', files: payload }, '*');
    },
  };
}

/** 安装桥：把宿主消息接到 app 的 openFrom / dirty 上。上游 main.js 调一次。 */
export function installHostBridge(app) {
  if (typeof window === 'undefined' || window.parent === window) return; // 独立打开时静默不装
  let lastDirty = false;
  const post = (msg) => window.parent.postMessage(msg, '*');

  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'dsh:open') {
      try {
        const files = [];
        if (msg.project?.name) files.push(new File([b64ToBytes(msg.project.base64)], msg.project.name));
        for (const f of msg.files ?? []) files.push(new File([b64ToBytes(f.base64)], f.name));
        // kind 由文件名/内容决定（io.projectKind 认 .rigby 与 DragonBones _ske.json 等），
        // DragonBones 三件套即旧格式的迁移入口：编辑器自己的导入器接手。
        const primary = msg.project?.name ?? (msg.files ?? [])[0]?.name;
        if (!primary) throw new Error('dsh:open 缺少项目文件');
        const result = await app.openFrom(primary, bridgeFs(files));
        post({ type: 'dsh:opened', ok: result.ok, warnings: result.warnings ?? null, error: String(result.error ?? '') });
      } catch (e) {
        post({ type: 'dsh:opened', ok: false, error: String(e) });
      }
    }
  });

  // 脏标记轮询：编辑器的改动路径太多（undo、滑杆、拖拽），轮询是唯一不碰上游代码的收口。
  setInterval(() => {
    let dirty = false;
    try {
      dirty = typeof app.dirty === 'function' ? app.dirty() : false;
    } catch {
      dirty = false;
    }
    if (dirty !== lastDirty) {
      lastDirty = dirty;
      post({ type: 'dsh:dirty', dirty });
    }
  }, 800);

  post({ type: 'dsh:ready' });
}
