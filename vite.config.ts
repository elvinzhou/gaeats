import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  ssr: {
    noExternal: process.env.NODE_ENV === 'production' ? true : undefined,
  },
  build: {
    rollupOptions: {
      external: [
        "events", "node:events",
        "util", "node:util",
        "net", "node:net",
        "path", "node:path",
        "fs", "node:fs",
        "tls", "node:tls",
        "dns", "node:dns",
        "crypto", "node:crypto",
        "stream", "node:stream",
        "string_decoder", "node:string_decoder",
        "os", "node:os",
        "assert", "node:assert",
      ],
    }
  }
});
