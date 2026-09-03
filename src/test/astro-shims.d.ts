// `tsc --noEmit` (the project's type-check gate — see context/foundation/lessons.md) has no
// loader for `.astro` files, so a `.ts` spec that imports a page component for the Container
// API (`import SessionsIndex from "./index.astro"`) fails to resolve it. The Astro language
// server / `astro check` resolve these through their own mechanism; plain `tsc` needs this
// ambient declaration. Runtime resolution is handled separately by the Astro Vite plugin in
// the `pages` Vitest project (see vitest.config.ts).

declare module "*.astro" {
  import type { AstroComponentFactory } from "astro/runtime/server/index.js";

  const Component: AstroComponentFactory;
  export default Component;
}
