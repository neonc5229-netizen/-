// Copies the kuromoji browser build and its dictionary into public/ so they are served as static files.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'kuromoji')
const dest = join(root, 'public', 'kuromoji')
mkdirSync(dest, { recursive: true })
// Some servers send the .gz dictionary files with `Content-Encoding: gzip`, so the browser has
// already decompressed them. Only gunzip when the data still starts with the gzip magic bytes.
const original = 'var gz = new zlib.Zlib.Gunzip(new Uint8Array(arraybuffer));\n        var typed_array = gz.decompress();\n        callback(null, typed_array.buffer);'
const patched = 'var bytes = new Uint8Array(arraybuffer);\n        if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) { callback(null, arraybuffer); return; }\n        var typed_array = new zlib.Zlib.Gunzip(bytes).decompress();\n        callback(null, typed_array.buffer);'
const code = readFileSync(join(src, 'build', 'kuromoji.js'), 'utf8')
if (!code.includes(original)) throw new Error('kuromoji loader code changed; update the patch in copy-kuromoji.mjs')
writeFileSync(join(dest, 'kuromoji.js'), code.replace(original, patched))
cpSync(join(src, 'dict'), join(dest, 'dict'), { recursive: true })
console.log('kuromoji copied to public/kuromoji')
