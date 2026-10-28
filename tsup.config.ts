import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
    "proxy/index": "src/proxy/index.ts",
    "routes/index": "src/routes/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["next", "react", "react-dom"],
  tsconfig: "tsconfig.build.json",
});
