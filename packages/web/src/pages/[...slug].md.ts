import type { APIRoute } from "astro"
import { getCollection } from "astro:content"

export async function getStaticPaths() {
  const docs = await getCollection("docs")
  return docs.map((doc) => ({
    params: { slug: doc.id },
    props: { body: doc.body },
  }))
}

export const GET: APIRoute = async ({ props }) =>
  new Response(props.body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
