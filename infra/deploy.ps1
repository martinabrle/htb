#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][guid]$SubscriptionId,
    [string]$ParametersFile = (Join-Path $PSScriptRoot 'main.parameters.json'),
    [guid]$RegistrationObjectId = [guid]::Empty,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

function Invoke-AzCli {
    $result = & az @args --only-show-errors
    if ($LASTEXITCODE -ne 0) {
        throw "az $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)."
    }
    $result
}

function Assert-AnonymousDenied {
    foreach ($path in @('/', '/api/demo')) {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                $response = $http.GetAsync("$url$path").GetAwaiter().GetResult()
            } catch [System.Management.Automation.MethodInvocationException] {
                if ($attempt -eq 3 -or ($_.Exception.InnerException -isnot [OperationCanceledException] -and
                    $_.Exception.InnerException -isnot [Net.Http.HttpRequestException])) { throw }
                Write-Warning "Azure hasn't answered the anonymous $path check yet (attempt $attempt of 3)."
                Start-Sleep -Seconds 5
                continue
            }
            try {
                $status = [int]$response.StatusCode
                $location = [string]$response.Headers.Location
                if ($status -notin 401, 403 -and ($status -ne 302 -or $location -notmatch '/\.auth/login/aad(?:[?/#]|$)')) {
                    throw "Anonymous $path returned HTTP $status without the expected Entra challenge."
                }
            } finally { $response.Dispose() }
            break
        }
    }
}

$account = Invoke-AzCli account show --query '{id:id,tenantId:tenantId,environmentName:environmentName}' -o json | ConvertFrom-Json
if ([guid]$account.id -ne $SubscriptionId -or $account.environmentName -ne 'AzureCloud') {
    throw 'The active Azure CLI subscription must match -SubscriptionId and use AzureCloud.'
}
$tester = [guid](Invoke-AzCli ad signed-in-user show --query id -o tsv)
if ($tester -eq [guid]::Empty) { throw 'A signed-in Entra user is required for the explicit tester allowlist.' }

$settings = (Get-Content -LiteralPath $ParametersFile -Raw | ConvertFrom-Json).parameters
$rg = $settings.resourceGroupName.value
$app = $settings.appName.value
$region = $settings.location.value
$registrationName = "entra-$($settings.environmentName.value)"
$deployment = @(
    '--subscription', "$SubscriptionId", '--location', $region,
    '--name', $settings.environmentName.value, '--template-file', (Join-Path $PSScriptRoot 'main.bicep'),
    '--parameters', "@$(Resolve-Path -LiteralPath $ParametersFile)",
    "deployerObjectId=$tester"
)
if ($ValidateOnly) {
    Invoke-AzCli deployment sub validate @deployment 'entraClientId=00000000-0000-0000-0000-000000000001' --query properties.provisioningState -o tsv
    return
}

$groupExists = Invoke-AzCli group exists --subscription $SubscriptionId --name $rg -o tsv
if ($groupExists -eq 'true') {
    $group = Invoke-AzCli group show --subscription $SubscriptionId --name $rg --query '{tags:tags,location:location}' -o json | ConvertFrom-Json
    if ($group.tags.'app-onboard-session-id' -ne $settings.sessionId.value -or $group.location -ne $region) {
        throw "Resource group $rg exists outside this demo's scope."
    }
}

if ($RegistrationObjectId -eq [guid]::Empty) {
    $sameNameIds = @(Invoke-AzCli ad app list --display-name $registrationName --query "[?displayName=='$registrationName'].id" -o json | ConvertFrom-Json)
    if ($sameNameIds.Count -ne 0) { throw "An Entra registration named $registrationName already exists. Supply its object ID only if it is this dedicated demo registration." }
    $registration = Invoke-AzCli ad app create --display-name $registrationName --sign-in-audience AzureADMyOrg --query '{id:id,appId:appId}' -o json | ConvertFrom-Json
    Write-Host "Created dedicated Entra registration object $($registration.id). Use its object ID to retry or clean up."
} else {
    $registration = Invoke-AzCli ad app show --id $RegistrationObjectId --query '{id:id,appId:appId,name:displayName,audience:signInAudience}' -o json | ConvertFrom-Json
    if ($registration.name -ne $registrationName -or $registration.audience -ne 'AzureADMyOrg') {
        throw 'Only the dedicated single-tenant demo registration may be reused.'
    }
}

$outputs = Invoke-AzCli deployment sub create @deployment "entraClientId=$($registration.appId)" --query properties.outputs -o json | ConvertFrom-Json
$hostName = $outputs.defaultHostName.value
if ($hostName -notmatch '^[a-z0-9.-]+\.azurewebsites\.net$') { throw 'Unexpected App Service hostname; refusing to register a redirect or publish.' }
$url = "https://$hostName"
# App Service requests an ID token with the authorization code in its hybrid sign-in flow.
Invoke-AzCli ad app update --id $registration.id --web-redirect-uris "$url/.auth/login/aad/callback" --enable-id-token-issuance true --enable-access-token-issuance false -o none
$principalIds = @(Invoke-AzCli ad sp list --filter "appId eq '$($registration.appId)'" --query '[].id' -o json | ConvertFrom-Json)
if ($principalIds.Count -eq 0) { Invoke-AzCli ad sp create --id $registration.appId -o none }

$tempPath = [IO.Directory]::CreateTempSubdirectory('htb-deploy-').FullName
$credentialPath = Join-Path $tempPath 'federation.json'
$zipPath = Join-Path $tempPath 'trabant-demo.zip'
try {
    $issuer = "https://login.microsoftonline.com/$($account.tenantId)/v2.0"
    $subject = $outputs.identityPrincipalId.value
    $audience = 'api://AzureADTokenExchange'
    $credentialName = 'app-service-login'
    $existing = @(Invoke-AzCli ad app federated-credential list --id $registration.id -o json | ConvertFrom-Json | Where-Object name -eq $credentialName)
    if ($existing.Count -eq 0) {
        $credential = @{ name = $credentialName; issuer = $issuer; subject = $subject; audiences = @($audience) }
        $credential | ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding utf8
        Invoke-AzCli ad app federated-credential create --id $registration.id --parameters $credentialPath -o none
    } elseif ($existing.Count -ne 1 -or $existing[0].subject -cne $subject -or
              $existing[0].issuer -cne $issuer -or $existing[0].audiences.Count -ne 1 -or $existing[0].audiences[0] -cne $audience) {
        throw 'The existing federation does not match the App Service managed identity.'
    }

    $resourceUrl = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$rg/providers/Microsoft.Web/sites/$app"
    $auth = (Invoke-AzCli rest --method get --url "$resourceUrl/config/authsettingsV2?api-version=2024-04-01" -o json | ConvertFrom-Json).properties
    $entra = $auth.identityProviders.azureActiveDirectory
    $allowed = $entra.validation.defaultAuthorizationPolicy.allowedPrincipals.identities
    $exceptions = $auth.globalValidation.excludedPaths
    if (-not ($auth.platform.enabled -and $auth.globalValidation.requireAuthentication -and $auth.httpSettings.requireHttps -and $entra.enabled) -or
        $entra.registration.clientId -ne $registration.appId -or $entra.registration.openIdIssuer -ne $issuer -or
        $allowed.Count -ne 1 -or $allowed[0] -ne "$tester" -or
        (Compare-Object @('/healthz', '/readyz') @($exceptions))) {
        throw 'The live authentication policy does not match the approved Entra perimeter; no code was uploaded.'
    }

    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $http = [Net.Http.HttpClient]::new($handler)
    $http.Timeout = [TimeSpan]::FromSeconds(15)
    try {
        Assert-AnonymousDenied
        $root = Split-Path -Parent $PSScriptRoot
        $packageFiles = @(
            'package.json', 'src\server.js', 'src\fixtures.js', 'src\public\app.js',
            'src\public\brand.svg', 'src\public\index.html', 'src\public\styles.css'
        )
        $archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in $packageFiles) {
                $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root $name), $name.Replace('\', '/'))
            }
        } finally { $archive.Dispose() }
        Invoke-AzCli webapp deploy --subscription $SubscriptionId --resource-group $rg --name $app --type zip --src-path $zipPath --timeout 240000 --track-status false -o none

        $ready = $false
        $status = 0
        for ($attempt = 1; $attempt -le 12; $attempt++) {
            $response = $http.GetAsync("$url/readyz").GetAwaiter().GetResult()
            try {
                $status = [int]$response.StatusCode
                if ($status -eq 200 -and $response.Content.Headers.ContentType.MediaType -eq 'application/json') {
                    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                    $ready = $body.status -eq 'ready'
                }
            } finally { $response.Dispose() }
            if ($ready) { break }
            Start-Sleep -Seconds 5
        }
        if (-not $ready) { throw "The app did not return the expected readiness result (last HTTP status: $status)." }
        Assert-AnonymousDenied
        Write-Host "Readiness and anonymous access checks passed: $url"
        Write-Host 'Sign in as the approved tester and run the browser acceptance checks in the README.'
    } finally { $http.Dispose() }
} finally {
    foreach ($path in @($credentialPath, $zipPath)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    Remove-Item -LiteralPath $tempPath
}
