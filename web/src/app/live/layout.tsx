import { LiveDarkTheme } from "@/app/live/live-theme";

/**
 * The live pages are a trading screen, and they are drawn for dark (owner, 2026-10-19: they "loaded in light
 * mode" on a phone set to light, and rendered wrong). The rest of the site follows the viewer's setting; these
 * pages fix the theme to dark - the site's own dark tokens, header included - before the first paint.
 */
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Runs during parsing, before paint, so a light-mode phone never flashes the light theme here. */}
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.setAttribute("data-theme","dark");` }} />
      <LiveDarkTheme />
      {children}
    </>
  );
}
