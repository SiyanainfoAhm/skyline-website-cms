import { Outlet } from "react-router-dom";
import { AuthProvider } from "@/pages/admin/lib/auth";
import { AdminStoreProvider } from "@/pages/admin/lib/store";
import { ToastProvider } from "@/pages/admin/components/ui";

export default function AdminProviders() {
  return (
    <AuthProvider>
      <AdminStoreProvider>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </AdminStoreProvider>
    </AuthProvider>
  );
}