import {reactRouter} from "@react-router/dev/vite";
import {defineConfig} from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  // Shopify SDK 3.0.1 boundary.error recognizes Router responses by class name.
  // Preserve names through production minification; keep SDK response/header handling intact.
  esbuild: {keepNames: true},
});
