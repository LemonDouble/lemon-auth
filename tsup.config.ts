import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      "server/index": "src/server/index.ts",
      "proxy/index": "src/proxy/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["next", "react", "react-dom"],
    tsconfig: "tsconfig.build.json",
  },
  {
    entry: {
      "client/index": "src/client/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: ["next", "react", "react-dom"],
    tsconfig: "tsconfig.build.json",
    banner: {
      js: '"use client";',
    },
  },
]);
