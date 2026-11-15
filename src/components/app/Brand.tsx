import { SunIcon } from "@/components/ui/icons";

/** The app's name: the page's one `<h1>`. */
export function Brand() {
  return (
    <h1 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
      <SunIcon className="text-state-sun" width={18} height={18} />
      When is Sun Home?
    </h1>
  );
}
