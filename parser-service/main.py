"""
PDF parsing microservice.

Security posture (see docs/security/assessment.md, Section 11):
  - No outbound network access needed or used by this service at all —
    it only reads bytes from the request body and returns JSON. Deploy
    it with network egress disabled/blocked at the infrastructure
    level; this closes off SSRF as an attack class entirely, since a
    malicious PDF has nothing to make the parser fetch.
  - Authenticated via a shared bearer token (PARSER_SERVICE_TOKEN) —
    this service should never be reachable from the public internet
    directly, only from the Next.js backend.
  - File size capped before parsing begins.
  - Parsing wrapped in a timeout so a pathological PDF can't hang the
    service indefinitely.
  - Content is validated as an actual PDF (magic bytes), not trusted
    from the filename or declared content-type alone.
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import pdfplumber
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from parser import ParsedInvoice, parse_invoice_text

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20MB
PARSE_TIMEOUT_SECONDS = 30
PDF_MAGIC_BYTES = b"%PDF-"

PARSER_SERVICE_TOKEN = os.environ.get("PARSER_SERVICE_TOKEN")

app = FastAPI(title="Delivery Verification System — PDF Parser")
_executor = ThreadPoolExecutor(max_workers=2)


class LineItemOut(BaseModel):
    line_no: str
    barcode_value: str
    article_number: str
    description: str
    pack_size: str | None
    size_spec: str | None
    ordered_qty: int
    supplier_reported_qty: int
    err_code: str | None
    raw_remainder: str


class DepartmentOut(BaseModel):
    source_dept_code: str
    department_name: str
    line_items: list[LineItemOut]


class ParseResponse(BaseModel):
    invoice_number: str | None
    invoice_date_raw: str | None
    departments: list[DepartmentOut]


def _require_auth(authorization: str | None) -> None:
    if not PARSER_SERVICE_TOKEN:
        # Fail closed: if the service isn't configured with a token,
        # refuse everything rather than silently running unauthenticated.
        raise HTTPException(status_code=503, detail="Service not configured")
    expected = f"Bearer {PARSER_SERVICE_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _to_response(parsed: ParsedInvoice) -> ParseResponse:
    return ParseResponse(
        invoice_number=parsed.invoice_number,
        invoice_date_raw=parsed.invoice_date_raw,
        departments=[
            DepartmentOut(
                source_dept_code=d.source_dept_code,
                department_name=d.department_name,
                line_items=[
                    LineItemOut(**vars(item)) for item in d.line_items
                ],
            )
            for d in parsed.departments
        ],
    )


def _parse_pdf_bytes(pdf_bytes: bytes) -> ParsedInvoice:
    import io

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages_text = [page.extract_text() for page in pdf.pages]
    return parse_invoice_text(pages_text)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/parse", response_model=ParseResponse)
async def parse_endpoint(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    _require_auth(authorization)

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    if not contents.startswith(PDF_MAGIC_BYTES):
        # Real content-type check, not trusting the client's declared
        # Content-Type header or filename extension.
        raise HTTPException(status_code=422, detail="File is not a valid PDF")

    future = _executor.submit(_parse_pdf_bytes, contents)
    try:
        parsed = future.result(timeout=PARSE_TIMEOUT_SECONDS)
    except FutureTimeoutError:
        raise HTTPException(status_code=422, detail="PDF took too long to process")
    except Exception:
        # Detailed parser errors stay server-side (logged), never
        # returned to the caller — per the security assessment's
        # error-handling guidance for untrusted file processing.
        raise HTTPException(status_code=422, detail="Could not process file")

    if parsed.invoice_number is None or not parsed.departments:
        raise HTTPException(
            status_code=422,
            detail="Could not find an invoice number or any department sections — "
            "this file may not match the expected invoice template",
        )

    return _to_response(parsed)
