Set-Location $PSScriptRoot

while ($true) {
    $status = git status --porcelain
    if ($status) {
        git add .
        $time = Get-Date -Format "yyyy-MM-dd HH:mm"
        git commit -m "auto save $time"
        git push
    }
    Start-Sleep -Seconds 300
}
