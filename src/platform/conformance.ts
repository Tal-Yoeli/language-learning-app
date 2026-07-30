/**
 * Metro picks `foo.web.ts` over `foo.ts` when bundling for the browser, but
 * TypeScript only ever resolves `foo.ts` for imports. Without a check, a web
 * implementation can drop or rename an export and nothing fails until the page
 * is open in a browser.
 *
 * Each `.web.ts` module ends with a `Conforms<...>` alias that makes `tsc` fail
 * if the web surface stops matching the native one.
 */
export type Conforms<Native, Web extends Native> = Web;
