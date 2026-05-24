# Inmediata SecureTrack EDI Web Service — API Analysis

**Source:** SecureTrack_WS_Implementation_guide_.pdf (V.3, Rev 1, Effective 03/01/2021)

---

## 1. Service Type & Protocol

- **Protocol:** SOAP Web Service (ASMX)
- **Data Format:** HIPAA X12 EDI strings (raw X12, not JSON or REST)
- **Transport:** HTTPS
- **WSDL:** Available at PROD URL (append `?wsdl`)

---

## 2. Endpoints

| Environment | URL |
|-------------|-----|
| **QA / UAT** | `https://securetrack-uat.inmediata.com/webservices/EdiTransfer/EdiFileTransfer.asmx` |
| **PROD** | `https://www.inmediata.com/webservices/EdiTransfer/EdiFileTransfer.asmx?wsdl` |

> ⚠️ Remove any port number references from config URLs after adding the service reference.

---

## 3. Authentication

**Class:** `AuthenticationHeader`

| Field | Type | Notes |
|-------|------|-------|
| `UserName` | string | Provided at contract signing |
| `Password` | string | Provided at contract signing |

- Passed as the **first parameter** of every method call (SOAP header)
- No OAuth, no API keys, no certificates — simple username/password

---

## 4. SOAP Client Class

`EdiFileTransferSoapClient`

---

## 5. Methods

### 5.1 `SendRealTime` — Real-Time Transactions (Eligibility, Claim Status)
Use for: **270 (eligibility request), 271 (eligibility response), claim status inquiries**

**Parameters:**
- `AuthenticationHeader` — credentials
- `X12Data: string` — the full HIPAA X12 request string

**Returns: `RealTimeResult`**
- `ErrorCount` — 0 = success, >0 = error
- `Message` — result description or error message
- `RealTimeResponse: string` — full HIPAA X12 response (e.g., 271 response)

---

### 5.2 `SendX12File` — Batch Claims Submission (837P/I/D)
Use for: **batch claim submissions**

**Parameters:**
- `AuthenticationHeader` — credentials
- `FileName: string` — filename in your system (can be empty)
- `Body: string` — full HIPAA X12 file contents
- `FileDate: datetime` — file timestamp
- `FixX12Envelope: bool` — if `true`, Inmediata overwrites ISA sender/recipient with their registration data. **Recommended: `false`** to keep your own ISA envelope

**Returns: `FileTransferResult`**
- `ErrorCount` — 0 = success, >0 = error
- `Message` — result description or error
- `RoutedFiles` — (future use) array of response files if processed quickly
- `MoreToDownload` — (future use) boolean, more files pending

---

### 5.3 `SendCustomFile` — Non-HIPAA Batch Files
Use for: custom/non-standard file formats

**Parameters:**
- `AuthenticationHeader` — credentials
- `EdiFile` — file contents + descriptive properties

**Returns: `FileTransferResult`** (same as above, `RoutedFiles` and `MoreToDownload` active here)

---

### 5.4 `GetRoutedFiles` — Download All Pending Files
Retrieves all files pending download from Inmediata servers (ERAs 835, 277U, 999, TA1, etc.)

**Parameters:**
- `AuthenticationHeader` — credentials
- `MarkAsDownloaded: bool` — marks files as downloaded immediately. **⚠️ Keep `false`** unless your process is bulletproof; losing data on failure is a real risk

**Returns: `FileTransferResult`**
- `RoutedFiles: array` — each is a `RoutedFile` object (see below)
- `MoreToDownload: bool` — if true, call again

**`RoutedFile` object:**
- `FileType` — `HIPAASTDDOC` (X12) or `INMNOTIFMSG` (Inmediata notification)
- `FileBody` — array of strings; X12 = one element with full file; others = one element per line
- `FileSize` — size
- `MsgID: long` — unique file ID (use this for `MarkFilesAsDownloaded` and `GetRoutedFilesById`)
- `RoutedDate` — when file became available
- `RowDelimiter` — line ending type (see Glossary)

---

### 5.5 `MarkFilesAsDownloaded` — Mark Files Complete
**Parameters:**
- `AuthenticationHeader` — credentials
- `MsgIDs: string[]` — array of MsgIDs to mark as downloaded

---

### 5.6 `ListRoutedFiles` — List Pending Files (No Download)
Gets metadata about pending files without downloading content. Use to decide what to pull.

**Parameters:**
- `AuthenticationHeader` — credentials
- `StartDate: datetime`
- `EndDate: datetime`
- `DocumentType: string` (optional) — empty = all; CSV of types = filter (e.g., `"835,277A"`)

**Returns: `RoutedFilesDetailsResult`**
- `ListRoutedFiles` — collection of `RoutedFileDetails`:
  - `EntityFrom` — sender name (e.g., payer name for 835)
  - `CreationDate` — when available
  - `DocumentType` — e.g., `835`, `277U`, `999`
  - `FileSize`
  - `IsResponse` — was this triggered by something you submitted?
  - `MsgID` — use this to selectively download
  - `SenderETIN` — Electronic Transmitter ID of original submitter
  - `SubmittedFileID`, `SubmittedFileName`, `SubmittedICN` (optional) — traceback to your submission

---

### 5.7 `GetRoutedFilesById` — Selective Download by MsgID
Combine with `ListRoutedFiles` for selective download workflow.

**Parameters:**
- `AuthenticationHeader` — credentials
- `MarkAsDownloaded: bool` — same caution as `GetRoutedFiles`
- `MsgIDs: string` — CSV of MsgIDs to download

**Returns: `FileTransferResult`** (same structure)

---

## 6. Supported HIPAA Transaction Sets

| Transaction | Purpose |
|-------------|---------|
| **270/271** | Eligibility inquiry/response (real-time via `SendRealTime`) |
| **837P** | Professional claims |
| **837I** | Institutional claims |
| **837D** | Dental claims |
| **835** | Electronic Remittance Advice (ERA) |
| **277U** | Claim status |
| **999** | Implementation acknowledgment |
| **TA1** | Interchange acknowledgment |

---

## 7. TLS / Security

For `.NET 4.6 or older**, add before initializing SOAP client:
```csharp
ServicePointManager.SecurityProtocol = SecurityProtocolType.Ssl3 |
    SecurityProtocolType.Tls |
    SecurityProtocolType.Tls11 |
    SecurityProtocolType.Tls12;
```
Newer frameworks handle this automatically.

---

## 8. Error Handling

**No specific error code list provided.** Errors are indicated by:
- `ErrorCount > 0` — one or more errors occurred
- `Message` field — contains the error description

> ⚠️ Need to ask Inmediata for their full error code/message catalog.

---

## 9. Glossary

**RowDelimiter values:**
- `"2"` — CRLF (`\r\n`)
- `"4"` — CR (`\r`)
- `"5"` — LF (`\n`)

**DocumentType codes (for filtering `ListRoutedFiles`):**
- `835` — Remittance
- `277A` — Claim status acknowledgment
- `999` — Implementation acknowledgment
- `TA1` — Interchange acknowledgment
- `277U` — Unsolicited claim status

---

## 10. Workflow Patterns

### Real-Time Eligibility (270/271)
```
Build 270 X12 string → SendRealTime() → Parse 271 from RealTimeResponse
```

### Batch Claim Submission (837P)
```
Build 837P X12 string → SendX12File(FixX12Envelope=false) → Check ErrorCount/Message
```

### Download Responses (ERAs, ACKs)
**Option A — Download All:**
```
GetRoutedFiles(MarkAsDownloaded=false) → Process files → MarkFilesAsDownloaded(MsgIDs)
```

**Option B — Selective Download:**
```
ListRoutedFiles(StartDate, EndDate) → Review metadata → GetRoutedFilesById(MsgIDs) → Process → MarkFilesAsDownloaded(MsgIDs)
```

---

## 11. Puerto Rico Specific

**Not mentioned in this document.** Inmediata is a PR-based clearinghouse — ask them directly on the call about any PR-specific transaction requirements, payer IDs, or special configurations.

---

## 12. Key Implementation Notes

1. **Credentials** come from contract signing — need to request UAT credentials separately
2. **FixX12Envelope=false** is strongly recommended — keeps your ISA envelope intact
3. **Never set MarkAsDownloaded=true** unless your pipeline is fault-tolerant
4. **Polling required** — no webhook/push delivery mentioned; you poll `GetRoutedFiles` or `ListRoutedFiles`
5. **Batch claims** go through `SendX12File`; real-time eligibility goes through `SendRealTime`
6. The guide is from 2021 — may not reflect newest API features; ask about updates
