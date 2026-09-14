import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { SiteProvider, useSite } from './hooks/useSite';

function SiteApp() {
  const site = useSite();
  return site.booted ? <App key={site.user?.id || 'guest'} /> : <div className="site-loading" role="status">Lumen…</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SiteProvider><SiteApp /></SiteProvider>
  </StrictMode>
);
