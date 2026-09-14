"""
Parser for the Loblaws DC invoice template.

Scope, deliberately narrow: this parser is tuned to ONE supplier's
invoice layout (Loblaws Inc. / D058 DC East Gwillimbury), verified
against a real sample invoice. It is not a general-purpose PDF table
extractor. A different supplier's invoice will need its own parser —
see docs/architecture/spec.md, Section 9 (Remaining Open Items).

Design decision: we only deeply parse the fields our business logic
actually needs (barcode, article number, description, ordered qty,
supplier-reported qty, error code). Everything else on the line (unit
cost, extended cost, tax code, retail price, GPM%, promo flag) is
preserved as raw text in `row_data` — matching the requirement to
preserve every original column — without needing to fully structure
fields the system never computes with. This keeps the parser's actual
risk surface (the fields that drive delivered_qty/status math) small
and testable, instead of trying to perfectly model 14 columns when 6
are load-bearing.
"""

import re
from dataclasses import dataclass, field

DEPARTMENT_HEADER_RE = re.compile(r"^DEPARTMENT:\s*(\d+)\s+(.+)$")

# A row start: Line No. (digits, possibly comma-grouped), then a UPC
# code (6-14 digits — real-world UPC/EAN codes vary in length), then
# an Article Number (6-15 digits, sometimes with trailing letters
# seen in the sample as purely numeric but kept flexible), then the
# rest of the line.
ROW_START_RE = re.compile(
    r"^(?P<line_no>[\d,]+)\s+"
    r"(?P<upc>\d{6,14})\s+"
    r"(?P<article>\d{6,15})\s+"
    r"(?P<rest>.+)$"
)

# Within the "rest" of a row, the Pack Size + size-spec pair is the
# reliable anchor that separates Description (before it) from the
# quantity columns (after it). Size spec looks like "24x355.000ML",
# "1x116.000EA", "6x2.500L".
PACK_SIZE_RE = re.compile(r"(?P<pack_size>\d+)\s+(?P<size_spec>\d+x[\d.]+[A-Za-z]+)")

STOP_MARKERS = ("INVOICE SUMMARY BY DEPARTMENT", "SHORT SUMMARY")
SKIP_LINE_PREFIXES = (
    "Line",  # "Line No. UPC Code Article Number ..." header, wraps to 2 lines
    "No.",
    "DEPARTMENT:",  # handled separately, but also skip as a data row
    "Department Total",
    "Loblaws Inc.",
    "Invoice",
    "Invoice Number",
    "Customer",
    "D058",
    "Page",
)


@dataclass
class ParsedLineItem:
    line_no: str
    barcode_value: str
    article_number: str
    description: str
    pack_size: str | None
    size_spec: str | None
    ordered_qty: int
    supplier_reported_qty: int
    err_code: str | None
    raw_remainder: str  # unit cost, extended cost, tax, retail, GPM%, promo flag — unparsed, preserved as-is


@dataclass
class ParsedDepartmentSection:
    source_dept_code: str
    department_name: str
    line_items: list[ParsedLineItem] = field(default_factory=list)


@dataclass
class ParsedInvoice:
    invoice_number: str | None
    invoice_date_raw: str | None  # e.g. "30.AUG.2026" — date parsing happens at the API layer
    departments: list[ParsedDepartmentSection] = field(default_factory=list)


def _try_parse_row(line: str) -> ParsedLineItem | None:
    m = ROW_START_RE.match(line.strip())
    if not m:
        return None

    rest = m.group("rest")
    pack_match = PACK_SIZE_RE.search(rest)
    if not pack_match:
        # A line that looks like a row start but has no pack-size
        # anchor is not a real product row — safer to reject than
        # guess (e.g. this could be a mis-matched header fragment).
        return None

    description = rest[: pack_match.start()].strip()
    after_pack = rest[pack_match.end() :].strip()

    # After the pack size / size spec: Ord Qty, DR Qty, then
    # optionally a 3-digit Err Code, then everything else raw.
    qty_match = re.match(
        r"^(?P<ord_qty>\d+)\s+(?P<dr_qty>\d+)\s*(?P<err_code>\d{3})?\s*(?P<remainder>.*)$",
        after_pack,
    )
    if not qty_match:
        return None

    return ParsedLineItem(
        line_no=m.group("line_no").replace(",", ""),
        barcode_value=m.group("upc"),
        article_number=m.group("article"),
        description=description,
        pack_size=pack_match.group("pack_size"),
        size_spec=pack_match.group("size_spec"),
        ordered_qty=int(qty_match.group("ord_qty")),
        supplier_reported_qty=int(qty_match.group("dr_qty")),
        err_code=qty_match.group("err_code"),
        raw_remainder=qty_match.group("remainder").strip(),
    )


def parse_invoice_text(pages_text: list[str]) -> ParsedInvoice:
    """
    pages_text: the output of page.extract_text() for every page, in
    order, from pdfplumber.
    """
    invoice_number: str | None = None
    invoice_date_raw: str | None = None
    departments: dict[str, ParsedDepartmentSection] = {}
    current_dept_key: str | None = None
    pending_description_continuation = False

    # A DEPARTMENT header is only trusted once it's immediately
    # confirmed by the column-header line that always follows a real
    # section boundary in this template ("Line ... UPC Code ...").
    # Without this, a rare pdfplumber text-ordering artifact — a
    # duplicate department-header fragment interleaved between two
    # real data rows, observed once in testing against the real
    # sample invoice — silently misattributes a row to the wrong
    # department. A spurious header is never followed by the column
    # header (it's followed directly by a data row instead), so this
    # single check catches it without needing to special-case that
    # specific occurrence.
    pending_dept: tuple[str, str] | None = None

    for page_text in pages_text:
        if not page_text:
            continue

        lines = page_text.split("\n")

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue

            if any(marker in line for marker in STOP_MARKERS):
                # Everything from here to the end of the document is
                # summary/reconciliation content, not line items.
                return ParsedInvoice(invoice_number, invoice_date_raw, list(departments.values()))

            if invoice_number is None:
                inv_match = re.search(r"Invoice Number\s*:\s*(\S+)", line)
                if inv_match:
                    invoice_number = inv_match.group(1)
            if invoice_date_raw is None:
                date_match = re.search(r"Invoice Date\s*:\s*(\S+)", line)
                if date_match:
                    invoice_date_raw = date_match.group(1)

            dept_match = DEPARTMENT_HEADER_RE.match(line)
            if dept_match:
                code, name = dept_match.group(1), dept_match.group(2).strip()
                if code not in departments:
                    departments[code] = ParsedDepartmentSection(
                        source_dept_code=code, department_name=name
                    )
                pending_dept = (code, name)
                pending_description_continuation = False
                continue

            is_column_header_line = line.startswith("Line") or line.startswith("No.")
            if is_column_header_line and pending_dept is not None:
                # Confirmed: a real section boundary, not a stray
                # artifact — apply the staged department switch.
                current_dept_key = pending_dept[0]
                pending_dept = None

            if any(line.startswith(p) for p in SKIP_LINE_PREFIXES):
                pending_description_continuation = False
                continue

            if current_dept_key is None:
                continue

            item = _try_parse_row(line)
            if item is not None:
                # A staged department header that reaches this point
                # unconfirmed (a data row appeared instead of the
                # expected column-header line) is the spurious case —
                # discard it without switching current_dept_key.
                pending_dept = None
                departments[current_dept_key].line_items.append(item)
                pending_description_continuation = True
                continue

            # Not a row start — if the previous line was a real row,
            # this is very likely its wrapped description continuation
            # (e.g. "BICKS RELISH GREEN SWEET" / "PICKL" on the next
            # line). Merge it onto the last item's description rather
            # than discarding or misreading it as a new row.
            if pending_description_continuation and departments[current_dept_key].line_items:
                # Guard against accidentally merging an unrelated
                # stray line (e.g. a page footer) — only merge short,
                # plausible continuation fragments.
                if len(line) <= 40 and not re.search(r"\d{4,}", line):
                    departments[current_dept_key].line_items[-1].description += " " + line
                else:
                    pending_description_continuation = False

    return ParsedInvoice(invoice_number, invoice_date_raw, list(departments.values()))
