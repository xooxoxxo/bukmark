/**
 * A bookmarklet that opens this server's /save page for the page it is
 * clicked on. It must never hold a token: it runs inside that page, whose
 * scripts can read anything it carries. The window it opens signs in with
 * this server's own session instead. `noopener` keeps the page from getting
 * a handle on that window.
 */
export function bookmarklet(origin: string): string {
  const save = JSON.stringify(`${origin}/save?url=`);
  return (
    `javascript:void(window.open(${save}+encodeURIComponent(location.href)` +
    `+'&title='+encodeURIComponent(document.title),'_blank','noopener,width=520,height=680'))`
  );
}
