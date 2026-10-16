import { Outlet } from "react-router-dom";
import { PortalAuthProvider } from "@/pages/agency/lib/portalAuth";

export default function PortalProviders() {
  return (
    <PortalAuthProvider>
      <Outlet />
    </PortalAuthProvider>
  );
}