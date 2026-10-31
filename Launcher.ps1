param(
    [ValidateSet('Install', 'Restore', 'Check')]
    [string]$Mode = 'Install',
    [string]$TermiusPath
)
function Get-TermiusRuntimeSource {
    param([string]$Executable)
    $source = $Executable
    $directory = Split-Path -Parent $Executable
    $activeFile = Join-Path $directory 'claude-theme-backup\active.json'
    if (Test-Path -LiteralPath $activeFile) {
        $state = Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $currentHash = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash
        $sameVersion = $currentHash -ieq $state.original.exe -or $currentHash -ieq $state.patched.exe
        if ($sameVersion -and $state.id -match '^[a-f0-9]{64}$') {
            $original = Join-Path $directory ('claude-theme-backup\' + $state.id + '\exe.original')
            if ((Test-Path -LiteralPath $original) -and
                ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ieq $state.original.exe)) {
                $source = $original
            }
        }
    }
    return $source
}

$ErrorActionPreference = 'Stop'
$runnerDirectory = $null
$resultCode = 1

try {
    if (-not $TermiusPath) {
        $candidates = @(
            (Join-Path $env:LOCALAPPDATA 'Programs\Termius\Termius.exe'),
            (Join-Path $env:LOCALAPPDATA 'Termius\Termius.exe'),
            (Join-Path $env:ProgramFiles 'Termius\Termius.exe')
        )
        if (${env:ProgramFiles(x86)}) {
            $candidates += Join-Path ${env:ProgramFiles(x86)} 'Termius\Termius.exe'
        }
        $existing = @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique)
        if ($existing.Count -eq 1) {
            $TermiusPath = $existing[0]
        } else {
            Add-Type -AssemblyName System.Windows.Forms
            $picker = New-Object System.Windows.Forms.OpenFileDialog
            $picker.Title = '请选择当前使用的 Termius.exe'
            $picker.Filter = 'Termius executable (Termius.exe)|Termius.exe'
            if ($existing.Count -gt 0) { $picker.InitialDirectory = Split-Path -Parent $existing[0] }
            try {
                if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
                    throw '已取消，未修改安装文件。'
                }
                $TermiusPath = $picker.FileName
            } finally { $picker.Dispose() }
        }
    }
    $TermiusPath = (Resolve-Path -LiteralPath $TermiusPath).ProviderPath
    if ([IO.Path]::GetFileName($TermiusPath) -ine 'Termius.exe') { throw '请选择 Termius.exe。' }
    $appDirectory = Split-Path -Parent $TermiusPath
    if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'resources\app.asar'))) {
        throw '没有找到 resources\app.asar；这不是支持的 Termius 安装目录。'
    }
    if (Get-Process -Name 'Termius' -ErrorAction SilentlyContinue) {
        throw '请先完全退出 Termius（包括系统托盘），再重新双击运行。不会自动关闭你的会话。'
    }

    Write-Host 'Claude for Termius / Windows' -ForegroundColor DarkYellow
    Write-Host ('目标：' + $TermiusPath)
    if ($Mode -eq 'Install') {
        Write-Host '将替换两项主题预设，并同步修改 app.asar 与 EXE 中的校验值。'
        Write-Host '这是非官方本地补丁；原数字签名将不再匹配。原文件会自动备份，可恢复。'
    }

    $runner = $null
    $node = Get-Command 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($node) {
        $major = & $node.Source -p 'parseInt(process.versions.node)'
        if ($LASTEXITCODE -eq 0 -and [int]$major -ge 16) { $runner = $node.Source }
    }
    if (-not $runner) {
        # Use the user's existing, signed runtime from a temporary copy, so the
        # executable being updated is not locked by the installer process.
        $runtimeSource = Get-TermiusRuntimeSource $TermiusPath
        $runnerDirectory = Join-Path ([IO.Path]::GetTempPath()) ('Termius-Claude-Runner-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $runnerDirectory | Out-Null
        $runner = Join-Path $runnerDirectory 'Termius.exe'
        Copy-Item -LiteralPath $runtimeSource -Destination $runner
        Get-ChildItem -LiteralPath $appDirectory -File |
            Where-Object { $_.Extension -in @('.dll', '.dat', '.bin', '.pak') } |
            ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $runnerDirectory }
    }
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:NODE_OPTIONS = $null
    $patchScript = Join-Path $PSScriptRoot 'theme-patch.cjs'
    $nativeOutput = & $runner $patchScript $Mode.ToLowerInvariant() $appDirectory 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($nativeOutput -join [Environment]::NewLine) }
    $details = ($nativeOutput -join [Environment]::NewLine) | ConvertFrom-Json
    if ($details.status -eq 'restored') {
        Write-Host '已恢复原始安装文件。打开 Termius 后可重新选择 Flexoki Light / Dark。' -ForegroundColor Green
    } elseif ($details.status -eq 'compatible') {
        Write-Host '兼容性检查通过。未修改安装文件。' -ForegroundColor Green
    } else {
        Write-Host '安装完成。打开 Termius，在终端主题列表选择 Claude Light 或 Claude Dark。' -ForegroundColor Green
        Write-Host '运行服务器上的 Claude Code 后，用 /theme 选择对应的 Light 或 Dark。'
    }
    $resultCode = 0
} catch {
    Write-Host ('未完成：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '如果提示拒绝访问，请右键安装入口，选择“以管理员身份运行”。'
} finally {
    if ($runnerDirectory -and (Test-Path -LiteralPath $runnerDirectory)) {
        Remove-Item -LiteralPath $runnerDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit $resultCode
