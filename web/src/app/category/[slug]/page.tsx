import { redirect } from "next/navigation";

export default async function CategoryRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/search?category=${encodeURIComponent(slug)}`);
}
