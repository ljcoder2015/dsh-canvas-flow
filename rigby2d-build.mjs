/**
 * Rigby2D 编辑器嵌入包的构建步（v2.08 骨骼动画卡改道）：vendor/rigby2d 里跑它自己的
 * vite（`vite.config.bridge.js`，fork 配置），把产物 copy 进 `lib/assets/rigby2d-editor/`。
 *
 * 与主仓构建的关系是刻意松的：**两套打包器互不介入**——上游源码绝不进本仓的 esbuild
 * bundle，这边只负责「调一次 vite + 搬产物」。vendor 没装依赖（node_modules 缺席）时
 * **如实跳过并提示**，不假装构建成功——编辑器包缺席的表现是编辑档报「不可用」，不是
 * 整个构建红。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const vendor = resolve(here, 'vendor/rigby2d')
const dist = join(vendor, 'dist-embed')
const out = resolve(here, 'lib/assets/rigby2d-editor')

function copyTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(dst, { recursive: true })
      copyTree(src, dst)
    } else {
      copyFileSync(src, dst)
    }
  }
}

export function buildRigby2dEditor({ quiet = false } = {}) {
  if (!existsSync(join(vendor, 'package.json'))) {
    console.warn('[rigby2d] vendor/rigby2d 不存在，跳过编辑器包构建（编辑档将不可用）')
    return false
  }
  if (!existsSync(join(vendor, 'node_modules'))) {
    console.warn('[rigby2d] vendor 依赖未安装（先在 vendor/rigby2d 里 npm install），跳过编辑器包构建')
    return false
  }
  if (!quiet) console.log('[rigby2d] vite build --config vite.config.bridge.js')
  execSync('npx vite build --config vite.config.bridge.js', { cwd: vendor, stdio: quiet ? 'pipe' : 'inherit' })
  if (!existsSync(join(dist, 'index.html'))) throw new Error('rigby2d 构建产物缺 index.html')
  rmSync(out, { force: true, recursive: true })
  mkdirSync(out, { recursive: true })
  copyTree(dist, out)
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else files.push(`${statSync(p).size}`)
    }
  }
  walk(out)
  const total = files.reduce((a, b) => a + Number(b), 0)
  if (!quiet) console.log(`[rigby2d] 编辑器包 ${files.length} 个文件，共 ${(total / 1e6).toFixed(1)} MB → lib/assets/rigby2d-editor`)
  return true
}

// 独立运行：node tools/rigby2d-build.mjs
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRigby2dEditor()
}
