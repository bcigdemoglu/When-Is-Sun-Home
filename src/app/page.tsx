import type { Metadata } from "next";
import { App } from "@/components/app/App";
import {
  OG_SIZE,
  shareMetadataFromParams,
  toUrlSearchParams,
  type SearchParamsRecord,
} from "./og/model";

interface HomeProps {
  searchParams: Promise<SearchParamsRecord>;
}

/**
 * A link that pins a place (a shared link) gets its own title, description
 * and preview image — the answer, taken from the link itself. Nothing is
 * fetched or computed here beyond decoding the query string, and garbage in
 * it falls back to the site's default metadata (from the root layout).
 */
export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  try {
    const share = shareMetadataFromParams(toUrlSearchParams(await searchParams));
    if (!share) return {};
    const images = [{ url: share.imagePath, ...OG_SIZE, alt: share.imageAlt, type: "image/png" }];
    return {
      title: { absolute: share.title },
      description: share.description,
      // One spot can be linked with endless parameter variations; none of
      // them should compete with the home page in search results.
      robots: { index: false, follow: true },
      alternates: { canonical: "/" },
      openGraph: {
        type: "website",
        siteName: "When Is Sun Home?",
        title: share.title,
        description: share.description,
        images,
      },
      twitter: {
        card: "summary_large_image",
        title: share.title,
        description: share.description,
        images,
      },
    };
  } catch {
    return {};
  }
}

export default function Home() {
  return <App />;
}
