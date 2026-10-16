# Read-only source audit. Downloads are written only to migration-backups/ and
# no Supabase or WordPress data is changed. `--noproxy *` is intentional here:
# WinHTTP is direct while HTTP(S)_PROXY points to the non-listening 127.0.0.1:9.
param(
  [string]$BackupRoot = (Join-Path $PSScriptRoot "..\migration-backups\wordpress-documents"),
  [int]$ConnectTimeoutSeconds = 8,
  [int]$MaxTimeSeconds = 45
)

# curl uses a non-zero exit code for a source-network timeout. These are audit
# results, not script-fatal errors; all filesystem operations still use -ErrorAction.
$ErrorActionPreference = "Continue"
$documents = @(
  @{id="doc-forms-1"; category="Forms"; file="P07_Student-Handbook-3.pdf"; url="https://slit.edu.au/wp-content/uploads/2025/02/P07_Student-Handbook-3.pdf"},
  @{id="doc-forms-2"; category="Forms"; file="F04_AGENT-APPLICATION-FORM.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F04_AGENT-APPLICATION-FORM.pdf"},
  @{id="doc-forms-3"; category="Forms"; file="F21_Application-for-credit-transfer-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F21_Application-for-credit-transfer-Editable.pdf"},
  @{id="doc-forms-4"; category="Forms"; file="F14_APPLICATION_FOR_ENROLMENT-.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F14_APPLICATION_FOR_ENROLMENT-.pdf"},
  @{id="doc-forms-5"; category="Forms"; file="F18_Critical-Incident-Action-Form-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F18_Critical-Incident-Action-Form-Editable.pdf"},
  @{id="doc-forms-6"; category="Forms"; file="F22_Fee-Refund-Form-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F22_Fee-Refund-Form-Editable.pdf"},
  @{id="doc-forms-7"; category="Forms"; file="F19_Leave-of-Absense-Application-Form-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F19_Leave-of-Absense-Application-Form-Editable.pdf"},
  @{id="doc-forms-8"; category="Forms"; file="Student-Complaints-and-Appeals-Form-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/Student-Complaints-and-Appeals-Form-Editable.pdf"},
  @{id="doc-forms-9"; category="Forms"; file="F16_Deferment-of-Enrolment-Form-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F16_Deferment-of-Enrolment-Form-Editable.pdf"},
  @{id="doc-forms-10"; category="Forms"; file="F24_Student-Personal-Details-Form-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F24_Student-Personal-Details-Form-Editable.pdf"},
  @{id="doc-forms-11"; category="Forms"; file="F20_Request-For-Cancellation-of-COE-Editable.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/F20_Request-For-Cancellation-of-COE-Editable.pdf"},
  @{id="doc-forms-12"; category="Forms"; file="Student-Orientation-Presentation_Skyline-Institute-Of-Technology.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/Student-Orientation-Presentation_Skyline-Institute-Of-Technology.pdf"},
  @{id="doc-forms-13"; category="Forms"; file="Document-Request-Form.pdf"; url="https://slit.edu.au/wp-content/uploads/2024/11/Document-Request-Form.pdf"},
  @{id="doc-forms-14"; category="Forms"; file="F17_Re-enrolment-Forms.pdf"; url="https://slit.edu.au/wp-content/uploads/2025/03/F17_Re-enrolment-Forms.pdf"},
  @{id="doc-forms-15"; category="Forms"; file="F18_Request-for-CoE-Extension-Forms.pdf"; url="https://slit.edu.au/wp-content/uploads/2025/03/F18_Request-for-CoE-Extension-Forms.pdf"}
)
1..13 | ForEach-Object { $documents += @{id="doc-policies-$_"; category="Policies"; file="document.pdf"; url="https://slit.edu.au/under-maintenance/"} }

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$results = foreach ($document in $documents) {
  $dir = Join-Path $BackupRoot $document.id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $target = Join-Path $dir $document.file
  $temporary = "$target.part"
  $curlError = "$target.curl-error"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $curlError -Force -ErrorAction SilentlyContinue
  $curl = & curl.exe --noproxy "*" -L --connect-timeout $ConnectTimeoutSeconds --max-time $MaxTimeSeconds --retry 1 --retry-delay 1 -sS -o $temporary -w "%{http_code}|%{content_type}|%{size_download}|%{url_effective}" $document.url 2> $curlError
  $parts = "$curl".Split("|", 4)
  $http = if ($parts.Count -gt 0) { $parts[0].Trim() } else { "000" }
  $mime = if ($parts.Count -gt 1) { $parts[1].Trim() } else { "" }
  $size = if (Test-Path -LiteralPath $temporary) { (Get-Item -LiteralPath $temporary).Length } else { 0 }
  $magic = if ($size -ge 5) { [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($temporary), 0, 5) } else { "" }
  $valid = $http -eq "200" -and $mime -match "^application/pdf" -and $size -gt 0 -and $magic -eq "%PDF-"
  $curlErrorText = if (Test-Path -LiteralPath $curlError) { "$(Get-Content -Raw -LiteralPath $curlError)".Trim() } else { "" }
  $failureReason = if ($valid) { "" } elseif ($http -eq "000") { "Network failure: $curlErrorText" } elseif ($mime -match "text/html") { "HTML response, not a PDF" } else { "HTTP $http; MIME $mime; PDF signature '$magic'" }
  if ($valid) { Move-Item -LiteralPath $temporary -Destination $target -Force } else { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $curlError -Force -ErrorAction SilentlyContinue
  [pscustomobject]@{document_id=$document.id;category=$document.category;original_filename=$document.file;original_url=$document.url;final_url=if($parts.Count -gt 3){$parts[3].Trim()}else{""};http_status=$http;mime_type=$mime;file_size=$size;sha256=if($valid){(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash}else{""};source_verified=$valid;local_backup=if($valid){$target}else{""};error=$failureReason}
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$results | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $BackupRoot "audit-$stamp.json")
$results | Export-Csv -NoTypeInformation -Encoding utf8 (Join-Path $BackupRoot "audit-$stamp.csv")
$results | Group-Object source_verified | ForEach-Object { "source_verified=$($_.Name): $($_.Count)" }
Write-Output "backup_root=$BackupRoot"
