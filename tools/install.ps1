# Instala Scope Compass en Windows (la opción instalable; la portable es usar el .exe donde esté, ver docs/instalar.md):
# baja de GitHub el binario más nuevo, lo verifica con SHA256SUMS, lo copia a %LOCALAPPDATA%\Programs\scompass\
# scompass.exe, suma esa carpeta al PATH del usuario y deja "Scope Compass" en el menú Inicio, que levanta el Inicio con
# ícono en la bandeja y lo abre en el navegador. No pide permisos de administrador. Se corre una vez: después el binario
# se actualiza solo (scompass upgrade, el aviso del Inicio).
#   irm https://raw.githubusercontent.com/dannroda/scope-compass/main/tools/install.ps1 | iex
#   $env:SCOMPASS_CHANNEL = 'beta'; irm …/install.ps1 | iex     también las pre-releases (versiones para probar); el
#                                                                binario queda en el canal beta para actualizarse
#   powershell -ExecutionPolicy Bypass -File install.ps1 [archivo] [-Channel beta]
#                                                                desde el repo: un scompass-v<versión>-windows-x64.exe
#                                                                ya bajado; sin argumento, el más nuevo en dist/ o al
#                                                                lado de este script, y si no hay, lo baja
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#                                                                saca el binario, el acceso directo y la carpeta del
#                                                                PATH (los tableros y la caché quedan)
param([string]$Exe, [switch]$Uninstall, [string]$Channel)
# Corrido como archivo desde el repo, un binario ya armado o bajado (en dist/ o al lado); con `irm | iex` no hay carpeta.
if (-not $Exe -and -not $Uninstall -and $PSScriptRoot) {
  $Exe = Get-ChildItem -Path (Join-Path $PSScriptRoot '..\dist'), $PSScriptRoot -Filter 'scompass-v*-windows-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
# Va sin BOM, porque con BOM `irm | iex` no lo entiende; pero entonces PowerShell 5.1 lee el archivo como ANSI y los
# acentos de los mensajes salen rotos. En ese caso se vuelve a leer en UTF-8 y se corre así.
if ($PSCommandPath -and 'ñ'.Length -ne 1) {
  & ([scriptblock]::Create([IO.File]::ReadAllText($PSCommandPath, [Text.Encoding]::UTF8))) -Exe $Exe -Uninstall:$Uninstall -Channel $Channel
  return
}
# Todo en un bloque: con `irm | iex` corre en la sesión de quien lo pega, y así ni las preferencias ni las variables
# quedan en ella, y un error no cierra la consola.
& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # la barra de progreso de PowerShell 5.1 hace lentísimas las descargas
$Repo = 'dannroda/scope-compass'
$Dir = Join-Path $env:LOCALAPPDATA 'Programs\scompass'
$Bin = Join-Path $Dir 'scompass.exe'
$Lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Scope Compass.lnk'
if (-not $Channel) { $Channel = if ($env:SCOMPASS_CHANNEL) { $env:SCOMPASS_CHANNEL } else { 'stable' } }
if ($Channel -notin 'stable', 'beta') { throw "canal inválido: $Channel (stable o beta)" }

# El PATH del usuario se lee y se escribe en el registro tal cual, sin expandir: [Environment]::SetEnvironmentVariable
# lo guardaría expandido y como REG_SZ, y las entradas con %USERPROFILE% dejarían de seguir a la variable.
function Set-UserPath([scriptblock]$change) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $old = $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  $parts = @($old -split ';' | Where-Object { $_ })
  $new = (& $change $parts) -join ';'
  if ($new -ne $old) { $key.SetValue('Path', $new, 'ExpandString') }
  $key.Close()
  # Avisa a Windows (WM_SETTINGCHANGE) para que las consolas nuevas vean el PATH sin cerrar sesión. El tipo se agrega
  # una vez por sesión: con iex, una segunda corrida en la misma consola fallaría al volver a agregarlo.
  if (-not ('ScopeCompass.Env' -as [type])) {
    Add-Type -Namespace ScopeCompass -Name Env -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, UIntPtr w, string l, uint flags, uint timeout, out UIntPtr result);'
  }
  $r = [UIntPtr]::Zero
  [void][ScopeCompass.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)
}
$same = { param($p) $p.TrimEnd('\') -ieq $Dir }

if ($Uninstall) {
  Remove-Item $Lnk -ErrorAction SilentlyContinue
  Set-UserPath { param($parts) $parts | Where-Object { -not (& $same $_) } }
  if (Test-Path $Dir) {
    try { Remove-Item -Recurse -Force $Dir -ErrorAction Stop }
    catch { throw "no pude borrar $Dir (¿el Inicio o un hub siguen corriendo? cerralos y volvé a correr con -Uninstall): $_" }
  }
  # La ruta anotada (§37), si es la de este binario: el dock no buscaría uno que ya no está.
  $self = Join-Path $env:LOCALAPPDATA 'scope-compass\scompass.json'
  if ((Test-Path $self) -and (Get-Content $self -Raw | ConvertFrom-Json).command -ieq $Bin) { Remove-Item $self }
  Write-Output "Listo: sin $Bin, sin el acceso directo y sin $Dir en el PATH."
  Write-Output "Los tableros no se tocan. La caché del binario ($(Join-Path $env:LOCALAPPDATA 'scope-compass\runtime')) se puede borrar a mano."
  return
}

$tmp = $null
if ($Exe) {
  if (-not (Test-Path $Exe -PathType Leaf)) { throw "no existe $Exe" }
} else {
  # La release más nueva del canal (stable: solo releases; beta: también las pre-releases), como `scompass upgrade`.
  # SCOMPASS_RELEASES_URL cambia de dónde sale la lista, para probar contra otro servidor.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $api = if ($env:SCOMPASS_RELEASES_URL) { $env:SCOMPASS_RELEASES_URL } else { "https://api.github.com/repos/$Repo/releases?per_page=30" }
  $ua = @{ 'User-Agent' = 'scope-compass-install' }
  # En una variable: PowerShell 5.1 pasa por el pipe el arreglo del JSON entero como un solo objeto.
  $list = Invoke-RestMethod -UseBasicParsing -Uri $api -Headers $ua
  $rel = $list |
    Where-Object { -not $_.draft -and ($Channel -eq 'beta' -or -not $_.prerelease) -and $_.tag_name -match '^v\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.tag_name.Substring(1) } -Descending | Select-Object -First 1
  if (-not $rel) {
    if ($Channel -eq 'stable') { throw "todavía no hay releases estables, solo pre-releases (versiones para probar). Para instalar una: `$env:SCOMPASS_CHANNEL = 'beta'; irm https://raw.githubusercontent.com/$Repo/main/tools/install.ps1 | iex" }
    throw "no encontré releases en $api"
  }
  $version = $rel.tag_name.Substring(1)
  $name = "scompass-v$version-windows-x64.exe"
  $asset = $rel.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
  $sums = $rel.assets | Where-Object { $_.name -eq 'SHA256SUMS' } | Select-Object -First 1
  if (-not $asset -or -not $sums) { throw "la release v$version no tiene $name y SHA256SUMS" }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "scompass-install-$PID"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $Exe = Join-Path $tmp $name
  Write-Output "Bajando Scope Compass $version$(if ($rel.prerelease) { ' (beta)' })…"
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $Exe -Headers $ua
  Invoke-WebRequest -UseBasicParsing -Uri $sums.browser_download_url -OutFile (Join-Path $tmp 'SHA256SUMS') -Headers $ua
  $want = Get-Content (Join-Path $tmp 'SHA256SUMS') | ForEach-Object { if ($_ -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($name))\s*$") { $Matches[1].ToLower() } } | Select-Object -First 1
  $got = (Get-FileHash -Algorithm SHA256 $Exe).Hash.ToLower()
  if (-not $want -or $got -ne $want) {
    Remove-Item -Recurse -Force $tmp
    throw "$name no coincide con SHA256SUMS (se esperaba $want, bajó $got): no se instaló nada"
  }
}

New-Item -ItemType Directory -Force $Dir | Out-Null
# Windows deja renombrar un .exe que está corriendo (no borrarlo ni pisarlo): el viejo se aparta y el Inicio que ya
# corre sigue con él hasta `scompass home restart`. El apartado de una vez anterior se borra si ya nadie lo usa.
$old = "$Bin.old"
Remove-Item $old -Force -ErrorAction SilentlyContinue
if (Test-Path $Bin) { Move-Item -Force $Bin $old }
Copy-Item $Exe $Bin
Unblock-File $Bin # sin la marca de "descargado de internet", SmartScreen no lo frena en cada arranque
if ($tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

Set-UserPath { param($parts) if ($parts | Where-Object { & $same $_ }) { $parts } else { $parts + $Dir } }

# La primera vez extrae su contenido y anota su ruta (scompass.json), para el dock de Godot y `scompass mcp install`.
& $Bin hubs | Out-Null
# Con beta, el binario sigue en ese canal al actualizarse (scompass upgrade y el Inicio, §39).
if ($Channel -eq 'beta') {
  & $Bin upgrade --channel beta | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Output 'Ojo: no se pudo anotar el canal beta; corré scompass upgrade --channel beta' }
}

# El ícono del acceso directo, el mismo de Linux y de la bandeja: el .ico que trae el binario, copiado al lado (la
# carpeta de la caché cambia con cada versión). Sin él, el acceso directo muestra el de Node.
$runtime = if ($env:SCOMPASS_RUNTIME_DIR) { $env:SCOMPASS_RUNTIME_DIR } else { Join-Path $env:LOCALAPPDATA 'scope-compass\runtime' }
$ico = Get-ChildItem -Path (Join-Path $runtime '*\assets\icons\scope-compass.ico') -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if ($ico) { Copy-Item -Force $ico (Join-Path $Dir 'scope-compass.ico') }

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($Lnk)
$s.TargetPath = $Bin
$s.Arguments = 'home --tray --open'
$s.WorkingDirectory = $Dir
$s.WindowStyle = 7 # la consola, minimizada: el Inicio se maneja desde la bandeja y el navegador
$s.Description = 'Inicio de Scope Compass con ícono en la bandeja'
if ($ico) { $s.IconLocation = (Join-Path $Dir 'scope-compass.ico') + ',0' }
$s.Save()

Write-Output "Listo: $Bin, en el PATH de tu usuario (en las consolas nuevas), y ""Scope Compass"" en el menú Inicio."
Write-Output "Se actualiza solo (scompass upgrade, o el aviso del Inicio): este instalador no hace falta de nuevo$(if ($Channel -eq 'beta') { '; queda en el canal beta (scompass upgrade --channel stable lo vuelve a stable)' })."
Remove-Item $old -Force -ErrorAction SilentlyContinue
if (Test-Path $old) { Write-Output 'El Inicio (o un hub) sigue abierto con la versión anterior: `scompass home restart` carga la nueva.' }

# Otro scompass antes en el PATH (por ejemplo, uno instalado con npm) taparía a este en las consolas.
$path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($d in $path -split ';' | Where-Object { $_ }) {
  $d = [Environment]::ExpandEnvironmentVariables($d)
  if (& $same $d) { break }
  $other = 'scompass.exe', 'scompass.cmd', 'scompass.ps1', 'scompass' | ForEach-Object { Join-Path $d $_ } | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
  if ($other) {
    Write-Output "Ojo: en una consola, ``scompass`` va a ser $other, que está antes en el PATH. Si es uno viejo de npm: npm uninstall -g scope-compass."
    break
  }
}
}
