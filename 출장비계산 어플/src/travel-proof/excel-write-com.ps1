param(
  [Parameter(Mandatory = $true)]
  [string]$InputJson
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not ("ExcelWindowProcess" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ExcelWindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
}

function Decode-Utf8Base64($value) {
  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
}

$FIELD_ITEM_FUEL = Decode-Utf8Base64 "7Jyg66WY64yA"
$FIELD_ITEM_ACTIVITY = Decode-Utf8Base64 "7Zmc64+Z67mE"
$FIELD_ITEM_TOLL_PREFIX = Decode-Utf8Base64 "7Ya17ZaJ66OM"
# 정산월 표기용 한글 (인코딩 안전을 위해 base64로 보관)
$SETTLEMENT_SUFFIX = Decode-Utf8Base64 "7JuUIOygleyCsOq4iOyVoQ=="  # "월 정산금액"
$YEAR_SUFFIX = Decode-Utf8Base64 "64WEIA=="                          # "년 "
$MONTH_SUFFIX = Decode-Utf8Base64 "7JuU"                             # "월"
$PROOF_SHEET_NAME = Decode-Utf8Base64 "7Kad67mZ"
$PROOF_FONT_NAME = Decode-Utf8Base64 "66eR7J2AIOqzoOuUlQ=="
$PROOF_UNMATCHED_PREFIX = Decode-Utf8Base64 "64Kg7Kec66W8IO2ZleyduO2VmOyngCDrqrvtlbQg67Cw7LmY65CY7KeAIOyViuydgCDspp3ruZkg"
$PROOF_UNMATCHED_SUFFIX = Decode-Utf8Base64 "6rCc6rCAIOyeiOyKteuLiOuLpC4="
$PROOF_EMPTY_MESSAGE = Decode-Utf8Base64 "7ISg7YOd7ZWcIOyblOydmCDspp3ruZnsnpDro4zqsIAg7JeG7Iq164uI64ukLg=="

function ConvertTo-PlainText($value) {
  if ($null -eq $value) { return "" }
  return [string]$value
}

function ConvertTo-Amount($value) {
  if ($null -eq $value) { return 0 }
  $text = ([string]$value) -replace "[^0-9-]", ""
  if ([string]::IsNullOrWhiteSpace($text)) { return 0 }
  return [int]$text
}

function ConvertTo-ExcelDate($value) {
  $text = ConvertTo-PlainText $value
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  try {
    return [datetime]::ParseExact($text, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
  } catch {
    return $text
  }
}

function Invoke-ExcelCom($scriptBlock, $label) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
      return & $scriptBlock
    } catch {
      $lastError = $_
      $message = $_.Exception.Message
      $hresult = $_.Exception.HResult
      if ($message -notmatch "0x800AC472" -and $hresult -ne -2146777998) {
        throw
      }
      Start-Sleep -Milliseconds (150 + ($attempt * 40))
    }
  }
  throw "$label failed after retries: $($lastError.Exception.Message)"
}

function Get-ExcelApplication {
  try {
    return New-Object -ComObject Excel.Application
  } catch {
    $message = $_.Exception.Message
    $hresult = $_.Exception.HResult
    if ($hresult -eq -2147221164 -or $message -match "80040154|REGDB_E_CLASSNOTREG|Class not registered") {
      throw "Microsoft Excel 데스크톱 앱이 설치되어 있지 않거나 Excel COM 등록이 깨져 있습니다. Microsoft 365/Office의 Excel을 설치하거나 Office 빠른 복구를 실행한 뒤 다시 시도해 주세요. Excel 웹, Excel Viewer, WPS만으로는 지출결의서 직접 작성 기능을 사용할 수 없습니다."
    }
    throw
  }
}

function Get-ExcelProcessId($excelApplication) {
  try {
    [uint32]$processId = 0
    [ExcelWindowProcess]::GetWindowThreadProcessId([IntPtr]$excelApplication.Hwnd, [ref]$processId) | Out-Null
    return [int]$processId
  } catch {
    return 0
  }
}

function Get-WorksheetByIndex($workbook, $index) {
  if ($workbook.Worksheets.Count -lt $index) {
    throw "Sheet index not found: $index"
  }
  $sheet = $workbook.Worksheets.Item($index)
  Write-Output -NoEnumerate $sheet
}

function Clear-DetailCells($sheet, $startRow, $columns) {
  $used = $sheet.UsedRange
  $lastRow = [Math]::Max($startRow, $used.Row + $used.Rows.Count - 1)
  for ($row = $startRow; $row -le $lastRow; $row++) {
    foreach ($column in $columns) {
      try {
        Invoke-ExcelCom { $sheet.Cells.Item($row, $column).ClearContents() | Out-Null } "Clear cell"
      } catch {
      }
    }
  }
}

function Set-CellValue($sheet, $row, $column, $value) {
  if ($null -eq $sheet) {
    throw "Worksheet is null for row=$row col=$column"
  }
  $cell = $sheet.Cells.Item($row, $column)
  $target = $cell
  $isMerged = $false
  try { $isMerged = [bool]$cell.MergeCells } catch { $isMerged = $false }
  if ($isMerged) {
    try {
      $target = $cell.MergeArea.Cells.Item(1, 1)
    } catch {
      $target = $cell
    }
  }
  try {
    Invoke-ExcelCom { $target.HorizontalAlignment = -4108 } "Cell horizontal align"
    Invoke-ExcelCom { $target.VerticalAlignment = -4108 } "Cell vertical align"
  } catch {
  }
  try {
    Invoke-ExcelCom { $target.Value = $value } "Cell value write"
  } catch {
    try {
      Invoke-ExcelCom { $target.Formula = ConvertTo-PlainText $value } "Cell formula write"
    } catch {
      $address = ""
      try { $address = $target.Address($false, $false) } catch { $address = "unknown" }
      $valueType = if ($null -eq $value) { "null" } else { $value.GetType().FullName }
      throw "Cell write failed at row=$row col=$column address=$address valueType=$valueType value=$value : $($_.Exception.Message)"
    }
  }
}

function Normalize-FieldVisitRows($rows) {
  return @($rows) | Sort-Object @{ Expression = { ConvertTo-PlainText $_.dateKey } }, @{ Expression = {
    $item = ConvertTo-PlainText $_.item
    if ($item -eq $script:FIELD_ITEM_FUEL) { 1 }
    elseif ($item -eq $script:FIELD_ITEM_ACTIVITY) { 2 }
    elseif ($item.StartsWith($script:FIELD_ITEM_TOLL_PREFIX)) { 3 }
    else { 9 }
  }}
}

function Write-TravelRows($sheet, $startRow, $rows) {
  Clear-DetailCells $sheet $startRow @(2, 3, 4, 6, 8, 9, 10)
  $index = 1
  foreach ($entry in @($rows)) {
    $row = $startRow + $index - 1
    Set-CellValue $sheet $row 2 $index
    Set-CellValue $sheet $row 3 (ConvertTo-ExcelDate $entry.dateKey)
    Set-CellValue $sheet $row 4 (ConvertTo-PlainText $entry.item)
    Set-CellValue $sheet $row 6 (ConvertTo-PlainText $entry.place)
    Set-CellValue $sheet $row 8 (ConvertTo-Amount $entry.amountWon)
    Set-CellValue $sheet $row 9 (ConvertTo-PlainText $entry.summary)
    Set-CellValue $sheet $row 10 (ConvertTo-PlainText $entry.note)
    $index++
  }
}

function Write-FieldVisitRows($sheet, $startRow, $rows) {
  Clear-DetailCells $sheet $startRow @(2, 3, 4, 6, 8, 9, 10)
  $sortedRows = Normalize-FieldVisitRows $rows
  $row = $startRow
  $index = 1
  $currentDate = ""
  $isFirstForDate = $true

  foreach ($entry in @($sortedRows)) {
    $dateKey = ConvertTo-PlainText $entry.dateKey
    if ($currentDate -ne "" -and $dateKey -ne $currentDate) {
      for ($gapIndex = 0; $gapIndex -lt 2; $gapIndex++) {
        Set-CellValue $sheet $row 2 $index
        $row++
        $index++
      }
      $isFirstForDate = $true
    }
    $currentDate = $dateKey

    $item = ConvertTo-PlainText $entry.item
    $summary = if ($isFirstForDate) { ConvertTo-PlainText $entry.summary } else { '"' }
    $note = ConvertTo-PlainText $entry.note
    if ($item -eq $script:FIELD_ITEM_ACTIVITY -or $item.StartsWith($script:FIELD_ITEM_TOLL_PREFIX)) {
      $note = ""
    }

    Set-CellValue $sheet $row 2 $index
    Set-CellValue $sheet $row 3 (ConvertTo-ExcelDate $entry.dateKey)
    Set-CellValue $sheet $row 4 $item
    Set-CellValue $sheet $row 6 (ConvertTo-PlainText $entry.place)
    Set-CellValue $sheet $row 8 (ConvertTo-Amount $entry.amountWon)
    Set-CellValue $sheet $row 9 $summary
    Set-CellValue $sheet $row 10 $note

    $row++
    $index++
    $isFirstForDate = $false
  }
}

function Write-CorporateRows($sheet, $startRow, $rows) {
  Clear-DetailCells $sheet $startRow @(2, 3, 4, 5, 6, 7)
  $index = 1
  foreach ($entry in @($rows)) {
    $row = $startRow + $index - 1
    $summary = ConvertTo-PlainText $entry.summary
    $note = ConvertTo-PlainText $entry.note
    if (-not [string]::IsNullOrWhiteSpace($note)) {
      if ([string]::IsNullOrWhiteSpace($summary)) {
        $summary = $note
      } else {
        $summary = "$summary / $note"
      }
    }
    Set-CellValue $sheet $row 2 $index
    Set-CellValue $sheet $row 3 (ConvertTo-ExcelDate $entry.dateKey)
    Set-CellValue $sheet $row 4 (ConvertTo-PlainText $entry.item)
    Set-CellValue $sheet $row 5 (ConvertTo-PlainText $entry.place)
    Set-CellValue $sheet $row 6 $summary
    Set-CellValue $sheet $row 7 (ConvertTo-Amount $entry.amountWon)
    $index++
  }
}

# 셀 값만 쓰고 서식(정렬 등)은 그대로 두는 setter. 상단 정산월 표기용.
function Set-HeaderCellValue($sheet, $row, $column, $value) {
  $cell = $sheet.Cells.Item($row, $column)
  $target = $cell
  try {
    if ([bool]$cell.MergeCells) { $target = $cell.MergeArea.Cells.Item(1, 1) }
  } catch {
    $target = $cell
  }
  try {
    Invoke-ExcelCom { $target.Value = $value } "Header cell value"
  } catch {
    Invoke-ExcelCom { $target.Formula = ConvertTo-PlainText $value } "Header cell formula"
  }
}

# 정산월을 각 시트 상단에 표기합니다.
#  시트1 D5 : "{월}월 정산금액" (드롭다운 항목)
#  시트2 E5 : " {연}년 {월2자리}월" (정산기간)
#  시트3 E5 : 시트2와 동일 형식
function Write-SettlementPeriod($workbook, $monthKey) {
  $text = ConvertTo-PlainText $monthKey
  if ($text -notmatch '^(20\d{2})-(\d{2})$') { return }
  $year = $Matches[1]
  $monthPadded = $Matches[2]
  $monthNumber = [int]$monthPadded

  $sheet1Value = "$monthNumber$script:SETTLEMENT_SUFFIX"
  $periodValue = " $year$script:YEAR_SUFFIX$monthPadded$script:MONTH_SUFFIX"

  Set-HeaderCellValue (Get-WorksheetByIndex $workbook 1) 5 4 $sheet1Value
  Set-HeaderCellValue (Get-WorksheetByIndex $workbook 2) 5 5 $periodValue
  Set-HeaderCellValue (Get-WorksheetByIndex $workbook 3) 5 5 $periodValue
}

function Get-OrCreate-ProofWorksheet($workbook) {
  $sheet = $null
  for ($index = 1; $index -le $workbook.Worksheets.Count; $index++) {
    $candidate = $workbook.Worksheets.Item($index)
    if ((ConvertTo-PlainText $candidate.Name) -eq $script:PROOF_SHEET_NAME) {
      $sheet = $candidate
      break
    }
  }
  if ($null -eq $sheet) {
    $sheet = $workbook.Worksheets.Add([System.Type]::Missing, $workbook.Worksheets.Item($workbook.Worksheets.Count))
    $sheet.Name = $script:PROOF_SHEET_NAME
  } else {
    for ($index = $sheet.Shapes.Count; $index -ge 1; $index--) {
      try { $sheet.Shapes.Item($index).Delete() } catch {}
    }
    $sheet.Cells.Clear() | Out-Null
  }
  Write-Output -NoEnumerate $sheet
}

function Set-ProofWorksheetLayout($sheet) {
  $sheet.Cells.Font.Name = $script:PROOF_FONT_NAME
  $sheet.Cells.Font.Size = 10
  for ($column = 2; $column -le 24; $column++) {
    $sheet.Columns.Item($column).ColumnWidth = if ($column -eq 9 -or $column -eq 17) { 2.5 } else { 8.5 }
  }
  try {
    $sheet.PageSetup.Orientation = 2
    $sheet.PageSetup.Zoom = $false
    $sheet.PageSetup.FitToPagesWide = 1
    $sheet.PageSetup.FitToPagesTall = 0
    $sheet.PageSetup.LeftMargin = $sheet.Application.InchesToPoints(0.25)
    $sheet.PageSetup.RightMargin = $sheet.Application.InchesToPoints(0.25)
    $sheet.PageSetup.TopMargin = $sheet.Application.InchesToPoints(0.35)
    $sheet.PageSetup.BottomMargin = $sheet.Application.InchesToPoints(0.35)
  } catch {}
}

function Add-FittedProofPicture($sheet, $imagePath, $boxLeft, $boxTop, $boxWidth, $boxHeight) {
  if ([string]::IsNullOrWhiteSpace($imagePath) -or -not (Test-Path -LiteralPath $imagePath)) {
    return $false
  }
  try {
    $shape = Invoke-ExcelCom {
      $sheet.Shapes.AddPicture($imagePath, 0, -1, $boxLeft, $boxTop, -1, -1)
    } "Proof image insert"
    $shape.LockAspectRatio = -1
    $shapeRatio = if ($shape.Height -gt 0) { $shape.Width / $shape.Height } else { 1 }
    $boxRatio = if ($boxHeight -gt 0) { $boxWidth / $boxHeight } else { 1 }
    if ($shapeRatio -gt $boxRatio) {
      $shape.Width = $boxWidth
    } else {
      $shape.Height = $boxHeight
    }
    $shape.Left = $boxLeft + (($boxWidth - $shape.Width) / 2)
    $shape.Top = $boxTop + (($boxHeight - $shape.Height) / 2)
    $shape.Placement = 1
    return $true
  } catch {
    return $false
  }
}

function Add-ProofBlockImages($sheet, $block, $contentRange) {
  $images = @($block.images)
  $count = $images.Count
  if ($count -eq 0) {
    return [pscustomobject]@{ inserted = 0; failed = 0 }
  }

  $columns = if ($count -eq 1) { 1 } elseif ($count -le 4) { 2 } else { 3 }
  $rows = [Math]::Ceiling($count / $columns)
  $gap = 7.0
  $left = [double]$contentRange.Left + 5
  $top = [double]$contentRange.Top + 5
  $width = [double]$contentRange.Width - 10
  $height = [double]$contentRange.Height - 10
  $boxWidth = ($width - ($gap * ($columns - 1))) / $columns
  $boxHeight = ($height - ($gap * ($rows - 1))) / $rows
  $inserted = 0
  $failed = 0

  for ($index = 0; $index -lt $count; $index++) {
    $column = $index % $columns
    $row = [Math]::Floor($index / $columns)
    $boxLeft = $left + ($column * ($boxWidth + $gap))
    $boxTop = $top + ($row * ($boxHeight + $gap))
    $shapeCountBefore = $sheet.Shapes.Count
    Add-FittedProofPicture $sheet (ConvertTo-PlainText $images[$index].path) $boxLeft $boxTop $boxWidth $boxHeight | Out-Null
    if ($sheet.Shapes.Count -gt $shapeCountBefore) {
      $inserted++
    } else {
      $failed++
    }
  }

  return [pscustomobject]@{ inserted = $inserted; failed = $failed }
}

function Write-ProofSheet($workbook, $blocks, $unmatchedProofCount) {
  $sheet = Get-OrCreate-ProofWorksheet $workbook
  Set-ProofWorksheetLayout $sheet
  $proofBlocks = @($blocks)
  $startRow = 2
  $insertedImageCount = 0
  $failedImageCount = 0
  $reviewCount = [Math]::Max(0, [int]$unmatchedProofCount)

  if ($unmatchedProofCount -gt 0) {
    $noticeRange = $sheet.Range($sheet.Cells.Item(1, 2), $sheet.Cells.Item(1, 24))
    $noticeRange.Merge()
    Set-HeaderCellValue $sheet 1 2 "$script:PROOF_UNMATCHED_PREFIX$unmatchedProofCount$script:PROOF_UNMATCHED_SUFFIX"
    $noticeRange.Font.Color = 255
    $noticeRange.Font.Bold = $true
    $noticeRange.HorizontalAlignment = -4131
    $startRow = 3
  }

  if ($proofBlocks.Count -eq 0) {
    $emptyRange = $sheet.Range($sheet.Cells.Item($startRow, 2), $sheet.Cells.Item($startRow + 2, 24))
    $emptyRange.Merge()
    Set-HeaderCellValue $sheet $startRow 2 $script:PROOF_EMPTY_MESSAGE
    $emptyRange.HorizontalAlignment = -4108
    $emptyRange.VerticalAlignment = -4108
  }

  for ($index = 0; $index -lt $proofBlocks.Count; $index++) {
    $block = $proofBlocks[$index]
    $gridColumn = $index % 3
    $gridRow = [Math]::Floor($index / 3)
    $columnStart = 2 + ($gridColumn * 8)
    $columnEnd = $columnStart + 6
    $rowStart = $startRow + ($gridRow * 31)
    $titleRange = $sheet.Range($sheet.Cells.Item($rowStart, $columnStart), $sheet.Cells.Item($rowStart, $columnEnd))
    $contentRange = $sheet.Range($sheet.Cells.Item($rowStart + 2, $columnStart), $sheet.Cells.Item($rowStart + 27, $columnEnd))

    $titleRange.Merge()
    Set-HeaderCellValue $sheet $rowStart $columnStart (ConvertTo-PlainText $block.title)
    $titleRange.Font.Bold = $true
    $titleRange.Font.Size = 11
    $titleRange.Interior.Color = 16247773
    $titleRange.HorizontalAlignment = -4131
    $titleRange.VerticalAlignment = -4108
    $sheet.Rows.Item($rowStart).RowHeight = 24
    for ($row = $rowStart + 2; $row -le $rowStart + 27; $row++) {
      $sheet.Rows.Item($row).RowHeight = 15
    }
    $contentRange.BorderAround(1, 2) | Out-Null

    $imageResult = Add-ProofBlockImages $sheet $block $contentRange
    $insertedImageCount += $imageResult.inserted
    $failedImageCount += $imageResult.failed
    if ([bool]$block.needsReview) {
      $reviewCount++
    }
  }

  try {
    $sheet.Activate()
    $sheet.Application.ActiveWindow.DisplayGridlines = $false
  } catch {}

  return [pscustomobject]@{
    blockCount = $proofBlocks.Count
    insertedImageCount = $insertedImageCount
    failedImageCount = $failedImageCount
    reviewCount = $reviewCount
  }
}

$excel = $null
$workbook = $null
$excelProcessId = 0
$ownsExcelProcess = $false

try {
  $payload = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $sourcePath = [string]$payload.sourcePath
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Excel file not found: $sourcePath"
  }

  $excel = Get-ExcelApplication
  $ownsExcelProcess = $excel.Workbooks.Count -eq 0
  $excelProcessId = Get-ExcelProcessId $excel
  $excel.Visible = $true
  $excel.DisplayAlerts = $false
  try { $excel.ScreenUpdating = $false } catch {}
  try { $excel.EnableEvents = $false } catch {}
  try { $excel.Calculation = -4135 } catch {}

  $workbook = Invoke-ExcelCom { $excel.Workbooks.Open($sourcePath, 0, $false) } "Open workbook"

  Write-TravelRows (Get-WorksheetByIndex $workbook 2) 21 $payload.generalTravelRows
  Write-FieldVisitRows (Get-WorksheetByIndex $workbook 3) 20 $payload.fieldVisitRows
  Write-CorporateRows (Get-WorksheetByIndex $workbook 4) 16 $payload.corporateCardRows
  Write-SettlementPeriod $workbook $payload.monthKey
  $proofResult = Write-ProofSheet $workbook $payload.proofBlocks $payload.unmatchedProofCount

  $desktop = [Environment]::GetFolderPath("Desktop")
  $outputFileName = ConvertTo-PlainText $payload.outputFileName
  if ([string]::IsNullOrWhiteSpace($outputFileName)) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $filePrefix = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("7Lac7J6l67mEX+yekeyEseyZhOujjF8="))
    $outputFileName = "$filePrefix$timestamp.xlsx"
  }
  if (-not $outputFileName.EndsWith(".xlsx", [StringComparison]::OrdinalIgnoreCase)) {
    $outputFileName = "$outputFileName.xlsx"
  }
  $outputPath = Join-Path $desktop $outputFileName
  if (Test-Path -LiteralPath $outputPath) {
    $timestamp = Get-Date -Format "HHmmss"
    $baseName = [IO.Path]::GetFileNameWithoutExtension($outputFileName)
    $outputPath = Join-Path $desktop "$baseName`_$timestamp.xlsx"
  }
  Invoke-ExcelCom { $workbook.SaveCopyAs($outputPath) } "Save copy"

  $workbook.Close($false)

  [pscustomobject]@{
    ok = $true
    outputPath = $outputPath
    generalTravelCount = @($payload.generalTravelRows).Count
    fieldVisitCount = @($payload.fieldVisitRows).Count
    corporateCardCount = @($payload.corporateCardRows).Count
    proofBlockCount = $proofResult.blockCount
    proofImageCount = $proofResult.insertedImageCount
    proofImageFailureCount = $proofResult.failedImageCount
    proofReviewCount = $proofResult.reviewCount
  } | ConvertTo-Json -Compress
} catch {
  if ($null -ne $workbook) {
    try { $workbook.Close($false) } catch {}
  }
  [pscustomobject]@{
    ok = $false
    message = $_.Exception.Message
    line = $_.InvocationInfo.ScriptLineNumber
  } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($null -ne $workbook) {
    try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) | Out-Null } catch {}
    $workbook = $null
  }
  if ($null -ne $excel) {
    try { $excel.Calculation = -4105 } catch {}
    try { $excel.EnableEvents = $true } catch {}
    try { $excel.ScreenUpdating = $true } catch {}
    try { $excel.DisplayAlerts = $true } catch {}
    try { $excel.Quit() } catch {}
    try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) | Out-Null } catch {}
    $excel = $null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  if ($ownsExcelProcess -and $excelProcessId -gt 0) {
    Start-Sleep -Milliseconds 250
    $excelProcess = Get-Process -Id $excelProcessId -ErrorAction SilentlyContinue
    if ($null -ne $excelProcess -and $excelProcess.ProcessName -eq "EXCEL") {
      Stop-Process -Id $excelProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}
