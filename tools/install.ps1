# Instala Scope Compass en Windows (la opción instalable; la portable es usar el .exe donde esté, ver docs/instalar.md):
# copia el binario a %LOCALAPPDATA%\Programs\scompass\scompass.exe, suma esa carpeta al PATH del usuario y deja
# "Scope Compass" en el menú Inicio, que levanta el Inicio con ícono en la bandeja y lo abre en el navegador. No pide
# permisos de administrador.
#   powershell -ExecutionPolicy Bypass -File install.ps1 [archivo]   el scompass-v<versión>-windows-x64.exe; sin
#                                                                    argumento, el más nuevo al lado de este script o
#                                                                    en dist/
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall  saca el binario, el acceso directo y la carpeta
#                                                                    del PATH (los tableros y la caché quedan)
param([string]$Exe, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:LOCALAPPDATA 'Programs\scompass'
$Bin = Join-Path $Dir 'scompass.exe'
$Lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Scope Compass.lnk'

# El PATH del usuario se lee y se escribe en el registro tal cual, sin expandir: [Environment]::SetEnvironmentVariable
# lo guardaría expandido y como REG_SZ, y las entradas con %USERPROFILE% dejarían de seguir a la variable.
function Set-UserPath([scriptblock]$change) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $old = $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  $parts = @($old -split ';' | Where-Object { $_ })
  $new = (& $change $parts) -join ';'
  if ($new -ne $old) { $key.SetValue('Path', $new, 'ExpandString') }
  $key.Close()
  # Avisa a Windows (WM_SETTINGCHANGE) para que las consolas nuevas vean el PATH sin cerrar sesión.
  Add-Type -Namespace ScopeCompass -Name Env -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, UIntPtr w, string l, uint flags, uint timeout, out UIntPtr result);'
  $r = [UIntPtr]::Zero
  [void][ScopeCompass.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)
}
$same = { param($p) $p.TrimEnd('\') -ieq $Dir }

if ($Uninstall) {
  Remove-Item $Lnk -ErrorAction SilentlyContinue
  Set-UserPath { param($parts) $parts | Where-Object { -not (& $same $_) } }
  try { Remove-Item -Recurse -Force $Dir -ErrorAction Stop }
  catch { Write-Error "no pude borrar $Dir (¿el Inicio o un hub siguen corriendo? cerralos y volvé a correr con -Uninstall): $_" }
  # La ruta anotada (§37), si es la de este binario: el dock no buscaría uno que ya no está.
  $self = Join-Path $env:LOCALAPPDATA 'scope-compass\scompass.json'
  if ((Test-Path $self) -and (Get-Content $self -Raw | ConvertFrom-Json).command -ieq $Bin) { Remove-Item $self }
  Write-Output "Listo: sin $Bin, sin el acceso directo y sin $Dir en el PATH."
  Write-Output "Los tableros no se tocan. La caché del binario ($(Join-Path $env:LOCALAPPDATA 'scope-compass\runtime')) se puede borrar a mano."
  exit 0
}

if (-not $Exe) {
  $Exe = Get-ChildItem -Path $PSScriptRoot, (Join-Path $PSScriptRoot '..\dist') -Filter 'scompass-v*-windows-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Exe -or -not (Test-Path $Exe -PathType Leaf)) {
  Write-Error "no encuentro el binario (scompass-v<versión>-windows-x64.exe): pasá su ruta, o ponelo al lado de este script"
}

New-Item -ItemType Directory -Force $Dir | Out-Null
# Windows deja renombrar un .exe que está corriendo (no borrarlo ni pisarlo): el viejo se aparta y el Inicio que ya
# corre sigue con él hasta `scompass home restart`. El apartado de una vez anterior se borra si ya nadie lo usa.
$old = "$Bin.old"
Remove-Item $old -Force -ErrorAction SilentlyContinue
if (Test-Path $Bin) { Move-Item -Force $Bin $old }
Copy-Item $Exe $Bin
Unblock-File $Bin # sin la marca de "descargado de internet", SmartScreen no lo frena en cada arranque

Set-UserPath { param($parts) if ($parts | Where-Object { & $same $_ }) { $parts } else { $parts + $Dir } }

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($Lnk)
$s.TargetPath = $Bin
$s.Arguments = 'home --tray --open'
$s.WorkingDirectory = $Dir
$s.WindowStyle = 7 # la consola, minimizada: el Inicio se maneja desde la bandeja y el navegador
$s.Description = 'Inicio de Scope Compass con ícono en la bandeja'
$s.Save()

# La primera vez extrae su contenido y anota su ruta (scompass.json), para el dock de Godot y `scompass mcp install`.
& $Bin hubs | Out-Null
Write-Output "Listo: $Bin, en el PATH de tu usuario (en las consolas nuevas), y ""Scope Compass"" en el menú Inicio."
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
