import { Outlet } from "react-router-dom";
import { PortalAuthProvider } from "@/pages/agency/lib/portalAuth";
import { ToastProvider } from "@/pages/admin/components/ui";

// The portal shares screens with the CMS (New application uses its toasts), so it needs the same toast provider.
export default function PortalProviders() {
  return (
    <PortalAuthProvider>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </PortalAuthProvider>
  );
}
