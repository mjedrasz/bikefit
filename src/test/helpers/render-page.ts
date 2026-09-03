import { getContainerRenderer as reactContainerRenderer } from "@astrojs/react";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import { loadRenderers } from "astro:container";

// Wraps Astro's Container API for the two SSR pages in `src/pages/sessions/`. Returns the
// `Response` so a spec can assert `.status` and parse `.text()` for the rendered markup.
//
// Only specs in the `pages` Vitest project import this — that project carries the Astro
// Vite plugin (via `getViteConfig`) that compiles a `.astro` import and provides the
// `astro:container` virtual module. `getViteConfig` does not auto-register integration
// renderers the way a full build does, so the React renderer (`DeleteSessionButton
// client:visible` on the history list) is loaded explicitly here.
//
//   const res = await renderPage(SessionsIndex, { locals: { user: { id: "u1" } } });
//   expect(res.status).toBe(200);
//   expect(await res.text()).toContain("Session history");

export interface RenderPageOptions {
  request?: Request;
  params?: Record<string, string | undefined>;
  /** Only the keys a page actually reads need to be set (`user` for the session pages). */
  locals?: Partial<App.Locals>;
}

const renderersPromise = loadRenderers([reactContainerRenderer()]);

export async function renderPage(
  Component: AstroComponentFactory,
  { request, params = {}, locals = {} }: RenderPageOptions = {},
): Promise<Response> {
  const container = await AstroContainer.create({ renderers: await renderersPromise });
  return container.renderToResponse(Component, {
    request: request ?? new Request("http://test.local/"),
    params,
    locals: locals as App.Locals,
    routeType: "page",
  });
}
