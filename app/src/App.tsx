import { NavLink, Route, Routes } from "react-router-dom";
import Mark from "./components/Mark";
import SyncPill from "./components/SyncPill";
import { IconAdd, IconBrowse, IconDecks, IconSettings, IconStats } from "./components/icons";
import Decks from "./screens/Decks";
import Review from "./screens/Review";
import Editor from "./screens/Editor";
import Browser from "./screens/Browser";
import Settings from "./screens/Settings";
import Stats from "./screens/Stats";

const TABS = [
  { to: "/", label: "Decks", Icon: IconDecks, end: true },
  { to: "/new", label: "Add", Icon: IconAdd },
  { to: "/browse", label: "Browse", Icon: IconBrowse },
  { to: "/stats", label: "Stats", Icon: IconStats },
  { to: "/settings", label: "Settings", Icon: IconSettings },
] as const;

export default function App() {
  // desktop: text tabs with an accent underline, like a card divider tab
  const desktopTab = ({ isActive }: { isActive: boolean }) =>
    `relative flex h-14 items-center px-3 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full ${
      isActive
        ? "text-ink after:bg-accent-rule"
        : "text-muted after:bg-transparent hover:text-ink"
    }`;
  // phone: icon + label, full-height tap targets
  const mobileTab = ({ isActive }: { isActive: boolean }) =>
    `flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors ${
      isActive ? "text-accent" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="min-h-dvh bg-desk text-ink">
      <header className="sticky top-0 z-20 border-b border-hairline bg-desk/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
          <NavLink to="/" className="-ml-1 flex items-center gap-2 rounded-md px-1 py-1 text-ink" aria-label="recall — decks">
            <Mark className="h-6 w-6" />
            <span className="font-serif text-[1.2rem] font-semibold leading-none tracking-[-0.01em]">recall</span>
          </NavLink>
          <nav className="ml-6 hidden h-14 sm:flex" aria-label="Main">
            {TABS.map(({ to, label, ...t }) => (
              <NavLink key={to} to={to} end={"end" in t} className={desktopTab}>
                {label}
              </NavLink>
            ))}
          </nav>
          <SyncPill />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:pb-12 sm:pt-8">
        <Routes>
          <Route path="/" element={<Decks />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:deck" element={<Review />} />
          <Route path="/new" element={<Editor />} />
          <Route path="/edit/:id" element={<Editor />} />
          <Route path="/browse" element={<Browser />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* phone tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-hairline bg-desk/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        {TABS.map(({ to, label, Icon, ...t }) => (
          <NavLink key={to} to={to} end={"end" in t} className={mobileTab}>
            <Icon className="h-[1.375rem] w-[1.375rem]" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
