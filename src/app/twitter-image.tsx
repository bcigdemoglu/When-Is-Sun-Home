// The same card as the Open Graph image. (Next.js needs the route config
// declared in this file, so it is repeated rather than re-exported.)
import { OG_SIZE, SITE_NAME } from "./og/model";
import OpenGraphImage from "./opengraph-image";

export const alt = `${SITE_NAME} Hours of direct sun for any backyard or window.`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default OpenGraphImage;
