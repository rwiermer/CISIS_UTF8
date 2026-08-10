# WebAssembly compatibility matrix

This matrix describes behavior covered by native 32-bit versus WebAssembly
differential tests. It is narrower than the complete CISIS feature set.

| Area | Status | Differential coverage |
| --- | --- | --- |
| PFT | Supported subset | literals, MFN, field selection, combining and non-Latin UTF-8 |
| IsisScript | Supported subset | display, fields, loops, CGI parameters, nested includes, database import, search |
| Database | Supported | ISO2709 import, ISIS1660 MST/XRF creation and reads, WXIS update writes |
| FST/index | Supported subset | bundled CDS techniques 0, 2, and 4; full inversion; six companion files |
| Search | Supported subset | MX and WXIS Boolean retrieval against a generated inverted file |
| Browser execution | Supported | dedicated Worker, request isolation, timeouts, returned files |
| Persistent projects | Host-managed | callers retain and resubmit database and index files between requests |
| Shell commands | Excluded | browser workers cannot create child processes |
| Raw sockets | Excluded | networking belongs to the JavaScript host |
| Host paths | Excluded | absolute paths and request-root traversal are rejected |

## Known variance

The bundled CDS ISO fixture contains bytes that are not valid UTF-8. Native libc
and Emscripten produce different replacement characters when MX prints the
entire import stream. That incidental import stdout is retained in the JSON
report but excluded from string comparison. Exit status, stderr, generated
MST/XRF checksums, and subsequent selected PFT output remain compared.

## Not yet covered

- PFT syntax diagnostics and invalid-byte fixtures designed for exact output.
- Database delete, sort, and incremental inversion.
- IsisScript XML conversion, temporary files, and explicit unsupported-operation errors.
- Large-database limits and repeat-run performance budgets.
- Firefox and WebKit browser execution.
