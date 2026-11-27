param(
    [Parameter(Position = 0)][string]$Apk,
    [Parameter(Position = 1)][string]$OutDir = 'apk-triage-out'
)

# apk-triage.ps1 - быстрый триаж APK под Windows.
# Ничего не расшифровывает: только описывает то, что видно в файле.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$script:Lines = New-Object 'System.Collections.Generic.List[string]'

function Say {
    param([string]$Text)
    Write-Host $Text
    $script:Lines.Add($Text) | Out-Null
}

function H {
    param([string]$Text)
    Say ''
    Say ('== ' + $Text + ' ==')
}

function Get-Head {
    param([string]$Name, [int]$Count)
    $e = $zip.GetEntry($Name)
    if (-not $e) { return $null }
    $s = $e.Open()
    try {
        $buf = New-Object 'byte[]' $Count
        $n = $s.Read($buf, 0, $Count)
        if ($n -le 0) { return $null }
        if ($n -lt $Count) { return [byte[]]$buf[0..($n - 1)] }
        return [byte[]]$buf
    } finally { $s.Dispose() }
}

function Get-Entropy {
    param([byte[]]$Bytes)
    if (-not $Bytes -or $Bytes.Length -eq 0) { return 0 }
    $freq = New-Object 'int[]' 256
    foreach ($b in $Bytes) { $freq[$b] = $freq[$b] + 1 }
    $n = $Bytes.Length
    $h = 0.0
    for ($i = 0; $i -lt 256; $i++) {
        if ($freq[$i] -gt 0) {
            $p = $freq[$i] / $n
            $h = $h - ($p * [Math]::Log($p, 2))
        }
    }
    return $h
}

if (-not $Apk) {
    Write-Host 'Как пользоваться: apk-triage.bat app.apk [каталог-отчёта]'
    exit 64
}
if (-not (Test-Path -LiteralPath $Apk)) {
    Write-Host ('Нет такого файла: ' + $Apk)
    exit 66
}

$full = (Resolve-Path -LiteralPath $Apk).Path
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = $null
try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($full)
} catch {
    Write-Host 'ОШИБКА: файл не открывается как ZIP. Он битый или это не APK.'
    exit 65
}

$entries = @($zip.Entries)
$names = @($entries | ForEach-Object { $_.FullName })

H 'файл'
$item = Get-Item -LiteralPath $full
Say ('путь:    ' + $full)
Say ('размер:  {0} байт ({1:N1} МБ)' -f $item.Length, ($item.Length / 1MB))
Say ('sha256:  ' + (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash)
Say 'zip:     корректен'
Say ('файлов:  ' + $entries.Count)

H 'состав'
$dex = @($names | Where-Object { $_ -match '^classes[0-9]*\.dex$' })
Say ('dex:     ' + $dex.Count + ' шт. ' + ($dex -join ' '))
if ($names -contains 'AndroidManifest.xml') { Say 'манифест: есть' } else { Say 'манифест: НЕТ' }
Say ('ресурсы:  ' + @($names | Where-Object { $_ -like 'res/*' }).Count + ' файлов')
Say ('assets:   ' + @($names | Where-Object { $_ -like 'assets/*' }).Count + ' файлов')

$abis = @($names | Where-Object { $_ -match '^lib/[^/]+/' } | ForEach-Object { ($_ -split '/')[1] } | Sort-Object -Unique)
if ($abis.Count -gt 0) { Say ('ABI:      ' + ($abis -join ' ')) } else { Say 'ABI:      нет нативных библиотек' }

$sos = @($names | Where-Object { $_ -match '^lib/.+/[^/]+\.so$' })
$libs = @($sos | ForEach-Object { ($_ -split '/')[-1] } | Sort-Object -Unique)
if ($libs.Count -gt 0) { Say ('libs:     ' + ($libs -join ' ')) } else { Say 'libs:     -' }

H 'крупнейшие файлы'
$entries | Sort-Object Length -Descending | Select-Object -First 8 | ForEach-Object {
    Say ('  {0,8:N2} МБ  {1}' -f ($_.Length / 1MB), $_.FullName)
}

H 'движок'
$engine = 'не определён'
if ($names -match '^lib/[^/]+/libil2cpp\.so$') { $engine = 'Unity (IL2CPP)' }
elseif ($names -match '^assets/bin/Data/Managed/.+\.dll$') { $engine = 'Unity (Mono)' }
elseif ($names -match '^lib/[^/]+/lib(UE4|Unreal)\.so$') { $engine = 'Unreal Engine' }
elseif ($names -match '^lib/[^/]+/libgodot_android\.so$') { $engine = 'Godot' }
elseif ($names -match '^lib/[^/]+/libflutter\.so$') { $engine = 'Flutter' }
elseif ($names -match 'libreactnativejni\.so$') { $engine = 'React Native' }
elseif ($names -contains 'assets/www/index.html') { $engine = 'Cordova / WebView' }
Say ('движок:  ' + $engine)

H 'признаки защиты'
$protect = 0

$mh = Get-Head 'AndroidManifest.xml' 2
if ($mh -and $mh.Length -eq 2) {
    $type = [BitConverter]::ToUInt16($mh, 0)
    if ($type -eq 3) { Say 'манифест: бинарный AXML (норма)' }
    else { Say ('манифест: тип 0x{0:x} - не AXML, возможно переупакован' -f $type) }
}

$gm = 'assets/bin/Data/Managed/Metadata/global-metadata.dat'
if ($zip.GetEntry($gm)) {
    $head = Get-Head $gm 4
    if ($head -and $head.Length -eq 4) {
        $magic = [BitConverter]::ToUInt32($head, 0)
        Say ('metadata: магия 0x{0:x8} (должна быть 0xfab11baf)' -f $magic)
        if ($magic -eq 0xfab11baf) {
            Say 'metadata: НЕ зашифрованы - Il2CppDumper справится'
        } else {
            Say 'metadata: ЗАШИФРОВАНЫ - статически не читаются'
            $protect = 1
        }
    }
    Say 'энтропия metadata по 1 МБ (8.00 = шифр):'
    $e = $zip.GetEntry($gm)
    $s = $e.Open()
    try {
        $buffer = New-Object 'byte[]' 1048576
        $offset = 0
        while ($true) {
            $read = $s.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $chunk = $buffer
            if ($read -lt $buffer.Length) { $chunk = [byte[]]$buffer[0..($read - 1)] }
            Say ('  {0,6:N1} МБ  {1:N2}' -f ($offset / 1MB), (Get-Entropy $chunk))
            $offset = $offset + $read
        }
    } finally { $s.Dispose() }
}

if ($sos.Count -gt 0) {
    Say 'нативные библиотеки (энтропия первых 4 МБ):'
    foreach ($so in $sos) {
        $e = $zip.GetEntry($so)
        $s = $e.Open()
        try {
            $want = [int][Math]::Min(4194304, $e.Length)
            $buf = New-Object 'byte[]' $want
            $n = $s.Read($buf, 0, $want)
            if ($n -lt $want) { $buf = [byte[]]$buf[0..($n - 1)] }
            $h = Get-Entropy $buf
            $flag = ''
            if ($h -gt 7.9) { $flag = '  <- похоже на упаковку'; $protect = 1 }
            Say ('  {0,-32} {1,8:N1} КБ  {2:N2}{3}' -f ($so -split '/')[-1], ($e.Length / 1KB), $h, $flag)
        } finally { $s.Dispose() }
    }
}

# известные упаковщики — узнаются по именам нативных библиотек
$packers = [ordered]@{
    'libjiagu'         = '360 jiagu'
    'libsecexe'        = 'Bangcle'
    'libsecmain'       = 'Bangcle'
    'libshella'        = 'Bangcle / Tencent Legu'
    'libshellx'        = 'Bangcle / Tencent Legu'
    'libDexHelper'     = 'DexHelper'
    'libchaosvmp'      = 'Nagain'
    'libddog'          = 'Nagain'
    'libmobisec'       = 'Alibaba'
    'libexecmain'      = 'Tencent Legu'
    'libtosprotection' = 'Tencent'
    'libDexProtector'  = 'DexProtector'
    'libbaiduprotect'  = 'Baidu'
    'libprotectClass'  = 'Baidu'
}
$hits = @()
foreach ($mark in $packers.Keys) {
    if ($sos -match $mark) { $hits += ($mark + ' -> ' + $packers[$mark]); $protect = 1 }
}
if ($hits.Count -gt 0) {
    Say 'упаковщик по именам библиотек:'
    foreach ($hit in $hits) { Say ('  ' + $hit) }
} else {
    Say 'известных упаковщиков (360/Bangcle/Legu/Nagain/Baidu) не видно'
}

H 'вердикт'
if ($protect -eq 1) {
    Say 'Файл защищён: часть данных зашифрована. Статический разбор остановится на'
    Say 'описании структуры; расшифровка возможна только в памяти процесса.'
} else {
    Say 'Явных признаков упаковки/шифрования нет: файл читается статически.'
}

$zip.Dispose()

$reportPath = [System.IO.Path]::GetFullPath((Join-Path $OutDir 'triage.txt'))
[System.IO.File]::WriteAllLines($reportPath, $script:Lines, (New-Object System.Text.UTF8Encoding($true)))
Say ''
Say ('отчёт: ' + $reportPath)
