# Ícono en la bandeja de Windows (D31): NotifyIcon de Windows Forms, manejado por el hub (tray-win.js) con JSON por
# líneas. Entra por stdin:
#   { type: 'set', icon?: <.ico en base64>, tooltip?, menu?: [nodo] }   nodo: { id, label, enabled, separator, children }
#   { type: 'dump' }            responde { type: 'dump', visible, tooltip, menu } con lo que armó (para los tests)
#   { type: 'invoke', id }      hace clic en ese ítem del menú (para los tests)
#   { type: 'show-menu' }       abre el menú junto al ícono (para revisarlo a mano)
# Sale por stdout: { type: 'ready' }, { type: 'click', id }, { type: 'activate' } (clic en el ícono) y
# { type: 'opening' } (se va a abrir el menú: el hub lo vuelve a evaluar y manda 'set' si cambió).
# Si se corta stdin (el hub se cerró o murió), saca el ícono y termina.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

function Send($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 20)); [Console]::Out.Flush() }

$ni = New-Object Windows.Forms.NotifyIcon
$strip = New-Object Windows.Forms.ContextMenuStrip
$ni.ContextMenuStrip = $strip
$ni.Add_MouseClick({ param($s, $e) if ($e.Button -eq [Windows.Forms.MouseButtons]::Left) { Send @{ type = 'activate' } } })
$strip.Add_Opening({ Send @{ type = 'opening' } })

function Build($nodes, $into) {
  $into.Clear()
  foreach ($n in @($nodes)) {
    if ($null -eq $n) { continue }
    if ($n.separator) { [void]$into.Add((New-Object Windows.Forms.ToolStripSeparator)); continue }
    $it = New-Object Windows.Forms.ToolStripMenuItem ([string]$n.label)
    $it.Enabled = [bool]$n.enabled
    $it.Tag = [int]$n.id
    if (@($n.children).Count -gt 0) { Build $n.children $it.DropDownItems }
    else { $it.Add_Click({ param($s, $e) Send @{ type = 'click'; id = $s.Tag } }) }
    [void]$into.Add($it)
  }
}

function Dump($items) {
  foreach ($it in $items) {
    if ($it -is [Windows.Forms.ToolStripSeparator]) { @{ separator = $true } }
    else { @{ id = $it.Tag; label = $it.Text; enabled = $it.Enabled; children = @(Dump $it.DropDownItems) } }
  }
}

function Find($items, $id) {
  foreach ($it in $items) {
    if ($it -is [Windows.Forms.ToolStripMenuItem]) {
      if ($it.Tag -eq $id) { return $it }
      $sub = Find $it.DropDownItems $id
      if ($sub) { return $sub }
    }
  }
}

function Handle($m) {
  switch ($m.type) {
    'set' {
      if ($m.icon) {
        $ms = New-Object IO.MemoryStream (, [Convert]::FromBase64String($m.icon))
        $ni.Icon = New-Object Drawing.Icon ($ms, [Windows.Forms.SystemInformation]::SmallIconSize)
      }
      # NotifyIcon.Text admite hasta 63 caracteres en .NET Framework.
      if ($null -ne $m.tooltip) { $t = [string]$m.tooltip; $ni.Text = $t.Substring(0, [Math]::Min(63, $t.Length)) }
      if ($null -ne $m.menu) { Build $m.menu $strip.Items }
      if (-not $ni.Visible) { $ni.Visible = $true; Send @{ type = 'ready' } }
    }
    'dump' { Send @{ type = 'dump'; visible = $ni.Visible; tooltip = $ni.Text; menu = @(Dump $strip.Items) } }
    'invoke' { $it = Find $strip.Items ([int]$m.id); if ($it) { $it.PerformClick() } }
    'show-menu' {
      $show = $ni.GetType().GetMethod('ShowContextMenu', [Reflection.BindingFlags]'NonPublic, Instance')
      [void]$show.Invoke($ni, $null)
    }
  }
}

# stdin se lee de a una línea, sin bloquear: un Timer del hilo de la interfaz mira si llegó la siguiente.
$in = New-Object IO.StreamReader ([Console]::OpenStandardInput(), $utf8)
$script:next = $in.ReadLineAsync()
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 25
$timer.Add_Tick({
  while ($script:next.IsCompleted) {
    $line = if ($script:next.IsFaulted) { $null } else { $script:next.Result }
    if ($null -eq $line) {
      $timer.Stop(); $ni.Visible = $false; $ni.Dispose(); [Windows.Forms.Application]::Exit(); return
    }
    $script:next = $in.ReadLineAsync()
    if ($line.Trim()) { Handle ($line | ConvertFrom-Json) }
  }
})
$timer.Start()
[Windows.Forms.Application]::Run()
