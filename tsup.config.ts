import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "fs";

export default defineConfig({
  entry: {
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
    "proxy/index": "src/proxy/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["next", "react", "react-dom"],
  tsconfig: "tsconfig.build.json",
  onSuccess() {
    const path = "dist/client/index.js";
    const content = readFileSync(path, "utf-8");
    writeFileSync(path, `"use client";\n${content}`);
  },
});
