param(
  [Parameter(Mandatory = $true)]
  [string]$InputJson
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Decode-Utf8Base64($value) {
  return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
}

$FIELD_ITEM_FUEL = Decode-Utf8Base64 "7Jyg66WY64yA"
$FIELD_ITEM_ACTIVITY = Decode-Utf8Base64 "7Zmc64+Z67mE"
$FIELD_ITEM_TOLL_PREFIX = Decode-Utf8Base64 "7Ya17ZaJ66OM"

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
  return New-Object -ComObject Excel.Application
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

$excel = $null
$workbook = $null

try {
  $payload = Get-Content -LiteralPath $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $sourcePath = [string]$payload.sourcePath
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Excel file not found: $sourcePath"
  }

  $excel = Get-ExcelApplication
  $excel.Visible = $true
  $excel.DisplayAlerts = $false
  try { $excel.ScreenUpdating = $false } catch {}
  try { $excel.EnableEvents = $false } catch {}
  try { $excel.Calculation = -4135 } catch {}

  $workbook = Invoke-ExcelCom { $excel.Workbooks.Open($sourcePath, 0, $false) } "Open workbook"

  Write-TravelRows (Get-WorksheetByIndex $workbook 2) 21 $payload.generalTravelRows
  Write-FieldVisitRows (Get-WorksheetByIndex $workbook 3) 20 $payload.fieldVisitRows
  Write-CorporateRows (Get-WorksheetByIndex $workbook 4) 16 $payload.corporateCardRows

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
  if ($null -ne $excel) {
    try { $excel.Calculation = -4105 } catch {}
    try { $excel.EnableEvents = $true } catch {}
    try { $excel.ScreenUpdating = $true } catch {}
    try { $excel.DisplayAlerts = $true } catch {}
    try { $excel.Quit() } catch {}
  }
}
