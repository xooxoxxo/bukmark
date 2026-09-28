import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { renderDocCard, renderHomeCard } from '../../og/render';

// One share image per page, written at build time: /og/home.png for the
// landing page, /og/docs/<page>.png for each docs page.
export const getStaticPaths = (async () => {
  const docs = await getCollection('docs');
  return [
    { params: { slug: 'home' }, props: { kind: 'home' as const } },
    ...docs.map((entry) => ({
      params: { slug: entry.id === 'docs' ? 'docs/index' : entry.id },
      props: {
        kind: 'doc' as const,
        title: entry.data.title,
        description: entry.data.description ?? '',
        path: entry.id === 'docs' ? '/docs/' : `/${entry.id}/`,
      },
    })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const png = props.kind === 'home' ? await renderHomeCard() : await renderDocCard(props.title, props.description, props.path);
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
