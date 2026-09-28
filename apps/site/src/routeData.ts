import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

const SITE = 'https://bukmark.it';

/**
 * Share metadata for every docs page: the page's own card from /og/, a title
 * that names bukmark (a shared "Install" alone says nothing), and the large
 * X card. Starlight already writes og:title, og:description, og:url and
 * twitter:card; this replaces the title and adds the image.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const id = route.entry.id === 'docs' ? 'docs/index' : route.entry.id;
  const image = `${SITE}/og/${id}.png`;
  const title = `${route.entry.data.title} — bukmark docs`;
  const alt = `bukmark docs: ${route.entry.data.title}. ${route.entry.data.description ?? ''}`.trim();

  const head = route.head.filter(
    (tag) => !(tag.tag === 'meta' && (tag.attrs?.property === 'og:title' || tag.attrs?.name === 'twitter:title')),
  );
  head.push(
    { tag: 'meta', attrs: { property: 'og:title', content: title } },
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: alt } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: title } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
    { tag: 'meta', attrs: { name: 'twitter:image:alt', content: alt } },
  );
  route.head = head;
});
