# Re-capture the Growth Center screenshots used on slide 3 (app must be running on http://localhost:3311).
# Then rebuild: python build_deck.py ; bash render.sh <preview-folder> 72
# gc_analyst.png is not captured here: a confirm card only appears after a real (paid) analyst message,
# so capture that view by hand at 1470x900 and save it as img\gc_analyst.png (adjust its crop in SHOTS).
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$img = Join-Path $PSScriptRoot "img"
$profile = Join-Path $env:TEMP "edge_shot_risa"
$shots = @(
    @("gc_home.png", "http://localhost:3311/?d=2025-03-29"),
    @("gc_diagnose.png", "http://localhost:3311/diagnose?d=2025-04-13")
)
foreach ($s in $shots) {
    $out = Join-Path $img $s[0]
    Start-Process -FilePath $edge -Wait -ArgumentList @("--headless", "--disable-gpu", "--hide-scrollbars",
        "--user-data-dir=$profile", "--window-size=1470,900", "--virtual-time-budget=10000", "--screenshot=$out", $s[1])
    Write-Output "captured $out"
}
