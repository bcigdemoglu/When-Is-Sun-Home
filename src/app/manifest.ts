import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "When is Sun Home?",
    short_name: "Sun Home",
    description:
      "See how many hours of direct sunlight a backyard, terrace or window gets on every day of the year.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // The paper page colour: the splash screen and the status bar match the app.
    background_color: "#f5f0e6",
    theme_color: "#f5f0e6",
    categories: ["lifestyle", "utilities", "weather"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
