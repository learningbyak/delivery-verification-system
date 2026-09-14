"""
Tests for the Loblaws invoice parser.

The expected counts below are not guesses — they're read directly from
the invoice's own "INVOICE SUMMARY BY DEPARTMENT" table, which is a
different section of the same PDF and serves as ground truth
independent of our parsing logic for the department sections
themselves.

Deli (9 line items, per that summary table) is expected to be ABSENT
from parsed output — the sample PDF file starts at "Page 2 of 18" and
never includes Deli's section, which lives on the missing page 1. This
is a property of the sample file, not a parser bug — see the note in
test_deli_is_genuinely_absent_from_sample_file below.
"""

import os

import pdfplumber
import pytest

from parser import parse_invoice_text

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "test-fixtures", "sample-loblaws-invoice.pdf"
)


@pytest.fixture(scope="module")
def parsed_invoice():
    with pdfplumber.open(FIXTURE_PATH) as pdf:
        pages_text = [page.extract_text() for page in pdf.pages]
    return parse_invoice_text(pages_text)


def test_invoice_header_fields(parsed_invoice):
    assert parsed_invoice.invoice_number == "6516202419"
    assert parsed_invoice.invoice_date_raw == "30.AUG.2026"


EXPECTED_COUNTS = {
    "Liquor": 6,
    "Baby": 6,
    "Grocery": 214,
    "Natural Foods": 40,
    "OTC": 5,
    "HBA": 11,
    "HMR": 1,
}


def test_department_line_item_counts_match_invoice_summary_table(parsed_invoice):
    found = {d.department_name: len(d.line_items) for d in parsed_invoice.departments}
    for name, expected_count in EXPECTED_COUNTS.items():
        assert found.get(name) == expected_count, (
            f"{name}: found {found.get(name)}, expected {expected_count}"
        )


def test_deli_is_genuinely_absent_from_sample_file(parsed_invoice):
    # Not a parser bug — the sample PDF's first page is missing from
    # the file (it starts at "Page 2 of 18"), and Deli's section lived
    # on that missing page. Asserting its absence here so a future
    # change to the sample fixture (e.g. swapping in a complete file)
    # makes this test fail loudly, prompting an update rather than a
    # silent, misleading pass.
    names = {d.department_name for d in parsed_invoice.departments}
    assert "Deli" not in names


def test_wrapped_description_is_merged_onto_one_line(parsed_invoice):
    grocery = next(d for d in parsed_invoice.departments if d.department_name == "Grocery")
    item = next(i for i in grocery.line_items if i.article_number == "21665162")
    assert item.description == "BICKS RELISH GREEN SWEET PICKL"


def test_apostrophe_in_description_is_preserved(parsed_invoice):
    liquor = next(d for d in parsed_invoice.departments if d.department_name == "Liquor")
    item = next(i for i in liquor.line_items if i.article_number == "20587596")
    assert item.description == "MOTT'S ORIGINAL CAESAR CANS"


def test_error_code_is_extracted(parsed_invoice):
    baby = next(d for d in parsed_invoice.departments if d.department_name == "Baby")
    item = next(i for i in baby.line_items if i.article_number == "20304618001")
    assert item.ordered_qty == 1
    assert item.supplier_reported_qty == 0
    assert item.err_code == "260"


def test_department_boundary_artifact_does_not_misattribute_a_row(parsed_invoice):
    # This is the regression test for the pdfplumber text-ordering
    # quirk found during Phase 2 development: a spurious duplicate
    # "DEPARTMENT: 0926 Liquor" fragment appears mid-page, interleaved
    # between two real Grocery rows. It must not cause the Barbican
    # row to be attributed to Liquor.
    grocery = next(d for d in parsed_invoice.departments if d.department_name == "Grocery")
    liquor = next(d for d in parsed_invoice.departments if d.department_name == "Liquor")

    grocery_articles = {i.article_number for i in grocery.line_items}
    liquor_articles = {i.article_number for i in liquor.line_items}

    assert "20883754" in grocery_articles  # Barbican — correctly in Grocery
    assert "20883754" not in liquor_articles


def test_summary_sections_are_excluded_from_line_items(parsed_invoice):
    all_descriptions = [
        i.description
        for d in parsed_invoice.departments
        for i in d.line_items
    ]
    assert not any("SHORT SUMMARY" in d for d in all_descriptions)
    # Total across all present departments should be exactly 283 —
    # 292 total per the invoice's own summary, minus Deli's 9 missing
    # from this sample file (283 = 292 - 9).
    total = sum(len(d.line_items) for d in parsed_invoice.departments)
    assert total == 283
