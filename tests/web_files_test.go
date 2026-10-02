package tests

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/datatug/datatug-cli/pkg/secureread"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The files a browser reads. The schemas they must satisfy live in datatug/datatug-apps and are
// checked by scripts/check-web-files.mjs (CI job web-files); these tests are the checks that
// need no network and no Node: what the files say about each other and about the rest of the
// project.

type webRecord struct {
	Key  string         `json:"key"`
	Data map[string]any `json:"data"`
}

// TestGeoWebFilesMatchRecords: data/geo/.web/<collection>.json (one file per table, generated
// by scripts/build-web-geo.py) holds exactly the records under data/geo/<collection>/$records,
// in key order. scripts/build-web-geo.py --check compares the bytes; this compares the content.
func TestGeoWebFilesMatchRecords(t *testing.T) {
	for collection, count := range map[string]int{"country_aliases": 24, "population_wb": 216} {
		t.Run(collection, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(projectDir, "data", "geo", ".web", collection+".json"))
			require.NoError(t, err)
			var web []webRecord
			require.NoError(t, json.Unmarshal(raw, &web))
			require.Len(t, web, count)

			files, err := filepath.Glob(filepath.Join(projectDir, "data", "geo", collection, "$records", "*.json"))
			require.NoError(t, err)
			require.Len(t, files, count)
			sort.Strings(files)
			for i, file := range files {
				key := strings.TrimSuffix(filepath.Base(file), ".json")
				b, err := os.ReadFile(file)
				require.NoError(t, err)
				var data map[string]any
				require.NoError(t, json.Unmarshal(b, &data))
				assert.Equal(t, key, web[i].Key, "record %d", i)
				assert.Equal(t, data, web[i].Data, "record %s", key)
			}
		})
	}
}

// TestOneFileCollectionIsReadByTheEngine records the evidence behind the choice of layout
// (G-R3): the engine the DataTug CLI uses reads an inGitDB collection stored as ONE file
// (record type map[$record_id]map[$field_name]any), with the same rows as one file per record.
// The project does not store the geo tables that way (the vendored layout and the browser's
// {key,data} files are kept; see data/geo/README.md), but this is what makes that a choice.
func TestOneFileCollectionIsReadByTheEngine(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) {
		path := filepath.Join(dir, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	}
	write(".ingitdb/settings.yaml", "default_namespace: demo\nlanguages:\n  - required: en\n")
	write(".ingitdb/root-collections.yaml", "aliases: aliases\n")
	write("aliases/.collection/definition.yaml", `titles:
  en: Aliases
record_file:
  name: "aliases.json"
  type: "map[$record_id]map[$field_name]any"
  format: json
columns:
  alias:
    type: string
    required: true
  country:
    type: string
    required: true
columns_order: [alias, country]
`)
	write("aliases/aliases.json", `{"usa": {"alias": "USA", "country": "us"}, "ireland": {"alias": "Ireland", "country": "ie"}}`)

	executor := secureread.NewExecutor(secureread.Session{Unrestricted: true})
	result, err := executor.RunDTQL(context.Background(), "ingitdb://"+dir, []byte("from: {name: aliases}\n"), nil)
	require.NoError(t, err)
	got := map[string]string{}
	for _, row := range result.Rows {
		got[row.Key] = row.Data["alias"].(string) + "/" + row.Data["country"].(string)
	}
	assert.Equal(t, map[string]string{"usa": "USA/us", "ireland": "Ireland/ie"}, got)
}

// preparedQuestions is ai/prepared-questions.json (schema: datatug-apps, project-files/schemas).
type preparedQuestions struct {
	Version   int `json:"version"`
	Questions []struct {
		ID        string            `json:"id"`
		Query     string            `json:"query"`
		Question  map[string]string `json:"question"`
		Title     map[string]string `json:"title"`
		Wordings  []string          `json:"wordings"`
		FollowUps []string          `json:"followUps"`
	} `json:"questions"`
}

var nonWord = regexp.MustCompile(`[\p{P}\p{S}]+`)

// normalise is the browser's comparison of a typed question with a wording: lower case,
// punctuation and symbols to spaces, whitespace collapsed.
func normalise(text string) string {
	return strings.Join(strings.Fields(nonWord.ReplaceAllString(strings.ToLower(text), " ")), " ")
}

func TestPreparedQuestions(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(projectDir, "ai", "prepared-questions.json"))
	require.NoError(t, err)
	var file preparedQuestions
	require.NoError(t, json.Unmarshal(raw, &file))

	assert.Equal(t, 1, file.Version)
	require.Len(t, file.Questions, 1, "the hero question is the one this release can answer")
	q := file.Questions[0]
	assert.Equal(t, "sales-per-capita", q.ID)
	assert.Equal(t, heroQueryID, q.Query)
	_, err = newStore(t).LoadQuery(context.Background(), q.Query)
	require.NoError(t, err, "the question's query must be a saved query of this project")

	assert.Equal(t, "Which countries buy the most music relative to their population?", q.Question["en"])
	assert.Equal(t, "Какие страны покупают больше всего музыки на душу населения?", q.Question["ru"])
	assert.Equal(t, "Sales per million people", q.Title["en"])
	assert.Equal(t, "Продажи на миллион человек", q.Title["ru"])
	assert.Equal(t, []string{"insight"}, q.FollowUps)

	// The wordings are stored in the form the browser compares (normalised), and the
	// question texts themselves always count as wordings.
	for _, wording := range q.Wordings {
		assert.Equal(t, normalise(wording), wording, "a wording is stored normalised")
	}
	assert.Contains(t, q.Wordings, normalise(q.Question["en"]))
	assert.Contains(t, q.Wordings, normalise(q.Question["ru"]))
	assert.Contains(t, q.Wordings, "music sales per capita by country")
}
