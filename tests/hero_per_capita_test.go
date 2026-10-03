package tests

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/datatug/datatug-cli/pkg/secureread"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

// The hero question - "Which countries buy the most music relative to their
// population?" - is the saved DTQL query sales/chinook-sales-per-capita. It
// joins three sources (Chinook Invoice -> geo country_aliases -> geo
// population_wb) with no AI involved, so its result is a pure function of the
// committed geo snapshot (data/geo) and the pinned Chinook file.
//
// World Bank SP.POP.TOTL, latest year per country, fetched 2026-10-02
// (source last updated 2026-07-13). Re-pin these values when data/geo is
// refreshed with scripts/sync-geo-data.sh. They only pin the snapshot itself
// (TestGeoSnapshotPinned): every expectation about the query result is computed
// from the committed snapshot, so a refresh cannot flip a hard-coded ranking.
var pinnedPopulation = map[string]struct {
	Key        string
	Population int64
	Year       int64
}{
	"Ireland": {Key: "ie", Population: 5484367, Year: 2025},
	"USA":     {Key: "us", Population: 341784857, Year: 2025},
	"Canada":  {Key: "ca", Population: 41651653, Year: 2025},
}

const heroQueryID = "sales/chinook-sales-per-capita"

func geoSourceURL(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join(projectDir, "data", "geo"))
	require.NoError(t, err)
	return "ingitdb://" + dir
}

func number(t *testing.T, value any, field string) float64 {
	t.Helper()
	switch v := value.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	default:
		t.Fatalf("%s has type %T", field, value)
		return 0
	}
}

// snapshotPopulation returns, for each Chinook billing-country spelling, the
// committed World Bank population of the country its alias points to: the
// expectation the saved query must reproduce, computed from data/geo itself.
func snapshotPopulation(t *testing.T) map[string]int64 {
	t.Helper()
	executor := secureread.NewExecutor(secureread.Session{Unrestricted: true})
	read := func(collection string) []map[string]any {
		result, err := executor.RunDTQL(context.Background(), geoSourceURL(t), []byte("from: {name: "+collection+"}\n"), nil)
		require.NoError(t, err)
		rows := make([]map[string]any, 0, len(result.Rows))
		for _, row := range result.Rows {
			rows = append(rows, row.Data)
		}
		return rows
	}
	populationByCountry := map[string]int64{}
	for _, row := range read("population_wb") {
		populationByCountry[row["country"].(string)] = int64(number(t, row["population"], "population"))
	}
	byAlias := map[string]int64{}
	for _, row := range read("country_aliases") {
		population, ok := populationByCountry[row["country"].(string)]
		require.True(t, ok, "alias %v has no population in the snapshot", row["alias"])
		byAlias[row["alias"].(string)] = population
	}
	return byAlias
}

// expectedPerMillion is total / population * 1e6 for every country in totals,
// with the population taken from the committed snapshot.
func expectedPerMillion(t *testing.T, totals map[string]float64) map[string]float64 {
	t.Helper()
	population := snapshotPopulation(t)
	out := make(map[string]float64, len(totals))
	for country, total := range totals {
		p, ok := population[country]
		require.True(t, ok, "%s has no alias and population in the snapshot", country)
		out[country] = total / float64(p) * 1e6
	}
	return out
}

// rankedDescending lists the countries by value, highest first.
func rankedDescending(values map[string]float64) []string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return values[names[i]] > values[names[j]] })
	return names
}

// heroRows runs the project's saved hero query with the given Chinook SQLite
// file and returns the rows keyed by country, in result order.
func heroRows(t *testing.T, chinookPath string) ([]string, map[string]map[string]any) {
	t.Helper()
	query, err := newStore(t).LoadQuery(context.Background(), heroQueryID)
	require.NoError(t, err)
	require.NotEmpty(t, query.Text)

	executor := secureread.NewExecutor(secureread.Session{Unrestricted: true})
	result, err := executor.RunFederatedDTQL(context.Background(), []byte(query.Text), map[string]string{
		"chinook": "sqlite://" + chinookPath,
		"geo":     geoSourceURL(t),
	}, nil)
	require.NoError(t, err)

	order := make([]string, 0, len(result.Rows))
	byCountry := make(map[string]map[string]any, len(result.Rows))
	for _, row := range result.Rows {
		country, ok := row.Data["country"].(string)
		require.True(t, ok, "country has type %T", row.Data["country"])
		order = append(order, country)
		byCountry[country] = row.Data
	}
	return order, byCountry
}

// goldenResult is golden/sales-per-capita.json: the 24 rows of the hero query in result
// order, rounded to two decimals, with what they were computed from.
type goldenResult struct {
	Query        string `json:"query"`
	ComputedFrom struct {
		ProjectCommit string `json:"projectCommit"`
		Chinook       struct {
			SQLiteSHA256      string `json:"sqliteSha256"`
			InvoiceJSONSHA256 string `json:"invoiceJsonSha256"`
			UpstreamRevision  string `json:"upstreamRevision"`
		} `json:"chinook"`
		Geo struct {
			VendoredFrom string `json:"vendoredFrom"`
		} `json:"geo"`
		QueryDTQLSHA256 string `json:"queryDtqlSha256"`
	} `json:"computedFrom"`
	Invoices int `json:"invoices"`
	Rows     []struct {
		Rank            int     `json:"rank"`
		Country         string  `json:"country"`
		TotalSales      float64 `json:"totalSales"`
		Population      int64   `json:"population"`
		PopulationYear  int64   `json:"populationYear"`
		SalesPerMillion float64 `json:"salesPerMillion"`
	} `json:"rows"`
}

func loadGolden(t *testing.T) goldenResult {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(projectDir, "golden", "sales-per-capita.json"))
	require.NoError(t, err)
	var golden goldenResult
	require.NoError(t, json.Unmarshal(b, &golden))
	return golden
}

func twoPlaces(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }

// TestGoldenResultFile checks the golden file against the repository's own inputs, with no
// Chinook file needed: it names the data it was computed from, and those must still be
// the data in this repository. The headline numbers are the ones the landings quote.
func TestGoldenResultFile(t *testing.T) {
	golden := loadGolden(t)
	assert.Equal(t, heroQueryID, golden.Query)
	assert.Equal(t, 412, golden.Invoices)
	require.Len(t, golden.Rows, 24)

	pin := loadChinookPin(t)
	assert.Equal(t, pin.SQLite.SHA256, golden.ComputedFrom.Chinook.SQLiteSHA256)
	assert.Equal(t, pin.Upstream.Revision, golden.ComputedFrom.Chinook.UpstreamRevision)

	catalogBytes, err := os.ReadFile(filepath.Join(projectDir, "web", "catalogs", "chinook", "chinook.db.json"))
	require.NoError(t, err)
	var catalog struct {
		SHA256   map[string]string `json:"sha256"`
		Upstream struct {
			Revision string `json:"revision"`
		} `json:"upstream"`
	}
	require.NoError(t, json.Unmarshal(catalogBytes, &catalog))
	assert.Equal(t, catalog.SHA256["Invoice"], golden.ComputedFrom.Chinook.InvoiceJSONSHA256)
	assert.Equal(t, pin.Upstream.Revision, catalog.Upstream.Revision, "the web catalog and the SQLite pin name the same upstream revision")

	vendored, err := os.ReadFile(filepath.Join(projectDir, "data", "geo", ".vendored-from"))
	require.NoError(t, err)
	fields := map[string]string{}
	for _, line := range strings.Fields(string(vendored)) {
		if key, value, ok := strings.Cut(line, "="); ok {
			fields[key] = value
		}
	}
	assert.Equal(t, fields["repository"]+"@"+fields["commit"], golden.ComputedFrom.Geo.VendoredFrom)

	dtql, err := os.ReadFile(filepath.Join(projectDir, "queries", "sales", "chinook-sales-per-capita.query.dtql"))
	require.NoError(t, err)
	assert.Equal(t, fmt.Sprintf("%x", sha256.Sum256(dtql)), golden.ComputedFrom.QueryDTQLSHA256, "the saved query changed: regenerate golden/sales-per-capita.json")

	// The headline: Ireland first at 8.32, Czech Republic 8.29, Finland 7.37, USA 1.53 at rank 17.
	assert.Equal(t, "Ireland", golden.Rows[0].Country)
	assert.Equal(t, "8.32", twoPlaces(golden.Rows[0].SalesPerMillion))
	assert.Equal(t, "45.62", twoPlaces(golden.Rows[0].TotalSales))
	assert.Equal(t, "Czech Republic", golden.Rows[1].Country)
	assert.Equal(t, "8.29", twoPlaces(golden.Rows[1].SalesPerMillion))
	assert.Equal(t, "Finland", golden.Rows[2].Country)
	assert.Equal(t, "7.37", twoPlaces(golden.Rows[2].SalesPerMillion))
	assert.Equal(t, "USA", golden.Rows[16].Country)
	assert.Equal(t, 17, golden.Rows[16].Rank)
	assert.Equal(t, "1.53", twoPlaces(golden.Rows[16].SalesPerMillion))

	snapshot := snapshotPopulation(t)
	for i, row := range golden.Rows {
		assert.Equal(t, i+1, row.Rank)
		assert.Equal(t, snapshot[row.Country], row.Population, "%s: population differs from data/geo", row.Country)
		if i > 0 {
			assert.GreaterOrEqual(t, golden.Rows[i-1].SalesPerMillion, row.SalesPerMillion, "row %d out of order", i)
		}
	}
}

// TestGeoSnapshotPinned pins the committed reference data the hero query reads.
func TestGeoSnapshotPinned(t *testing.T) {
	executor := secureread.NewExecutor(secureread.Session{Unrestricted: true})
	run := func(t *testing.T, collection string) map[string]map[string]any {
		t.Helper()
		result, err := executor.RunDTQL(context.Background(), geoSourceURL(t), []byte("from: {name: "+collection+"}\n"), nil)
		require.NoError(t, err)
		rows := make(map[string]map[string]any, len(result.Rows))
		for _, row := range result.Rows {
			rows[row.Key] = row.Data
		}
		return rows
	}

	t.Run("population_wb", func(t *testing.T) {
		rows := run(t, "population_wb")
		assert.Len(t, rows, 216)
		for name, want := range pinnedPopulation {
			got := rows[want.Key]
			require.NotNil(t, got, name)
			assert.Equal(t, want.Population, int64(number(t, got["population"], "population")), name)
			assert.Equal(t, want.Year, int64(number(t, got["year"], "year")), name)
			assert.Equal(t, "SP.POP.TOTL", got["indicator"], name)
			assert.Equal(t, want.Key, got["country"], "FK to countries")
			assert.NotEmpty(t, got["source_url"], name)
			assert.NotEmpty(t, got["fetched_at"], name)
		}
		assert.Nil(t, rows["wld"], "World Bank aggregates must not be in the snapshot")
	})

	t.Run("country_aliases", func(t *testing.T) {
		rows := run(t, "country_aliases")
		assert.Len(t, rows, 24, "the 24 Chinook Invoice.BillingCountry values")
		for name, want := range pinnedPopulation {
			var found map[string]any
			for _, row := range rows {
				if row["alias"] == name {
					found = row
				}
			}
			require.NotNil(t, found, name)
			assert.Equal(t, want.Key, found["country"], name)
			assert.NotEmpty(t, found["source"], name)
		}
		// Spellings that differ from the GeoNames English name ("Czech Republic", the Netherlands)
		// are matched through the aliases of github.com/meaninggraph/core's country concept.
		assert.Equal(t, "cz", rows["czech-republic"]["country"])
		assert.Equal(t, "nl", rows["netherlands"]["country"])
	})
}

// TestHeroQuery_SyntheticInvoices runs the real saved query in the ordinary
// unit suite, with invented invoices standing in for Chinook (the real file is
// not vendored; see TestHeroQuery_PinnedChinook). Population and aliases are
// the committed snapshot.
func TestHeroQuery_SyntheticInvoices(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "invoices.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE Invoice (id TEXT PRIMARY KEY, BillingCountry TEXT, Total REAL)`)
	require.NoError(t, err)
	seed := []struct {
		country string
		total   float64
	}{
		{"Ireland", 10}, {"Ireland", 30},
		{"USA", 100}, {"USA", 200},
		{"Canada", 60},
		{"Czech Republic", 5},
		{"Atlantis", 999}, // no alias: an inner join drops it
	}
	for i, s := range seed {
		_, err = db.Exec(`INSERT INTO Invoice (id, BillingCountry, Total) VALUES (?, ?, ?)`, fmt.Sprint(i+1), s.country, s.total)
		require.NoError(t, err)
	}
	require.NoError(t, db.Close())

	order, rows := heroRows(t, dbPath)

	assert.NotContains(t, rows, "Atlantis")
	require.Len(t, order, 4)
	want := expectedPerMillion(t, map[string]float64{
		"Ireland": 40, "USA": 300, "Canada": 60, "Czech Republic": 5,
	})
	for country, perMillion := range want {
		assert.InDelta(t, perMillion, number(t, rows[country]["salesPerMillion"], "salesPerMillion"), 1e-9, country)
	}
	assert.Equal(t, rankedDescending(want), order, "ordered by sales per million, descending")
	for i := 1; i < len(order); i++ {
		assert.GreaterOrEqual(t,
			number(t, rows[order[i-1]]["salesPerMillion"], "salesPerMillion"),
			number(t, rows[order[i]]["salesPerMillion"], "salesPerMillion"), "row %d out of order", i)
	}
}

// chinookForHeroQuery locates the pinned Chinook SQLite file (chinookdb.com's, see
// fixtures/chinook/chinookdb.json) and returns a copy
// with the `id` column the DALgo SQLite adapter needs (what
// scripts/prepare_chinook.py does). It skips when the file is not available,
// unless DATATUG_REQUIRE_CHINOOK is set (CI sets it), when that is a failure.
func chinookForHeroQuery(t *testing.T) string {
	t.Helper()
	src := chinookSourcePath()
	if src == "" {
		const need = "DATATUG_CHINOOK_DB (or the file scripts/fetch-chinook.sh leaves in .demo-data) is required for the pinned Chinook check"
		if os.Getenv("DATATUG_REQUIRE_CHINOOK") != "" {
			t.Fatal(need + "; DATATUG_REQUIRE_CHINOOK is set, so a missing file is a failure")
		}
		t.Skip(need)
	}
	f, err := os.Open(src)
	require.NoError(t, err)
	raw, err := io.ReadAll(f)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	require.Equal(t, loadChinookPin(t).SQLite.SHA256, fmt.Sprintf("%x", sha256.Sum256(raw)), "not the pinned Chinook database")

	dst := filepath.Join(t.TempDir(), "chinook.sqlite")
	require.NoError(t, os.WriteFile(dst, raw, 0o600))
	db, err := sql.Open("sqlite", dst)
	require.NoError(t, err)
	defer func() { require.NoError(t, db.Close()) }()
	_, err = db.Exec(`ALTER TABLE Invoice ADD COLUMN id TEXT`)
	require.NoError(t, err)
	_, err = db.Exec(`UPDATE Invoice SET id = CAST(InvoiceId AS TEXT)`)
	require.NoError(t, err)
	return dst
}

// TestHeroQuery_PinnedChinook is the real answer: the actual Chinook invoices
// against the committed World Bank snapshot. The expected ranking and values are
// computed from the snapshot and from the invoices (summed by SQL, independently
// of the query engine), so a World Bank refresh moves them with the data.
func TestHeroQuery_PinnedChinook(t *testing.T) {
	chinook := chinookForHeroQuery(t)
	order, rows := heroRows(t, chinook)
	require.Len(t, order, 24, "every Chinook billing country has an alias and a population")

	db, err := sql.Open("sqlite", chinook)
	require.NoError(t, err)
	defer func() { require.NoError(t, db.Close()) }()
	sums, err := db.Query(`SELECT BillingCountry, SUM(Total) FROM Invoice GROUP BY BillingCountry`)
	require.NoError(t, err)
	totals := map[string]float64{}
	for sums.Next() {
		var country string
		var total float64
		require.NoError(t, sums.Scan(&country, &total))
		totals[country] = total
	}
	require.NoError(t, sums.Err())
	require.NoError(t, sums.Close())
	require.Len(t, totals, 24)

	// Chinook Invoice.Total sums are a property of the pinned file alone.
	for country, total := range map[string]float64{"Ireland": 45.62, "USA": 523.06, "Canada": 303.96} {
		assert.InDelta(t, total, totals[country], 1e-6, country)
		assert.InDelta(t, total, number(t, rows[country]["totalSales"], "totalSales"), 1e-6, country)
	}

	// Everything that depends on the population is computed from the committed snapshot.
	population := snapshotPopulation(t)
	want := expectedPerMillion(t, totals)
	for country, perMillion := range want {
		row := rows[country]
		require.NotNil(t, row, country)
		assert.InDelta(t, totals[country], number(t, row["totalSales"], "totalSales"), 1e-6, country)
		assert.Equal(t, population[country], int64(number(t, row["population"], "population")), country)
		assert.InDelta(t, perMillion, number(t, row["salesPerMillion"], "salesPerMillion"), 1e-9, country)
	}
	for name, pinned := range pinnedPopulation {
		assert.Equal(t, pinned.Population, int64(number(t, rows[name]["population"], "population")), name)
		assert.Equal(t, pinned.Year, int64(number(t, rows[name]["populationYear"], "populationYear")), name)
	}
	assert.Equal(t, rankedDescending(want), order, "the query returns the countries ranked by sales per million, highest first")

	// The golden result: the same 24 countries in the same order, every value equal after
	// rounding to two decimals, and every one of the 412 invoices accounted for.
	golden := loadGolden(t)
	require.Len(t, order, len(golden.Rows))
	for i, g := range golden.Rows {
		require.Equal(t, g.Country, order[i], "rank %d", i+1)
		row := rows[g.Country]
		assert.Equal(t, twoPlaces(g.TotalSales), twoPlaces(number(t, row["totalSales"], "totalSales")), g.Country)
		assert.Equal(t, g.Population, int64(number(t, row["population"], "population")), g.Country)
		assert.Equal(t, g.PopulationYear, int64(number(t, row["populationYear"], "populationYear")), g.Country)
		assert.Equal(t, twoPlaces(g.SalesPerMillion), twoPlaces(number(t, row["salesPerMillion"], "salesPerMillion")), g.Country)
	}
	var invoices int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM Invoice`).Scan(&invoices))
	assert.Equal(t, golden.Invoices, invoices, "invoices in the Chinook file")
	var inGoldenCountries int
	for country := range totals {
		var n int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM Invoice WHERE BillingCountry = ?`, country).Scan(&n))
		inGoldenCountries += n
	}
	assert.Equal(t, invoices, inGoldenCountries, "every invoice is in one of the 24 countries")
}
