
import { createClient } from "@supabase/supabase-js";

const projectUrl = "https://xcpydisstlvtvcsqnjob.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

const supabase = createClient(projectUrl, serviceKey, {
  auth: { persistSession: false },
});

const bucket = "enrollment-documents";

const paths = [
  "0347a0ac-20da-4c2b-8a02-4a7c8e250b5d/604a32ad-3a93-49f6-b483-461aa84cf514-Mihir_Pass_2032_2.pdf",
  "0347a0ac-20da-4c2b-8a02-4a7c8e250b5d/658bb505-35f9-4739-aa7e-2edfc60b21c3-MihirFLDL_front.pdf",
  "5815be5a-97f5-467d-85b0-7d4b05db0a84/a00c18f7-4a51-4eb6-9af0-3f4ac04b3ac1-Mihir_Pass_2032_2.pdf",
];

console.log(`Removing ${paths.length} Storage files...`);

const { data, error } = await supabase.storage
  .from(bucket)
  .remove(paths);

if (error) {
  console.error(error);
  process.exit(1);
}

if (!data || data.length !== paths.length) {
  console.error("Not every file was confirmed deleted.", data);
  process.exit(1);
}

console.log("Storage deletion confirmed:", data.length, "files.");
