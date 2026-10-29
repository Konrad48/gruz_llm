"""Read-only document projections. No uploaded HTML or active content is served."""

import csv
import re
from bisect import bisect_right
from io import StringIO
from pathlib import Path
from unicodedata import normalize
from zipfile import ZipFile

from docx import Document as WordDocument
from docx.table import Table
from openpyxl import load_workbook
from pypdf import PdfReader

MAX_TEXT = 2_000_000


def folded(value: str) -> str:
    return "".join(
        char for char in normalize("NFKC", value).casefold() if char.isalnum()
    )


def validate_archive(path: Path):
    with ZipFile(path) as archive:
        if sum(item.file_size for item in archive.infolist()) > 80 * 1024 * 1024:
            raise ValueError("Expanded document exceeds 80 MB.")


def word_content(path: Path):
    validate_archive(path)
    document = WordDocument(path)
    blocks = []
    length = 0
    for item in document.iter_inner_content():
        if isinstance(item, Table):
            rows = [[cell.text for cell in row.cells] for row in item.rows]
            block = {"kind": "table", "rows": rows}
            length += sum(len(cell) for row in rows for cell in row)
        else:
            style = item.style.name if item.style is not None else ""
            heading = re.search(r"heading\s*(\d+)", style, re.I)
            block = {
                "kind": "paragraph",
                "text": item.text,
                "runs": [
                    {
                        "text": run.text,
                        "bold": bool(run.bold),
                        "italic": bool(run.italic),
                    }
                    for run in item.runs
                ],
                "level": min(int(heading.group(1)), 6)
                if heading
                else 1
                if style.lower() == "title"
                else 0,
                "list": "list" in style.lower()
                or item._p.pPr is not None
                and item._p.pPr.numPr is not None,
            }
            # Hyperlink text is included in paragraph.text but not paragraph.runs.
            if "".join(run["text"] for run in block["runs"]) != item.text:
                block["runs"] = [{"text": item.text, "bold": False, "italic": False}]
            length += len(item.text)
        if length > MAX_TEXT or len(blocks) >= 20000:
            raise ValueError(
                "Document is too large for the reader. Download the original file."
            )
        blocks.append(block)
    return blocks


def locate_rows(rows, excerpt: str):
    """Map indexed text back to a row, including excerpts starting inside a cell."""
    needle = folded(excerpt)
    if not needle:
        return None
    text = ""
    offsets = []
    columns = []
    for number, row in enumerate(rows, 1):
        offsets.append(len(text))
        starts = []
        for value in row:
            starts.append(len(text))
            text += folded(str(value) if value is not None else "")
        columns.append(starts)
        start = text.find(needle, max(0, len(text) - len(needle) - 20000))
        if start >= 0:
            first = max(1, bisect_right(offsets, start))
            return first, number, max(1, bisect_right(columns[first - 1], start))
        if len(text) > MAX_TEXT or number >= 100000:
            break
    # A long chunk can span many columns; a substantial prefix still locates it.
    if len(needle) >= 24:
        start = text.find(needle[: min(120, len(needle))])
        if start >= 0:
            row = max(1, bisect_right(offsets, start))
            return row, row, max(1, bisect_right(columns[row - 1], start))
    return None


def spreadsheet_content(
    path: Path,
    suffix: str,
    sheet: str | None,
    row_start: int | None,
    column_start: int,
    excerpt: str,
    location: str,
):
    if suffix == ".csv":
        content = path.read_text(encoding="utf-8-sig")
        if len(content) > MAX_TEXT:
            raise ValueError(
                "Spreadsheet is too large for the reader. Download the original file."
            )
        try:
            dialect = csv.Sniffer().sniff(content[:8192])
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(StringIO(content), dialect))
        sheets = [
            {
                "name": "CSV",
                "rows": len(rows),
                "columns": max(map(len, rows), default=0),
            }
        ]
        match = locate_rows(rows, excerpt) if excerpt and row_start is None else None
        first = row_start or (match[0] if match else 1)
        column_start = match[2] if match else column_start
        selected = rows[first - 1 : first + 99]
        return {
            "sheets": sheets,
            "sheet": "CSV",
            "row_start": first,
            "column_start": column_start,
            "rows": [
                [str(value) for value in row[column_start - 1 : column_start + 29]]
                for row in selected
            ],
            "target_row": match[0] if match else None,
        }

    validate_archive(path)
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        sheets = [
            {
                "name": item.title,
                "rows": item.max_row or 0,
                "columns": item.max_column or 0,
            }
            for item in book
        ]
        source_sheet = (
            location.removeprefix("sheet: ").strip()
            if location.startswith("sheet:")
            else None
        )
        selected = sheet or source_sheet or book.sheetnames[0]
        if selected not in book.sheetnames:
            raise ValueError("Sheet not found.")
        worksheet = book[selected]
        match = (
            locate_rows(worksheet.iter_rows(values_only=True), excerpt)
            if excerpt and row_start is None and selected == (source_sheet or selected)
            else None
        )
        first = row_start or (match[0] if match else 1)
        first = min(first, worksheet.max_row or 1)
        column_start = (
            match[2] if match else min(column_start, worksheet.max_column or 1)
        )
        rows = [
            [str(value) if value is not None else "" for value in row]
            for row in worksheet.iter_rows(
                min_row=first,
                max_row=min(first + 99, worksheet.max_row or first),
                min_col=column_start,
                max_col=min(column_start + 29, worksheet.max_column or column_start),
                values_only=True,
            )
        ]
        return {
            "sheets": sheets,
            "sheet": selected,
            "row_start": first,
            "column_start": column_start,
            "rows": rows,
            "target_row": match[0] if match else None,
        }
    finally:
        book.close()


def document_preview(
    path: Path,
    name: str,
    *,
    excerpt="",
    location="",
    sheet=None,
    row_start=None,
    column_start=1,
):
    suffix = Path(name).suffix.lower()
    base = {"name": name, "excerpt": excerpt, "location": location}
    if suffix == ".pdf":
        reader = PdfReader(path)
        pages = len(reader.pages)
        if pages > 1000:
            raise ValueError("PDF exceeds 1,000 pages.")
        match = re.search(r"\d+", location)
        return {
            **base,
            "kind": "pdf",
            "pages": pages,
            "page": min(max(int(match.group()) if match else 1, 1), max(pages, 1)),
        }
    if suffix == ".docx":
        return {**base, "kind": "word", "blocks": word_content(path)}
    if suffix in {".xlsx", ".csv"}:
        return {
            **base,
            "kind": "spreadsheet",
            **spreadsheet_content(
                path, suffix, sheet, row_start, column_start, excerpt, location
            ),
        }
    if suffix in {".txt", ".md"}:
        text = path.read_text(encoding="utf-8-sig")
        if len(text) > MAX_TEXT:
            raise ValueError(
                "Document is too large for the reader. Download the original file."
            )
        return {
            **base,
            "kind": "word",
            "blocks": [
                {
                    "kind": "paragraph",
                    "text": text,
                    "runs": [{"text": text}],
                    "level": 0,
                }
            ],
        }
    raise ValueError("Preview supports PDF, DOCX, XLSX and CSV files.")
