import { Navigate, useParams } from "react-router-dom";

/** Old /admin/agencies/:id links open the business page: the business is the agency record. */
export default function AgencyRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={id ? `/admin/businesses/${id}` : "/admin/businesses"} replace />;
}
