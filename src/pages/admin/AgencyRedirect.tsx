import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "@/pages/admin/lib/supabase";

/** Old /admin/agencies/:id links open the agency's business page, which now holds the agency, its team and its applications. */
export default function AgencyRedirect() {
  const { id = "" } = useParams();
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void supabase.from("agencies").select("business_id").eq("id", id).maybeSingle()
      .then(({ data }) => { if (active) setTarget(data?.business_id ? String(data.business_id) : null); });
    return () => { active = false; };
  }, [id]);
  if (target === undefined) return <p className="p-6 text-sm text-foreground-600">Opening business&hellip;</p>;
  if (target === null) {
    return (
      <div className="p-6 text-sm">
        <p role="alert" className="text-red-700">This agency could not be found.</p>
        <Link to="/admin/businesses" className="mt-3 inline-block font-semibold text-primary-700 underline">Back to Businesses</Link>
      </div>
    );
  }
  return <Navigate to={`/admin/businesses/${target}`} replace />;
}
