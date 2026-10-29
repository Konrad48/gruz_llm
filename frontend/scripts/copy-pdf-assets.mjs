import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
mkdirSync("public/pdfjs", { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(join(root, name), join("public/pdfjs", name), { recursive: true });
}
