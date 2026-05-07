import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Arcade } from "../../components/Arcade";
import { categories } from "../../lib/games";
import { getGamePlayCounts } from "../../lib/stats";

const VIRTUAL = ["New", "Trending"];

export function generateStaticParams() {
  return [...VIRTUAL, ...categories].map((c) => ({
    category: c.toLowerCase(),
  }));
}

function resolveCategory(slug: string): string | null {
  const lower = slug.toLowerCase();
  const virtual = VIRTUAL.find((c) => c.toLowerCase() === lower);
  if (virtual) return virtual;
  return categories.find((c) => c.toLowerCase() === lower) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const resolved = resolveCategory(category);
  if (!resolved) return { title: "Category not found" };
  const title = `${resolved} games`;
  const description = `Play free unblocked ${resolved} games on HALLPASS.`;
  return {
    title,
    description,
    alternates: { canonical: `/category/${resolved.toLowerCase()}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/category/${resolved.toLowerCase()}`,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const resolved = resolveCategory(category);
  if (!resolved) notFound();
  const playCounts = await getGamePlayCounts();
  return <Arcade initialCategory={resolved} playCounts={playCounts} />;
}
