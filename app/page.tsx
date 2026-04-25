import dynamic from "next/dynamic";

// Render client-only: the App shell calls Supabase on mount and there is no
// meaningful server-rendered shell to ship — the whole UI is gated on session.
const App = dynamic(() => import("@/components/App").then((m) => m.App), { ssr: false });

export default function Page() {
  return <App />;
}
