import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

/**
 * Preloaded by `npm run test:db` (`--import`), before any test module is
 * evaluated.
 *
 * Next's request-scope modules throw at *import* time — "AsyncLocalStorage
 * accessed in runtime where it is not available" — unless the class is on
 * `globalThis`. The edge runtime puts it there; plain Node does not. Any test
 * file that imports a route handler pulls those modules in transitively, and
 * that happens while the file's own imports are still being resolved, so
 * nothing inside a test module can be early enough to set it.
 *
 * Hence a preload, and hence a flag rather than an import someone has to
 * remember to put first: an import that must come before the others is an
 * import a formatter will eventually reorder (S9 runs a repo-wide autofix), and
 * the failure would look like Next breaking rather than like a moved line.
 *
 * Plain `.mjs` so it needs no TypeScript transform to be loadable this early.
 */
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

/**
 * Stub `next/navigation` for the same process.
 *
 * `test:db` runs under `--conditions=react-server` (O4's note: it is what makes
 * the `server-only` marker resolve to its empty build instead of throwing).
 * Under that condition React resolves to its react-server build, which has no
 * `createContext` — and `next/navigation` reaches for one at import time via
 * `app-router-context`. So any module that imports it, `src/lib/auth/session.ts`
 * included, cannot be loaded at all, and with it every route behind a session.
 *
 * Next itself never hits this because it compiles these modules per runtime;
 * a plain `node --test` process has no such build step. Replacing the module
 * with the three functions the server half of the app actually calls is the
 * smallest thing that works, and it keeps the choice in the test harness rather
 * than putting a test-only branch in `session.ts`.
 *
 * Each one throws. That is close to Next's own behaviour — `redirect` and
 * `notFound` unwind by throwing — and it means a test that trips one fails
 * loudly and says so, instead of running on with a route that believed it had
 * already returned.
 */
const require = createRequire(import.meta.url);
const navigationId = require.resolve("next/navigation");

function unsupported(name) {
  return (...args) => {
    throw new Error(
      `${name}(${args.map(String).join(", ")}) was called in a test process. ` +
        "Route handlers under test are expected to return a Response; only pages and " +
        "server actions navigate. See tests/integration/preload.mjs.",
    );
  };
}

require.cache[navigationId] = {
  id: navigationId,
  filename: navigationId,
  path: navigationId,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    redirect: unsupported("redirect"),
    permanentRedirect: unsupported("permanentRedirect"),
    notFound: unsupported("notFound"),
    forbidden: unsupported("forbidden"),
    unauthorized: unsupported("unauthorized"),
    RedirectType: { push: "push", replace: "replace" },
  },
};
