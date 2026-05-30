"""
Inmediata SecureTrack SOAP Web Service Client
Implements raw SOAP XML calls via httpx (no zeep/suds dependency).

Methods:
  send_realtime(edi_content)                          → real-time 270/271, claim status
  send_x12_file(edi_content, filename)                → batch 837P submission
  list_routed_files(date_from, date_to, file_type)    → list pending ERAs/ACKs
  get_routed_files(mark_as_downloaded)                → download all pending files
  get_routed_files_by_id(msg_ids, mark_as_downloaded) → selective download
  mark_files_as_downloaded(msg_ids)                   → acknowledge receipt

Config (config.py / .env):
  INMEDIATA_WS_USERNAME, INMEDIATA_WS_PASSWORD, INMEDIATA_WS_ENV
"""
from __future__ import annotations

import logging
import textwrap
from datetime import datetime
from typing import Optional
import xml.etree.ElementTree as ET

import httpx

from config import settings

logger = logging.getLogger(__name__)

# ── Endpoints ─────────────────────────────────────────────────────────────────

ENDPOINTS = {
    "uat":  "https://securetrack-uat.inmediata.com/webservices/EdiTransfer/EdiFileTransfer.asmx",
    "prod": "https://www.inmediata.com/webservices/EdiTransfer/EdiFileTransfer.asmx",
}

SOAP_NS = "https://www.inmediata.com/ws/EdiFileTransfer/"

SOAP_ENVELOPE_TMPL = """\
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ns="{ns}">
  <soap:Header>
    <ns:AuthenticationHeader>
      <ns:Username>{username}</ns:Username>
      <ns:Password>{password}</ns:Password>
    </ns:AuthenticationHeader>
  </soap:Header>
  <soap:Body>
    {body}
  </soap:Body>
</soap:Envelope>"""


# ── Result dataclasses ────────────────────────────────────────────────────────

class RealTimeResult:
    def __init__(self, error_count: int, message: str, response: str):
        self.error_count = error_count
        self.message = message
        self.response = response  # raw X12 271 / 277 string

    @property
    def success(self) -> bool:
        return self.error_count == 0

    def __repr__(self):
        return f"RealTimeResult(success={self.success}, message={self.message!r})"


class RoutedFile:
    def __init__(self, msg_id: str, file_type: str, file_body: list[str],
                 file_size: int, routed_date: str, row_delimiter: str):
        self.msg_id = msg_id
        self.file_type = file_type        # HIPAASTDDOC or INMNOTIFMSG
        self.file_body = file_body        # list of strings (X12 = one element)
        self.file_size = file_size
        self.routed_date = routed_date
        self.row_delimiter = row_delimiter

    @property
    def content(self) -> str:
        """Joined file body as a single string."""
        delimiter_map = {"2": "\r\n", "4": "\r", "5": "\n"}
        sep = delimiter_map.get(str(self.row_delimiter), "\n")
        return sep.join(self.file_body)


class FileTransferResult:
    def __init__(self, error_count: int, message: str,
                 routed_files: list[RoutedFile], more_to_download: bool):
        self.error_count = error_count
        self.message = message
        self.routed_files = routed_files
        self.more_to_download = more_to_download

    @property
    def success(self) -> bool:
        return self.error_count == 0

    def __repr__(self):
        return (f"FileTransferResult(success={self.success}, "
                f"files={len(self.routed_files)}, more={self.more_to_download})")


class RoutedFileDetails:
    def __init__(self, msg_id: str, entity_from: str, creation_date: str,
                 document_type: str, file_size: int, is_response: bool,
                 sender_etin: str, submitted_file_id: str,
                 submitted_file_name: str, submitted_icn: str):
        self.msg_id = msg_id
        self.entity_from = entity_from
        self.creation_date = creation_date
        self.document_type = document_type
        self.file_size = file_size
        self.is_response = is_response
        self.sender_etin = sender_etin
        self.submitted_file_id = submitted_file_id
        self.submitted_file_name = submitted_file_name
        self.submitted_icn = submitted_icn


class RoutedFilesDetailsResult:
    def __init__(self, error_count: int, message: str,
                 files: list[RoutedFileDetails]):
        self.error_count = error_count
        self.message = message
        self.files = files

    @property
    def success(self) -> bool:
        return self.error_count == 0


# ── SOAP Client ───────────────────────────────────────────────────────────────

class SecureTrackClient:
    """
    Inmediata SecureTrack SOAP client.

    Usage:
        client = SecureTrackClient()  # reads settings automatically
        result = await client.send_realtime(x12_270_string)
    """

    def __init__(
        self,
        username: str | None = None,
        password: str | None = None,
        env: str | None = None,
        endpoint_url: str | None = None,
        timeout: float = 60.0,
    ):
        # Runtime config (from Settings UI) takes priority over .env
        from routers.inmediata import _runtime_config
        self.username = username or _runtime_config.get("ws_username") or settings.INMEDIATA_WS_USERNAME
        self.password = password or _runtime_config.get("ws_password") or settings.INMEDIATA_WS_PASSWORD
        self.env = (env or _runtime_config.get("ws_env") or settings.INMEDIATA_WS_ENV or "prod").lower()
        # Use caller-provided URL first, then env-based default
        self.endpoint = endpoint_url or ENDPOINTS.get(self.env, ENDPOINTS["uat"])
        self.timeout = timeout

        if not self.username or not self.password:
            logger.warning(
                "SecureTrackClient: INMEDIATA_WS_USERNAME / INMEDIATA_WS_PASSWORD "
                "not configured. Calls will fail with authentication errors."
            )

    def _build_envelope(self, body_xml: str) -> str:
        return SOAP_ENVELOPE_TMPL.format(
            ns=SOAP_NS,
            username=self.username,
            password=self.password,
            body=body_xml,
        )

    async def _post(self, soap_action: str, body_xml: str) -> ET.Element:
        """Send SOAP request and return parsed root Element."""
        envelope = self._build_envelope(body_xml)
        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": f'"{SOAP_NS}{soap_action}"',
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(self.endpoint, content=envelope.encode("utf-8"), headers=headers)

        logger.debug("SecureTrack %s → HTTP %s", soap_action, resp.status_code)
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        # Check for SOAP Fault
        fault = root.find(".//{http://schemas.xmlsoap.org/soap/envelope/}Fault")
        if fault is not None:
            faultstring = fault.findtext("faultstring") or "Unknown SOAP fault"
            raise ValueError(f"SOAP Fault from Inmediata: {faultstring}")

        return root

    @staticmethod
    def _xml_text(element: ET.Element, tag: str, default: str = "") -> str:
        node = element.find(f".//{{{SOAP_NS}}}{tag}")
        if node is None:
            node = element.find(f".//{tag}")
        return (node.text or default) if node is not None else default

    @staticmethod
    def _xml_int(element: ET.Element, tag: str, default: int = 0) -> int:
        val = SecureTrackClient._xml_text(element, tag, str(default))
        try:
            return int(val)
        except (ValueError, TypeError):
            return default

    @staticmethod
    def _xml_bool(element: ET.Element, tag: str, default: bool = False) -> bool:
        val = SecureTrackClient._xml_text(element, tag, "").lower()
        return val == "true" if val else default

    def _parse_routed_files(self, root: ET.Element) -> list[RoutedFile]:
        """Parse RoutedFiles array from FileTransferResult."""
        files = []
        for rf in root.findall(f".//{{{SOAP_NS}}}RoutedFile"):
            body_els = rf.findall(f"{{{SOAP_NS}}}FileBody/{{{SOAP_NS}}}string")
            if not body_els:
                body_els = rf.findall("FileBody/string")
            body = [el.text or "" for el in body_els]

            files.append(RoutedFile(
                msg_id=self._xml_text(rf, "MsgID"),
                file_type=self._xml_text(rf, "FileType"),
                file_body=body,
                file_size=self._xml_int(rf, "FileSize"),
                routed_date=self._xml_text(rf, "RoutedDate"),
                row_delimiter=self._xml_text(rf, "RowDelimiter", "5"),
            ))
        return files

    # ── Public API ────────────────────────────────────────────────────────────

    async def send_realtime(self, edi_content: str) -> RealTimeResult:
        """
        SendRealTime — real-time 270 eligibility request or 276 claim status.
        Returns RealTimeResult with .response = raw X12 271/277.
        """
        body = f"""
        <ns:SendRealTime>
          <ns:X12Data><![CDATA[{edi_content}]]></ns:X12Data>
        </ns:SendRealTime>"""
        root = await self._post("SendRealTime", body)

        result_node = root.find(f".//{{{SOAP_NS}}}SendRealTimeResult")
        if result_node is None:
            result_node = root.find(".//SendRealTimeResult")

        parent = result_node if result_node is not None else root
        return RealTimeResult(
            error_count=self._xml_int(parent, "ErrorCount"),
            message=self._xml_text(parent, "Message"),
            response=self._xml_text(parent, "RealTimeResponse"),
        )

    async def send_x12_file(
        self,
        edi_content: str,
        filename: str = "",
        file_date: datetime | None = None,
    ) -> FileTransferResult:
        """
        SendX12File — batch claim submission (837P/I/D).
        FixX12Envelope is always false to preserve our ISA envelope.
        """
        if file_date is None:
            file_date = datetime.utcnow()
        date_str = file_date.strftime("%Y-%m-%dT%H:%M:%S")

        body = f"""
        <ns:SendX12File>
          <ns:FileName>{filename}</ns:FileName>
          <ns:Body><![CDATA[{edi_content}]]></ns:Body>
          <ns:FileDate>{date_str}</ns:FileDate>
          <ns:FixX12Envelope>false</ns:FixX12Envelope>
        </ns:SendX12File>"""
        root = await self._post("SendX12File", body)

        result_node = root.find(f".//{{{SOAP_NS}}}SendX12FileResult")
        if result_node is None:
            result_node = root.find(".//SendX12FileResult")

        parent = result_node if result_node is not None else root
        return FileTransferResult(
            error_count=self._xml_int(parent, "ErrorCount"),
            message=self._xml_text(parent, "Message"),
            routed_files=self._parse_routed_files(parent),
            more_to_download=self._xml_bool(parent, "MoreToDownload"),
        )

    async def list_routed_files(
        self,
        date_from: datetime,
        date_to: datetime,
        file_type: str = "",
    ) -> RoutedFilesDetailsResult:
        """
        ListRoutedFiles — get metadata about pending files without downloading.
        file_type: "" = all, or CSV like "835,277A"
        """
        from_str = date_from.strftime("%Y-%m-%dT%H:%M:%S")
        to_str   = date_to.strftime("%Y-%m-%dT%H:%M:%S")

        body = f"""
        <ns:ListRoutedFiles>
          <ns:StartDate>{from_str}</ns:StartDate>
          <ns:EndDate>{to_str}</ns:EndDate>
          <ns:DocumentType>{file_type}</ns:DocumentType>
        </ns:ListRoutedFiles>"""
        root = await self._post("ListRoutedFiles", body)

        result_node = root.find(f".//{{{SOAP_NS}}}ListRoutedFilesResult")
        if result_node is None:
            result_node = root.find(".//ListRoutedFilesResult")
        parent = result_node if result_node is not None else root

        files = []
        for rfd in parent.findall(f".//{{{SOAP_NS}}}RoutedFileDetails"):
            if rfd is None:
                continue
            files.append(RoutedFileDetails(
                msg_id=self._xml_text(rfd, "MsgID"),
                entity_from=self._xml_text(rfd, "EntityFrom"),
                creation_date=self._xml_text(rfd, "CreationDate"),
                document_type=self._xml_text(rfd, "DocumentType"),
                file_size=self._xml_int(rfd, "FileSize"),
                is_response=self._xml_bool(rfd, "IsResponse"),
                sender_etin=self._xml_text(rfd, "SenderETIN"),
                submitted_file_id=self._xml_text(rfd, "SubmittedFileID"),
                submitted_file_name=self._xml_text(rfd, "SubmittedFileName"),
                submitted_icn=self._xml_text(rfd, "SubmittedICN"),
            ))

        return RoutedFilesDetailsResult(
            error_count=self._xml_int(parent, "ErrorCount"),
            message=self._xml_text(parent, "Message"),
            files=files,
        )

    async def get_routed_files(
        self,
        mark_as_downloaded: bool = False,
    ) -> FileTransferResult:
        """
        GetRoutedFiles — download all pending files.
        WARNING: keep mark_as_downloaded=False unless pipeline is fault-tolerant.
        """
        body = f"""
        <ns:GetRoutedFiles>
          <ns:MarkAsDownloaded>{"true" if mark_as_downloaded else "false"}</ns:MarkAsDownloaded>
        </ns:GetRoutedFiles>"""
        root = await self._post("GetRoutedFiles", body)

        result_node = root.find(f".//{{{SOAP_NS}}}GetRoutedFilesResult")
        if result_node is None:
            result_node = root.find(".//GetRoutedFilesResult")
        parent = result_node if result_node is not None else root

        return FileTransferResult(
            error_count=self._xml_int(parent, "ErrorCount"),
            message=self._xml_text(parent, "Message"),
            routed_files=self._parse_routed_files(parent),
            more_to_download=self._xml_bool(parent, "MoreToDownload"),
        )

    async def get_routed_files_by_id(
        self,
        msg_ids: list[str],
        mark_as_downloaded: bool = False,
    ) -> FileTransferResult:
        """
        GetRoutedFilesById — selective download by MsgID.
        msg_ids: list of MsgID strings (will be joined as CSV).
        """
        ids_csv = ",".join(str(i) for i in msg_ids)
        body = f"""
        <ns:GetRoutedFilesById>
          <ns:MarkAsDownloaded>{"true" if mark_as_downloaded else "false"}</ns:MarkAsDownloaded>
          <ns:MsgIDs>{ids_csv}</ns:MsgIDs>
        </ns:GetRoutedFilesById>"""
        root = await self._post("GetRoutedFilesById", body)

        result_node = root.find(f".//{{{SOAP_NS}}}GetRoutedFilesByIdResult")
        if result_node is None:
            result_node = root.find(".//GetRoutedFilesByIdResult")
        parent = result_node if result_node is not None else root

        return FileTransferResult(
            error_count=self._xml_int(parent, "ErrorCount"),
            message=self._xml_text(parent, "Message"),
            routed_files=self._parse_routed_files(parent),
            more_to_download=self._xml_bool(parent, "MoreToDownload"),
        )

    async def mark_files_as_downloaded(self, msg_ids: list[str]) -> bool:
        """
        MarkFilesAsDownloaded — acknowledge receipt of files by MsgID.
        Returns True on success.
        """
        ids_xml = "\n".join(f"<ns:string>{mid}</ns:string>" for mid in msg_ids)
        body = f"""
        <ns:MarkFilesAsDownloaded>
          <ns:MsgIDs>
            {ids_xml}
          </ns:MsgIDs>
        </ns:MarkFilesAsDownloaded>"""
        root = await self._post("MarkFilesAsDownloaded", body)

        # Method returns void or a simple ack; check for faults (already done in _post)
        fault = root.find(".//{http://schemas.xmlsoap.org/soap/envelope/}Fault")
        return fault is None


# ── Module-level singleton helper ─────────────────────────────────────────────

_client: SecureTrackClient | None = None


def get_securetrack_client() -> SecureTrackClient:
    """Return a module-level singleton SecureTrackClient."""
    global _client
    if _client is None:
        _client = SecureTrackClient()
    return _client
