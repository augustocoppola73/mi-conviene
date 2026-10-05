# Avvia Mi Conviene come web app sul PC: http://localhost:8001
# Prepara (solo la prima volta o quando serve) backend e build web, poi avvia il server.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$url = 'http://localhost:8001'
$Host.UI.RawUI.WindowTitle = 'Mi Conviene'

function Step($msg) { Write-Host "-> $msg" -ForegroundColor Green }

# 1. Ambiente Python del backend
$py = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Step 'Creo l''ambiente Python (solo la prima volta)...'
    python -m venv (Join-Path $backend '.venv')
}
$req = Join-Path $backend 'requirements.txt'
$stamp = Join-Path $backend '.venv\requirements.installed'
if (-not (Test-Path $stamp) -or (Get-Item $req).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    Step 'Installo le dipendenze del backend...'
    & $py -m pip install -q --disable-pip-version-check -r $req
    if ($LASTEXITCODE -ne 0) { throw 'Installazione dipendenze backend non riuscita' }
    Set-Content $stamp (Get-Date)
}

# 2. Build web dell'app (rifatta solo se il codice è cambiato)
$index = Join-Path $frontend 'dist\index.html'
$newest = Get-ChildItem (Join-Path $frontend 'src'), (Join-Path $frontend 'app.json'), (Join-Path $frontend 'package.json') -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $index) -or $newest.LastWriteTime -gt (Get-Item $index).LastWriteTime) {
    Push-Location $frontend
    try {
        if (-not (Test-Path 'node_modules')) { Step 'Installo le dipendenze dell''app (qualche minuto, solo la prima volta)...'; npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci non riuscito' } }
        Step 'Preparo la web app...'
        npx expo export --platform web
        if ($LASTEXITCODE -ne 0) { throw 'Build web non riuscita' }
    } finally { Pop-Location }
}

# 3. Se è già attivo un server sulla porta 8001, lo fermo
$busy = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
if ($busy) { $busy | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep 1 }

# 4. Apro il browser appena il server risponde
Start-Job -ArgumentList $url -ScriptBlock {
    param($u)
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-WebRequest -UseBasicParsing "$u/api/" -TimeoutSec 2 | Out-Null; Start-Process $u; break } catch { Start-Sleep 1 }
    }
} | Out-Null

Write-Host ''
Write-Host "  Mi Conviene e' attivo su $url" -ForegroundColor Cyan
# indirizzo per il telefono (stessa rete Wi-Fi)
$wifi = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|WLAN' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1
if ($wifi) { Write-Host "  Dal telefono (stesso Wi-Fi): http://$($wifi.IPAddress):8001" -ForegroundColor Yellow }
Write-Host '  Per fermarlo chiudi questa finestra.' -ForegroundColor Cyan
Write-Host ''
Set-Location $backend
# 0.0.0.0: raggiungibile anche dal telefono sulla stessa rete (Windows chiede il permesso la prima volta)
& $py -m uvicorn server:app --host 0.0.0.0 --port 8001
