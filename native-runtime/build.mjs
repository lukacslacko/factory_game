import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'native/runtime'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'native-runtime/service.ts')],
  outfile: path.join(root, 'native/runtime/service.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  plugins: [
    {
      name: 'local-sql-wasm',
      setup(b) {
        b.onResolve({ filter: /sql-wasm\.wasm\?url$/ }, () => ({
          path: 'sql-wasm.wasm',
          namespace: 'local-wasm',
        }));
        b.onLoad({ filter: /.*/, namespace: 'local-wasm' }, () => ({
          contents: 'export default require("node:path").join(__dirname,"sql-wasm.wasm");',
          loader: 'js',
        }));
      },
    },
  ],
});
await copyFile(
  path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'),
  path.join(root, 'native/runtime/sql-wasm.wasm'),
);
console.log('Built native/runtime/service.cjs and local SQLite WebAssembly.');
