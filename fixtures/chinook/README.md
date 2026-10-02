# Pinned Chinook

`chinookdb.json` is the one pin of the Chinook SQLite file: its address on chinookdb.com, a
mirror address (the public `datatug/chinookdb` repository on jsDelivr at a fixed commit,
serving the same file), the SHA-256 both must produce, and the upstream revision
(`lerocha/chinook-database`) it was built from. `scripts/fetch-chinook.sh` downloads and
verifies it; nothing else decides which file is accepted. The database is not vendored here.

`phase1-acceptance.json` records the customers, invoice counts and support-note counts the
Phase 1 demo's tests expect from that file. Chinook's rows are the same in the chinookdb.com
revision as in the `datatug/chinook-database` revision this repository pinned before (every
count below holds on both), except two things: every `Invoice.InvoiceDate` (2021 on
chinookdb.com, 2009 before) and two `Track` text fields (`Name` of track 728, `Composer` of
track 2). Nothing here reads either.

Fetch and verify the file:

```sh
scripts/fetch-chinook.sh            # prints the path, .demo-data/chinook-source.sqlite
```

The selected rows and counts come from these read-only queries against that file:

```sql
SELECT CustomerId, Country
FROM Customer
WHERE CustomerId IN (1, 3, 5)
ORDER BY CustomerId;

SELECT CustomerId, COUNT(*) AS InvoiceCount
FROM Invoice
WHERE CustomerId IN (1, 3, 5)
GROUP BY CustomerId
ORDER BY CustomerId;

SELECT COUNT(*) AS CustomerCount
FROM Customer
WHERE Country = 'Canada';

SELECT COUNT(*) AS InvoiceCount
FROM Invoice
WHERE BillingCountry = 'Canada';
```

They yield Brazilian customer 1, Canadian customer 3, and investigation customer 5;
each has 7 invoices. Canada has 8 customers and 56 invoices. The committed inGitDB
records independently yield one Canadian support note, one note for customer 1, one for
customer 3, and two for customer 5.

The restricted transport cases therefore use customer 1 to prove an unauthorized
Brazilian lookup returns no rows and customer 3 to prove an authorized Canadian lookup
returns 7 invoices and one support note. The unrestricted J2 lookup keeps customer 5,
whose expected related counts are 7 invoices and 2 support notes.

The normal unit suite checks the committed derived fixture against the real inGitDB and
HTTP fixtures. It does not claim to have opened the external Chinook database. The
database verification is explicit and fails on a hash, country or count mismatch:

```sh
scripts/fetch-chinook.sh
go -C tests test . -run TestPinnedChinookDatabase
```

The test reads `DATATUG_CHINOOK_DB` if set, else the file `scripts/fetch-chinook.sh` leaves in
`.demo-data`. Selecting it by name without either fails, so an acceptance harness cannot
silently turn a missing database into a successful check.
