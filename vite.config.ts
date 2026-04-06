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
      external: ["events", "util", "net", "path", "fs", "tls", "dns", "crypto", "stream", "string_decoder"],
    }
  }
});
