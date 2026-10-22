<#
.SYNOPSIS
  Proves the admin role restrictions against a RUNNING API with real accounts (Windows PowerShell 5.1+).

.DESCRIPTION
  Signs in as a REGULAR role-admin account and as a super_admin, then calls every restricted /admin
  route directly with each token:
    - role admin   -> must get 403 on every Internal / super_admin route and on PATCH/Clear of every
                      restricted setting (incl. media.max_video_bytes and store.timezone)
    - super_admin  -> must pass the role check (GET 200; writes any status except 401/403)
  It also checks that role admin keeps what the product form needs, that the Media Library (open to
  every admin since 22 Oct 2026) lists public media only for BOTH roles, and (with -CustomerEmail)
  that a customer token gets 401 on every /admin route and that one evidence photo uploaded as that
  customer is never listed or readable through the Media Library by either role.

  SAFE ON REAL DATA: super_admin write calls use invalid bodies or unknown ids (400/404 after the role
  check), restricted settings are re-saved with their CURRENT value (never cleared as super_admin),
  and POST /admin/media/purge-retired is only called as super_admin with -IncludeDestructive.
  With -CustomerEmail one tiny private evidence upload is created for that customer (unused).
  Role-admin calls are refused before any handler runs. One pending upload record is created for the
  product-form check (it expires unused).

  The permanent, complete check is the automated test apps/api/src/modules/admin-role-matrix.test.ts
  (it fails when an /admin route has no role rule in apps/api/test/admin-role-matrix.ts).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\role-check.ps1 -AdminEmail staff@example.com -SuperEmail akshay@dev.com
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\role-check.ps1 -AdminEmail staff@example.com -SuperEmail akshay@dev.com -CustomerEmail buyer@example.com
#>
param(
  [string]$ApiBase = 'http://localhost:4000/api/v1',
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  [Parameter(Mandatory = $true)][string]$SuperEmail,
  [string]$CustomerEmail = '',
  [switch]$IncludeDestructive,
  # Optional (automation / CI). Without them the script prompts; passwords are never echoed.
  [securestring]$AdminPassword,
  [securestring]$SuperPassword,
  [securestring]$CustomerPassword
)

$ErrorActionPreference = 'Stop'
$MaxRateLimitRetries = 8
$DefaultRetrySeconds = 15

# Mirrors packages/shared ADMIN_EDITABLE_SETTING_KEYS (the only settings role admin may change).
$AdminEditableSettings = @(
  'support.email', 'support.phone', 'support.whatsapp', 'social.links',
  'returns.return_address', 'returns.return_instructions'
)

function Read-Password([string]$Label, [securestring]$Given) {
  $secure = if ($Given) { $Given } else { Read-Host -AsSecureString "Password for $Label" }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Token, $Body = $null, [string]$ContentType = 'application/json')
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $request = @{ Uri = "$ApiBase$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $request.ContentType = $ContentType
    if ($ContentType -eq 'application/json') { $request.Body = ($Body | ConvertTo-Json -Depth 8 -Compress) }
    else { $request.Body = [string]$Body }
  }
  # Admin writes are rate-limited per IP (ADMIN_WRITE_RATE_LIMIT_*): on 429 wait and retry.
  for ($attempt = 1; $attempt -le $MaxRateLimitRetries; $attempt++) {
    try {
      $response = Invoke-WebRequest @request
      $json = $null
      if ($response.Content) { try { $json = $response.Content | ConvertFrom-Json } catch { $json = $null } }
      return [pscustomobject]@{ Status = [int]$response.StatusCode; Json = $json }
    } catch {
      if (-not $_.Exception.Response) { throw }
      $status = [int]$_.Exception.Response.StatusCode
      if ($status -ne 429) { return [pscustomobject]@{ Status = $status; Json = $null } }
      $wait = $DefaultRetrySeconds
      $retryAfter = $_.Exception.Response.Headers['Retry-After']
      if ($retryAfter -and [int]::TryParse($retryAfter, [ref]$null)) { $wait = [int]$retryAfter + 1 }
      Write-Host "Rate limited (429) on $Method $Path; waiting $wait s..." -ForegroundColor DarkYellow
      Start-Sleep -Seconds $wait
    }
  }
  return [pscustomobject]@{ Status = 429; Json = $null }
}

function Get-Token([string]$Path, [string]$Email, [string]$Label, [securestring]$Given) {
  $password = Read-Password $Label $Given
  $body = @{ email = $Email; password = $password }
  # Customer sign-in also names the client app (web / ios / android).
  if ($Path -eq '/auth/login') { $body.client = 'web' }
  $res = Invoke-Api -Method Post -Path $Path -Body $body
  if ($res.Status -ne 200) { throw "Sign-in failed for $Label ($Email): HTTP $($res.Status)" }
  return $res.Json.data.tokens.accessToken
}

$adminToken = Get-Token '/admin/auth/login' $AdminEmail 'role-admin account' $AdminPassword
$superToken = Get-Token '/admin/auth/login' $SuperEmail 'super_admin account' $SuperPassword
$me = Invoke-Api -Method Get -Path '/admin/auth/me' -Token $adminToken
if ($me.Json.data.role -ne 'admin') {
  throw "$AdminEmail has role '$($me.Json.data.role)'. Use a REGULAR role-admin account (pnpm admin:create, role admin)."
}
$customerToken = $null
if ($CustomerEmail) { $customerToken = Get-Token '/auth/login' $CustomerEmail 'customer account' $CustomerPassword }

# Real ids where a super_admin GET must succeed.
$pageId = (Invoke-Api -Method Get -Path '/admin/hidden-pages' -Token $superToken).Json.data[0].id
$groupId = (Invoke-Api -Method Get -Path '/admin/size-chart-groups' -Token $superToken).Json.data[0].id
$chartId = (Invoke-Api -Method Get -Path "/admin/size-chart-groups/$groupId/charts" -Token $superToken).Json.data[0].id
$sizeIds = @((Invoke-Api -Method Get -Path '/admin/sizes?pageSize=50' -Token $adminToken).Json.data | ForEach-Object { $_.id })
$unknown = [guid]::NewGuid().ToString()

# Every Internal / super_admin route (same list as apps/api/test/admin-role-matrix.ts).
$restricted = @(
  @{ Name = 'Media: physical purge (one)';          Method = 'Post';   Path = "/admin/media/$unknown/purge"; Body = @{} },
  @{ Name = 'Media: physical purge (retired)';      Method = 'Post';   Path = '/admin/media/purge-retired'; Body = @{}; Destructive = $true },
  @{ Name = 'Sizes & Charts: chart groups';         Method = 'Get';    Path = '/admin/size-chart-groups' },
  @{ Name = 'Sizes & Charts: chart versions';       Method = 'Get';    Path = "/admin/size-chart-groups/$groupId/charts" },
  @{ Name = 'Sizes & Charts: chart grid';           Method = 'Get';    Path = "/admin/size-charts/$chartId" },
  @{ Name = 'Sizes & Charts: size ordering';        Method = 'Put';    Path = '/admin/sizes/order'; Body = @{ ids = @() } },
  @{ Name = 'QR Pages: list';                       Method = 'Get';    Path = '/admin/hidden-pages' },
  @{ Name = 'QR Pages: detail';                     Method = 'Get';    Path = "/admin/hidden-pages/$pageId" },
  @{ Name = 'QR Pages: edit content';               Method = 'Put';    Path = "/admin/hidden-pages/$pageId/content"; Body = @{ title = ''; body = '' } },
  @{ Name = 'QR Pages: serial import';              Method = 'Post';   Path = '/admin/serial-imports?dryRun=true'; Body = ' '; ContentType = 'text/csv' },
  @{ Name = 'QR Pages: serial batches';             Method = 'Get';    Path = '/admin/serial-batches' },
  @{ Name = 'QR Pages: serial deactivate';          Method = 'Post';   Path = '/admin/serials/deactivate'; Body = @{} },
  @{ Name = 'Audit Log';                            Method = 'Get';    Path = '/admin/audit-logs' },
  @{ Name = 'Customers: suspend/enable';            Method = 'Patch';  Path = "/admin/customers/$unknown/status"; Body = @{ status = 'suspended'; reason = 'role check' } }
)

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Check, [string]$As, [int]$Status, [bool]$Pass) {
  $results.Add([pscustomobject]@{ Check = $Check; As = $As; Status = $Status; Result = $(if ($Pass) { 'PASS' } else { 'FAIL' }) })
}

foreach ($r in $restricted) {
  $ct = if ($r.ContentType) { $r.ContentType } else { 'application/json' }
  $asAdmin = Invoke-Api -Method $r.Method -Path $r.Path -Token $adminToken -Body $r.Body -ContentType $ct
  Add-Result $r.Name 'admin' $asAdmin.Status ($asAdmin.Status -eq 403)
  if ($r.Destructive -and -not $IncludeDestructive) {
    $results.Add([pscustomobject]@{ Check = $r.Name; As = 'super_admin'; Status = 0; Result = 'SKIPPED (use -IncludeDestructive)' })
    continue
  }
  $asSuper = Invoke-Api -Method $r.Method -Path $r.Path -Token $superToken -Body $r.Body -ContentType $ct
  $superPass = if ($r.Method -eq 'Get') { $asSuper.Status -eq 200 } else { $asSuper.Status -ne 401 -and $asSuper.Status -ne 403 }
  Add-Result $r.Name 'super_admin' $asSuper.Status $superPass
}

# Every restricted setting: role admin PATCH and Clear -> 403; super_admin re-saves the current value.
$settings = (Invoke-Api -Method Get -Path '/admin/settings' -Token $adminToken).Json.data
foreach ($s in $settings) {
  if ($AdminEditableSettings -contains $s.key) { continue }
  $edit = Invoke-Api -Method Patch -Path "/admin/settings/$($s.key)" -Token $adminToken -Body @{ value = $s.value }
  Add-Result "Setting edit $($s.key)" 'admin' $edit.Status ($edit.Status -eq 403)
  $clear = Invoke-Api -Method Patch -Path "/admin/settings/$($s.key)" -Token $adminToken -Body @{ value = $null }
  Add-Result "Setting clear $($s.key)" 'admin' $clear.Status ($clear.Status -eq 403)
  $superEdit = Invoke-Api -Method Patch -Path "/admin/settings/$($s.key)" -Token $superToken -Body @{ value = $s.value }
  Add-Result "Setting edit $($s.key) (same value)" 'super_admin' $superEdit.Status ($superEdit.Status -eq 200)
}

# Media Library (every admin since 22 Oct 2026): BOTH roles see public media only.
foreach ($who in @(@{ As = 'admin'; Token = $adminToken }, @{ As = 'super_admin'; Token = $superToken })) {
  $lib = Invoke-Api -Method Get -Path '/admin/media?pageSize=50' -Token $who.Token
  $onlyPublic = $lib.Status -eq 200 -and (@($lib.Json.data | Where-Object { $_.visibility -ne 'public' }).Count -eq 0)
  Add-Result 'Media Library: browse (public media only)' $who.As $lib.Status $onlyPublic
  $asked = Invoke-Api -Method Get -Path '/admin/media?visibility=private&pageSize=50' -Token $who.Token
  $stillPublic = $asked.Status -eq 200 -and (@($asked.Json.data | Where-Object { $_.visibility -ne 'public' }).Count -eq 0)
  Add-Result 'Media Library: asking for private returns none' $who.As $asked.Status $stillPublic
}

# What the product form needs stays open to role admin.
$upload = Invoke-Api -Method Post -Path '/admin/media/uploads' -Token $adminToken -Body @{ fileName = 'role-check.jpg'; mimeType = 'image/jpeg'; sizeBytes = 1000 }
Add-Result 'Product form: upload public media' 'admin' $upload.Status ($upload.Status -eq 201)
$private = Invoke-Api -Method Post -Path '/admin/media/uploads' -Token $adminToken -Body @{ fileName = 'x.jpg'; mimeType = 'image/jpeg'; sizeBytes = 1000; visibility = 'private' }
Add-Result 'Product form: private upload refused' 'admin' $private.Status ($private.Status -eq 403)
foreach ($p in @('/admin/media/picker?kind=image', '/admin/sizes', '/admin/measurement-profiles')) {
  $res = Invoke-Api -Method Get -Path $p -Token $adminToken
  Add-Result "Product form: GET $p" 'admin' $res.Status ($res.Status -eq 200)
}
$retry = Invoke-Api -Method Post -Path "/admin/media/$unknown/retry" -Token $adminToken -Body @{}
Add-Result 'Product form: retry route reachable (404 = unknown id)' 'admin' $retry.Status ($retry.Status -ne 401 -and $retry.Status -ne 403)

# Return evidence is never reachable through the general Media Library, for either role.
if ($customerToken) {
  # One tiny JPEG (magic bytes FF D8 FF) uploaded as the customer's private evidence.
  [byte[]]$jpeg = @(0xFF, 0xD8, 0xFF, 0xE0) + (New-Object byte[] 124)
  $created = Invoke-Api -Method Post -Path '/me/media/uploads' -Token $customerToken -Body @{ fileName = 'role-check-evidence.jpg'; mimeType = 'image/jpeg'; sizeBytes = $jpeg.Length }
  if ($created.Status -eq 201) {
    $evidenceId = $created.Json.data.asset.id
    $put = @{ Uri = $created.Json.data.upload.url; Method = 'Put'; Body = $jpeg; UseBasicParsing = $true; Headers = @{} }
    foreach ($h in $created.Json.data.upload.headers.PSObject.Properties) {
      if ($h.Name -eq 'Content-Type') { $put.ContentType = $h.Value }
      elseif ($h.Name -ne 'Content-Length') { $put.Headers[$h.Name] = $h.Value }
    }
    Invoke-WebRequest @put | Out-Null
    Invoke-Api -Method Post -Path "/me/media/$evidenceId/complete" -Token $customerToken | Out-Null
    foreach ($who in @(@{ As = 'admin'; Token = $adminToken }, @{ As = 'super_admin'; Token = $superToken })) {
      $listed = @((Invoke-Api -Method Get -Path '/admin/media?pageSize=50' -Token $who.Token).Json.data | Where-Object { $_.id -eq $evidenceId }).Count
      Add-Result 'Evidence not listed in the Media Library' $who.As 200 ($listed -eq 0)
      foreach ($p in @("/admin/media/$evidenceId", "/admin/media/$evidenceId/url", "/admin/media/$evidenceId/usage")) {
        $res = Invoke-Api -Method Get -Path $p -Token $who.Token
        Add-Result "Evidence hidden: GET $p" $who.As $res.Status ($res.Status -eq 404)
      }
    }
  } else {
    Add-Result 'Evidence check: customer evidence upload' 'customer' $created.Status $false
  }
}

# Customer token on /admin routes.
if ($customerToken) {
  $customerPaths = @($restricted | ForEach-Object { @{ Method = $_.Method; Path = $_.Path; Body = $_.Body; ContentType = $_.ContentType } }) + @(
    @{ Method = 'Get'; Path = '/admin/orders' }, @{ Method = 'Get'; Path = '/admin/products' },
    @{ Method = 'Get'; Path = '/admin/settings' }, @{ Method = 'Get'; Path = '/admin/stats/overview' },
    @{ Method = 'Get'; Path = '/admin/auth/me' }, @{ Method = 'Post'; Path = '/admin/media/uploads'; Body = @{} }
  )
  foreach ($c in $customerPaths) {
    $ct = if ($c.ContentType) { $c.ContentType } else { 'application/json' }
    $res = Invoke-Api -Method $c.Method -Path $c.Path -Token $customerToken -Body $c.Body -ContentType $ct
    Add-Result "Customer token $($c.Method.ToUpper()) $($c.Path)" 'customer' $res.Status ($res.Status -eq 401)
  }
} else {
  Write-Host 'Customer check skipped (pass -CustomerEmail to include it).' -ForegroundColor Yellow
}

$results | Format-Table -AutoSize
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' })
if ($failed.Count -gt 0) {
  Write-Host "$($failed.Count) check(s) FAILED." -ForegroundColor Red
  exit 1
}
Write-Host "All $($results.Count) checks passed." -ForegroundColor Green
