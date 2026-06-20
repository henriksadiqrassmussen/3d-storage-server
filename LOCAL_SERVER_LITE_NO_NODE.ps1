# 3D Storage Local Server Lite LAN - no Node.js required
# Works from Android on same Wi-Fi because it listens on 0.0.0.0:3000
# Endpoints:
# GET  /health
# GET  /api/files    also /files
# POST /api/upload   also /upload
# GET  /download/<filename>

$ErrorActionPreference = "Stop"
$port = 3000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$uploads = Join-Path $root "uploads"
New-Item -ItemType Directory -Force -Path $uploads | Out-Null
$latin1 = [System.Text.Encoding]::GetEncoding("iso-8859-1")
$utf8 = [System.Text.Encoding]::UTF8

function Write-Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $msg"
}

function Get-LocalIPv4List {
    $ips = @()
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -ExpandProperty IPAddress
    } catch {}
    if (!$ips -or $ips.Count -eq 0) {
        try {
            $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -notlike '127.*' } |
                ForEach-Object { $_.ToString() }
        } catch {}
    }
    return $ips
}

function Send-Response($stream, [int]$code, [string]$status, [byte[]]$body, [string]$contentType="text/plain; charset=utf-8", [hashtable]$extraHeaders=$null) {
    if ($null -eq $body) { $body = [byte[]]@() }
    $headers = "HTTP/1.1 $code $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n"
    if ($extraHeaders) {
        foreach ($k in $extraHeaders.Keys) { $headers += "${k}: $($extraHeaders[$k])`r`n" }
    }
    $headers += "`r`n"
    $hb = $utf8.GetBytes($headers)
    $stream.Write($hb,0,$hb.Length)
    if ($body.Length -gt 0) { $stream.Write($body,0,$body.Length) }
}

function Send-Text($stream, [int]$code, [string]$status, [string]$text, [string]$type="text/plain; charset=utf-8") {
    Send-Response $stream $code $status ($utf8.GetBytes($text)) $type
}

function Find-Bytes([byte[]]$data, [byte[]]$pattern, [int]$start=0) {
    if ($null -eq $data -or $null -eq $pattern -or $pattern.Length -eq 0) { return -1 }
    for ($i=$start; $i -le $data.Length - $pattern.Length; $i++) {
        $ok = $true
        for ($j=0; $j -lt $pattern.Length; $j++) {
            if ($data[$i+$j] -ne $pattern[$j]) { $ok = $false; break }
        }
        if ($ok) { return $i }
    }
    return -1
}

function Read-HttpRequest($stream) {
    $buffer = New-Object byte[] 65536
    $all = New-Object System.Collections.Generic.List[byte]
    $headerEnd = -1
    $needle = [byte[]](13,10,13,10)

    while ($headerEnd -lt 0) {
        $n = $stream.Read($buffer,0,$buffer.Length)
        if ($n -le 0) { break }
        for ($i=0; $i -lt $n; $i++) { $all.Add($buffer[$i]) }
        $arr = $all.ToArray()
        $headerEnd = Find-Bytes $arr $needle 0
        if ($all.Count -gt 1024*1024*2) { throw "HTTP header too large" }
    }

    $bytes = $all.ToArray()
    if ($headerEnd -lt 0) { throw "Bad HTTP request" }
    $headerText = $latin1.GetString($bytes,0,$headerEnd)
    $lines = $headerText -split "`r`n"
    $first = $lines[0] -split " "
    $method = $first[0]
    $url = $first[1]
    $headers = @{}
    for ($i=1; $i -lt $lines.Count; $i++) {
        $p = $lines[$i].IndexOf(':')
        if ($p -gt 0) {
            $headers[$lines[$i].Substring(0,$p).Trim().ToLower()] = $lines[$i].Substring($p+1).Trim()
        }
    }

    $bodyStart = $headerEnd + 4
    $contentLength = 0
    if ($headers.ContainsKey('content-length')) { [int]::TryParse($headers['content-length'], [ref]$contentLength) | Out-Null }
    $body = New-Object byte[] $contentLength
    $already = [Math]::Max(0, $bytes.Length - $bodyStart)
    if ($already -gt 0) {
        [Array]::Copy($bytes, $bodyStart, $body, 0, [Math]::Min($already,$contentLength))
    }
    $offset = [Math]::Min($already,$contentLength)
    while ($offset -lt $contentLength) {
        $n = $stream.Read($body,$offset,$contentLength-$offset)
        if ($n -le 0) { break }
        $offset += $n
    }

    return @{ Method=$method; Url=$url; Headers=$headers; Body=$body }
}

function Get-SafeFileNameFromMultipart([string]$bodyText) {
    $name = "upload_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".bin"
    if ($bodyText -match 'filename="([^"]+)"') { $name = [System.IO.Path]::GetFileName($matches[1]) }
    return ($name -replace '[\\/:*?"<>|]', '_')
}

function Save-MultipartUpload($stream, $req) {
    $ct = $req.Headers['content-type']
    if (!$ct -or !$ct.Contains('boundary=')) {
        Send-Text $stream 400 "Bad Request" "Missing multipart boundary"
        return
    }
    $boundary = "--" + (($ct -split "boundary=",2)[1].Trim('"'))
    $bodyText = $latin1.GetString($req.Body)
    $safeName = Get-SafeFileNameFromMultipart $bodyText

    $headerSep = "`r`n`r`n"
    $dataStart = $bodyText.IndexOf($headerSep)
    if ($dataStart -lt 0) { Send-Text $stream 400 "Bad Request" "Bad multipart data"; return }
    $dataStart += 4
    $endMarker = "`r`n" + $boundary
    $dataEnd = $bodyText.IndexOf($endMarker, $dataStart)
    if ($dataEnd -lt 0) { $dataEnd = $bodyText.Length }
    $fileText = $bodyText.Substring($dataStart, $dataEnd - $dataStart)
    $fileBytes = $latin1.GetBytes($fileText)

    $target = Join-Path $uploads $safeName
    [System.IO.File]::WriteAllBytes($target, $fileBytes)
    Write-Log "Modtog fil: $safeName ($($fileBytes.Length) bytes)"
    Send-Text $stream 200 "OK" "{`"ok`":true,`"filename`":`"$safeName`",`"size`":$($fileBytes.Length)}" "application/json; charset=utf-8"
}

function Send-FileList($stream) {
    $items = Get-ChildItem $uploads -File | Sort-Object LastWriteTime -Descending | ForEach-Object {
        "{`"name`":`"$($_.Name)`",`"size`":$($_.Length),`"modified`":`"$($_.LastWriteTime.ToString('s'))`"}"
    }
    Send-Text $stream 200 "OK" "[`n$($items -join ",`n")`n]" "application/json; charset=utf-8"
}

function Send-Download($stream, [string]$name) {
    $safe = [System.IO.Path]::GetFileName([System.Uri]::UnescapeDataString($name))
    $path = Join-Path $uploads $safe
    if (!(Test-Path $path)) { Send-Text $stream 404 "Not Found" "File not found"; return }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $extra = @{ "Content-Disposition" = "attachment; filename=$safe" }
    Send-Response $stream 200 "OK" $bytes "application/octet-stream" $extra
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
try {
    $listener.Start()
} catch {
    Write-Host "FEJL: Kunne ikke starte server paa port $port"
    Write-Host "Luk andre server-vinduer, eller genstart PC'en. Fejl: $($_.Exception.Message)"
    Read-Host "Tryk ENTER for at lukke"
    exit 1
}

Write-Host "=================================================="
Write-Host "  3D Storage Local Server Lite LAN - NO NODE"
Write-Host "=================================================="
Write-Host "PC lokalt:       http://localhost:$port"
Write-Host "Health lokalt:   http://localhost:$port/health"
Write-Host "Uploads mappe:   $uploads"
Write-Host ""
Write-Host "Brug denne adresse paa Android hvis telefon og PC er paa samme Wi-Fi:"
$ips = Get-LocalIPv4List
foreach ($ip in $ips) { Write-Host "  http://$ip`:$port" }
Write-Host ""
Write-Host "VIGTIGT: Hvis Android ikke kan forbinde, tillad PowerShell/port 3000 i Windows Firewall paa Privat netvaerk."
Write-Host "Lad vinduet vaere aabent. Stop med CTRL+C."
Write-Host ""

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $req = Read-HttpRequest $stream
        $path = ([System.Uri]::new("http://dummy" + $req.Url)).AbsolutePath
        Write-Log "$($req.Method) $path"

        if ($req.Method -eq 'OPTIONS') {
            Send-Text $stream 204 "No Content" ""
        }
        elseif ($req.Method -eq 'GET' -and $path -eq '/health') {
            Send-Text $stream 200 "OK" "{`"ok`":true,`"server`":`"3d-storage-local-lite-lan`",`"version`":`"0.1.8`"}" "application/json; charset=utf-8"
        }
        elseif ($req.Method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
            Send-Text $stream 200 "OK" "3D Storage Local Server Lite LAN is running. Use /health, /api/files, /api/upload."
        }
        elseif ($req.Method -eq 'GET' -and ($path -eq '/api/files' -or $path -eq '/files')) {
            Send-FileList $stream
        }
        elseif ($req.Method -eq 'POST' -and ($path -eq '/api/upload' -or $path -eq '/upload')) {
            Save-MultipartUpload $stream $req
        }
        elseif ($req.Method -eq 'GET' -and $path.StartsWith('/download/')) {
            Send-Download $stream ($path.Substring('/download/'.Length))
        }
        else {
            Send-Text $stream 404 "Not Found" "Not found: $path"
        }
    } catch {
        try { if ($stream) { Send-Text $stream 500 "Server Error" ("Server error: " + $_.Exception.Message) } } catch {}
        Write-Log "FEJL: $($_.Exception.Message)"
    } finally {
        if ($client) { $client.Close() }
    }
}
