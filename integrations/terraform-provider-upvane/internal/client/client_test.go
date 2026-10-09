package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type recorded struct {
	method, path, rawPath, query, body string
	header                              http.Header
}

type testServer struct {
	*httptest.Server
	mu       sync.Mutex
	requests []recorded
}

func newTestServer(t *testing.T, handler func(w http.ResponseWriter, r *http.Request, n int)) *testServer {
	t.Helper()
	ts := &testServer{}
	ts.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		ts.mu.Lock()
		ts.requests = append(ts.requests, recorded{method: r.Method, path: r.URL.Path, rawPath: r.URL.EscapedPath(), query: r.URL.RawQuery, body: string(body), header: r.Header.Clone()})
		n := len(ts.requests)
		ts.mu.Unlock()
		handler(w, r, n)
	}))
	t.Cleanup(ts.Close)
	return ts
}

func (ts *testServer) all() []recorded {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return append([]recorded(nil), ts.requests...)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-Id", "req_test123")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func newTestClient(t *testing.T, baseURL string) (*Client, *[]time.Duration) {
	t.Helper()
	c, err := New(Config{BaseURL: baseURL + "/v1/", APIKey: "upv_live_test", UserAgent: "terraform-provider-upvane/test"})
	if err != nil {
		t.Fatal(err)
	}
	var sleeps []time.Duration
	c.Sleep = func(ctx context.Context, d time.Duration) error {
		sleeps = append(sleeps, d)
		return ctx.Err()
	}
	keys := 0
	c.NewIdempotencyKey = func() string {
		keys++
		return "idem-" + string(rune('0'+keys))
	}
	return c, &sleeps
}

func TestNewValidatesConfig(t *testing.T) {
	if _, err := New(Config{BaseURL: "https://api.upvane.com/v1", APIKey: ""}); err == nil {
		t.Fatal("expected an error without API key")
	}
	if _, err := New(Config{BaseURL: "ftp://example.com", APIKey: "k"}); err == nil {
		t.Fatal("expected an error for a non-http scheme")
	}
	if _, err := New(Config{BaseURL: "not a url", APIKey: "k"}); err == nil {
		t.Fatal("expected an error for a relative URL")
	}
	c, err := New(Config{APIKey: "k"})
	if err != nil {
		t.Fatal(err)
	}
	if c.BaseURL() != DefaultBaseURL {
		t.Fatalf("default base URL = %q", c.BaseURL())
	}
}

func TestGetSendsHeadersAndUnwrapsEnvelope(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		writeJSON(w, 200, map[string]any{"data": map[string]any{"id": "c1", "slug": "api", "name": "API", "status": "operational", "position": 3}})
	})
	c, _ := newTestClient(t, ts.URL)
	var component Component
	if err := c.Get(context.Background(), Path("projects", "my page", "components", "api"), nil, &component); err != nil {
		t.Fatal(err)
	}
	if component.ID != "c1" || component.Position != 3 || component.Status != "operational" {
		t.Fatalf("unexpected component %+v", component)
	}
	req := ts.all()[0]
	if req.rawPath != "/v1/projects/my%20page/components/api" {
		t.Fatalf("path = %q", req.rawPath)
	}
	if got := req.header.Get("Authorization"); got != "Bearer upv_live_test" {
		t.Fatalf("authorization = %q", got)
	}
	if got := req.header.Get("User-Agent"); got != "terraform-provider-upvane/test" {
		t.Fatalf("user agent = %q", got)
	}
	if req.header.Get("Idempotency-Key") != "" {
		t.Fatal("GET must not send an Idempotency-Key")
	}
}

func TestCreateSendsJSONAndIdempotencyKeyReusedOnRetry(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, n int) {
		if n == 1 {
			writeJSON(w, 503, map[string]any{"error": "Try again.", "code": "unavailable"})
			return
		}
		writeJSON(w, 201, map[string]any{"data": map[string]any{"id": "g1", "name": "Core", "position": 0, "collapsed": false}})
	})
	c, sleeps := newTestClient(t, ts.URL)
	var group ComponentGroup
	if err := c.Create(context.Background(), Path("projects", "p", "component-groups"), map[string]any{"name": "Core"}, &group); err != nil {
		t.Fatal(err)
	}
	reqs := ts.all()
	if len(reqs) != 2 || len(*sleeps) != 1 {
		t.Fatalf("expected one retry, got %d requests and %d sleeps", len(reqs), len(*sleeps))
	}
	for _, req := range reqs {
		if req.method != http.MethodPost || req.header.Get("Idempotency-Key") != "idem-1" {
			t.Fatalf("expected POST with the same Idempotency-Key, got %s %q", req.method, req.header.Get("Idempotency-Key"))
		}
		if req.header.Get("Content-Type") != "application/json" || req.body != `{"name":"Core"}` {
			t.Fatalf("unexpected body %q (%s)", req.body, req.header.Get("Content-Type"))
		}
	}
	if group.ID != "g1" {
		t.Fatalf("unexpected group %+v", group)
	}
}

func TestRateLimitHonoursRetryAfterForEveryMethod(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, n int) {
		if n == 1 {
			w.Header().Set("Retry-After", "7")
			writeJSON(w, 429, map[string]any{"error": "Too many requests.", "code": "rate_limited"})
			return
		}
		writeJSON(w, 200, map[string]any{"data": map[string]any{"id": "g1"}})
	})
	c, sleeps := newTestClient(t, ts.URL)
	if err := c.Patch(context.Background(), "/projects/p/component-groups/g1", map[string]any{"name": "x"}, nil); err != nil {
		t.Fatal(err)
	}
	if len(*sleeps) != 1 || (*sleeps)[0] != 7*time.Second {
		t.Fatalf("expected a 7s wait from Retry-After, got %v", *sleeps)
	}
}

func TestPatchIsNotRetriedOnServerErrors(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		writeJSON(w, 500, map[string]any{"error": "Something went wrong.", "code": "internal", "request_id": "req_body"})
	})
	c, sleeps := newTestClient(t, ts.URL)
	err := c.Patch(context.Background(), "/projects/p/components/c", map[string]any{"name": "x"}, nil)
	if err == nil {
		t.Fatal("expected an error")
	}
	if len(ts.all()) != 1 || len(*sleeps) != 0 {
		t.Fatalf("PATCH must not be retried on 500 (requests %d)", len(ts.all()))
	}
}

func TestRetriesGiveUpAfterMaxRetries(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		writeJSON(w, 502, map[string]any{"error": "Bad gateway.", "code": "unavailable"})
	})
	c, sleeps := newTestClient(t, ts.URL)
	err := c.Get(context.Background(), "/me", nil, nil)
	apiErr, ok := AsError(err)
	if !ok || apiErr.StatusCode != 502 {
		t.Fatalf("expected the last API error, got %v", err)
	}
	if len(ts.all()) != 1+defaultMaxRetries || len(*sleeps) != defaultMaxRetries {
		t.Fatalf("expected %d attempts, got %d", 1+defaultMaxRetries, len(ts.all()))
	}
	for i, d := range *sleeps {
		ceiling := defaultMinBackoff * time.Duration(1<<i)
		if d < ceiling/2 || d > ceiling {
			t.Fatalf("backoff %d = %v, want between %v and %v", i, d, ceiling/2, ceiling)
		}
	}
}

func TestErrorMappingIncludesCodeAndRequestID(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		writeJSON(w, 422, map[string]any{
			"error": "name: Enter a name.", "code": "invalid_request", "request_id": "req_test123",
			"details": []map[string]any{{"path": "name", "message": "Enter a name."}, {"path": "slug", "message": "Use lowercase letters."}},
		})
	})
	c, _ := newTestClient(t, ts.URL)
	err := c.Create(context.Background(), "/projects/p/components", map[string]any{}, nil)
	apiErr, ok := AsError(err)
	if !ok {
		t.Fatalf("expected *Error, got %T", err)
	}
	if apiErr.Code != "invalid_request" || apiErr.RequestID != "req_test123" || apiErr.StatusCode != 422 {
		t.Fatalf("unexpected error %+v", apiErr)
	}
	text := err.Error()
	for _, want := range []string{"name: Enter a name.", "HTTP 422 invalid_request", "POST /projects/p/components", "request id req_test123", "slug: Use lowercase letters."} {
		if !strings.Contains(text, want) {
			t.Fatalf("error %q does not contain %q", text, want)
		}
	}
	if IsNotFound(err) || IsConflict(err) || IsAuth(err) {
		t.Fatal("422 must not be classified as not found, conflict or auth")
	}
}

func TestNotFoundRequiresAnUpvaneErrorBody(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		if strings.HasSuffix(r.URL.Path, "/gone") {
			writeJSON(w, 404, map[string]any{"error": "Component not found.", "code": "not_found"})
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(404)
		_, _ = io.WriteString(w, "<!DOCTYPE html><html>Not found</html>")
	})
	c, _ := newTestClient(t, ts.URL)
	err := c.Get(context.Background(), "/projects/p/components/gone", nil, nil)
	if !IsNotFound(err) {
		t.Fatalf("expected not found, got %v", err)
	}
	err = c.Get(context.Background(), "/projects/p/unknown-endpoint", nil, nil)
	if err == nil || IsNotFound(err) {
		t.Fatalf("an HTML 404 must be an error but not 'not found', got %v", err)
	}
	if !strings.Contains(err.Error(), "check base_url") {
		t.Fatalf("expected a hint about base_url, got %q", err.Error())
	}
}

func TestAuthAndConflictClassification(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		if r.Method == http.MethodGet {
			writeJSON(w, 401, map[string]any{"error": "The API key is not valid.", "code": "unauthorized"})
			return
		}
		writeJSON(w, 409, map[string]any{"error": "Already completed.", "code": "conflict"})
	})
	c, _ := newTestClient(t, ts.URL)
	if err := c.Get(context.Background(), "/me", nil, nil); !IsAuth(err) {
		t.Fatalf("expected auth error, got %v", err)
	}
	if err := c.Action(context.Background(), "/projects/p/maintenances/m/complete", map[string]any{}, nil); !IsConflict(err) {
		t.Fatalf("expected conflict, got %v", err)
	}
}

func TestListFollowsCursor(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		switch r.URL.Query().Get("cursor") {
		case "":
			writeJSON(w, 200, map[string]any{"data": []map[string]any{{"id": "a"}, {"id": "b"}}, "next_cursor": "c2"})
		case "c2":
			writeJSON(w, 200, map[string]any{"data": []map[string]any{{"id": "c"}}, "next_cursor": nil})
		}
	})
	c, _ := newTestClient(t, ts.URL)
	items, err := List[SLO](context.Background(), c, "/projects/p/slos", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 || items[2].ID != "c" {
		t.Fatalf("unexpected items %+v", items)
	}
	reqs := ts.all()
	if len(reqs) != 2 || !strings.Contains(reqs[0].query, "limit=100") || !strings.Contains(reqs[1].query, "cursor=c2") {
		t.Fatalf("unexpected queries %q, %q", reqs[0].query, reqs[1].query)
	}
}

func TestTransportErrorsAreRetriedForIdempotentRequests(t *testing.T) {
	ts := httptest.NewServer(http.NotFoundHandler())
	url := ts.URL
	ts.Close() // connection refused from now on
	c, sleeps := newTestClient(t, url)
	err := c.Get(context.Background(), "/me", nil, nil)
	var transport *TransportError
	if !errors.As(err, &transport) {
		t.Fatalf("expected a transport error, got %v", err)
	}
	if len(*sleeps) != defaultMaxRetries {
		t.Fatalf("expected %d retries, got %d", defaultMaxRetries, len(*sleeps))
	}
	*sleeps = nil
	_ = c.Patch(context.Background(), "/projects/p", map[string]any{}, nil)
	if len(*sleeps) != 0 {
		t.Fatal("PATCH must not be retried after a transport error")
	}
}

func TestDeleteAcceptsNoContent(t *testing.T) {
	ts := newTestServer(t, func(w http.ResponseWriter, r *http.Request, _ int) {
		w.WriteHeader(http.StatusNoContent)
	})
	c, _ := newTestClient(t, ts.URL)
	if err := c.Delete(context.Background(), "/projects/p/components/c"); err != nil {
		t.Fatal(err)
	}
	if ts.all()[0].method != http.MethodDelete {
		t.Fatal("expected DELETE")
	}
}

func TestRetryAfterParsing(t *testing.T) {
	if d, ok := retryAfter("3"); !ok || d != 3*time.Second {
		t.Fatalf("seconds: %v %v", d, ok)
	}
	if d, ok := retryAfter("100000"); !ok || d != maxRetryAfter {
		t.Fatalf("cap: %v %v", d, ok)
	}
	if _, ok := retryAfter("soon"); ok {
		t.Fatal("invalid values must be ignored")
	}
	future := time.Now().Add(10 * time.Second).UTC().Format(http.TimeFormat)
	if d, ok := retryAfter(future); !ok || d <= 0 || d > 11*time.Second {
		t.Fatalf("date: %v %v", d, ok)
	}
}
