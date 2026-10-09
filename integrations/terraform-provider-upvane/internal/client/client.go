// Package client is a small typed client for the Upvane REST API v1 (see sdd/v2-devops-platform/api.md).
//
// It sends the API key as a bearer token, unwraps the `{ "data": … }` envelope, follows `next_cursor` pagination,
// turns `{ "error", "code" }` bodies into *Error values that carry the X-Request-Id, adds an Idempotency-Key to
// creates and actions, and retries rate-limited (429) and failed (5xx) requests with exponential backoff when it is
// safe to do so.
package client

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	mathrand "math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// DefaultBaseURL is the production API.
const DefaultBaseURL = "https://api.upvane.com/v1"

const (
	defaultMaxRetries    = 4
	defaultMinBackoff    = 500 * time.Millisecond
	defaultMaxBackoff    = 30 * time.Second
	maxRetryAfter        = 2 * time.Minute
	defaultHTTPTimeout   = 60 * time.Second
	maxErrorBodyInMemory = 64 << 10
	listPageSize         = 100
)

// Config configures a Client. Only BaseURL and APIKey are required.
type Config struct {
	BaseURL    string
	APIKey     string
	UserAgent  string
	HTTPClient *http.Client
	// MaxRetries is the number of retries after the first attempt. Zero means the default (4); use -1 to disable.
	MaxRetries int
	MinBackoff time.Duration
	MaxBackoff time.Duration
}

// Client talks to the Upvane API. It is safe for concurrent use.
type Client struct {
	base       *url.URL
	apiKey     string
	userAgent  string
	httpClient *http.Client
	maxRetries int
	minBackoff time.Duration
	maxBackoff time.Duration

	// Sleep waits between retries. Tests replace it to avoid real delays.
	Sleep func(ctx context.Context, d time.Duration) error
	// NewIdempotencyKey generates the Idempotency-Key of a create or action. Tests replace it.
	NewIdempotencyKey func() string
}

// New validates the configuration and returns a client.
func New(cfg Config) (*Client, error) {
	raw := strings.TrimSpace(cfg.BaseURL)
	if raw == "" {
		raw = DefaultBaseURL
	}
	base, err := url.Parse(strings.TrimRight(raw, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("base_url %q is not a valid absolute URL, such as %s", raw, DefaultBaseURL)
	}
	if base.Scheme != "https" && base.Scheme != "http" {
		return nil, fmt.Errorf("base_url %q must use https:// (or http:// for a local server)", raw)
	}
	base.RawQuery, base.Fragment = "", ""
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("an API key is required")
	}
	c := &Client{
		base:              base,
		apiKey:            strings.TrimSpace(cfg.APIKey),
		userAgent:         cfg.UserAgent,
		httpClient:        cfg.HTTPClient,
		maxRetries:        cfg.MaxRetries,
		minBackoff:        cfg.MinBackoff,
		maxBackoff:        cfg.MaxBackoff,
		Sleep:             sleepContext,
		NewIdempotencyKey: newUUID,
	}
	if c.userAgent == "" {
		c.userAgent = "upvane-go"
	}
	if c.httpClient == nil {
		c.httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	switch {
	case c.maxRetries == 0:
		c.maxRetries = defaultMaxRetries
	case c.maxRetries < 0:
		c.maxRetries = 0
	}
	if c.minBackoff <= 0 {
		c.minBackoff = defaultMinBackoff
	}
	if c.maxBackoff <= 0 {
		c.maxBackoff = defaultMaxBackoff
	}
	return c, nil
}

// BaseURL returns the API base URL without a trailing slash.
func (c *Client) BaseURL() string { return c.base.String() }

// Path joins escaped path segments: Path("projects", "my page", "components") = "/projects/my%20page/components".
func Path(segments ...string) string {
	var b strings.Builder
	for _, segment := range segments {
		b.WriteByte('/')
		b.WriteString(url.PathEscape(segment))
	}
	return b.String()
}

// Get reads a resource into out.
func (c *Client) Get(ctx context.Context, path string, query url.Values, out any) error {
	_, err := c.do(ctx, request{method: http.MethodGet, path: path, query: query, out: out})
	return err
}

// Create sends a POST with a fresh Idempotency-Key, so retries replay the first response instead of creating twice.
func (c *Client) Create(ctx context.Context, path string, body, out any) error {
	_, err := c.do(ctx, request{method: http.MethodPost, path: path, body: body, out: out, idempotencyKey: c.NewIdempotencyKey()})
	return err
}

// Action sends a POST to an action endpoint (start, complete, cancel, run, …) with an Idempotency-Key.
func (c *Client) Action(ctx context.Context, path string, body, out any) error {
	return c.Create(ctx, path, body, out)
}

// Patch updates a resource. PATCH is not retried on 5xx because it may have been applied.
func (c *Client) Patch(ctx context.Context, path string, body, out any) error {
	_, err := c.do(ctx, request{method: http.MethodPatch, path: path, body: body, out: out})
	return err
}

// Put replaces a sub-resource (status pin, dependencies). PUT is idempotent and retried.
func (c *Client) Put(ctx context.Context, path string, body, out any) error {
	_, err := c.do(ctx, request{method: http.MethodPut, path: path, body: body, out: out})
	return err
}

// Delete removes a resource.
func (c *Client) Delete(ctx context.Context, path string) error {
	_, err := c.do(ctx, request{method: http.MethodDelete, path: path})
	return err
}

// List reads every page of a list endpoint, following next_cursor.
func List[T any](ctx context.Context, c *Client, path string, query url.Values) ([]T, error) {
	var all []T
	params := url.Values{}
	for key, values := range query {
		params[key] = append([]string(nil), values...)
	}
	if params.Get("limit") == "" {
		params.Set("limit", strconv.Itoa(listPageSize))
	}
	seen := map[string]bool{}
	for {
		var page []T
		cursor, err := c.do(ctx, request{method: http.MethodGet, path: path, query: params, out: &page})
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if cursor == "" || seen[cursor] {
			return all, nil
		}
		seen[cursor] = true
		params.Set("cursor", cursor)
	}
}

type request struct {
	method         string
	path           string
	query          url.Values
	body           any
	out            any
	idempotencyKey string
}

type envelope struct {
	Data       json.RawMessage `json:"data"`
	NextCursor *string         `json:"next_cursor"`
}

// do sends the request with retries and decodes the envelope into req.out. It returns the next cursor of lists.
func (c *Client) do(ctx context.Context, req request) (string, error) {
	// req.path is already escaped segment by segment (see Path), so the URL is assembled as a string.
	target := c.base.String() + req.path
	if len(req.query) > 0 {
		target += "?" + req.query.Encode()
	}

	var payload []byte
	if req.body != nil {
		var err error
		payload, err = json.Marshal(req.body)
		if err != nil {
			return "", fmt.Errorf("encoding the %s %s request: %w", req.method, req.path, err)
		}
	}

	safeToRetry := isIdempotent(req.method) || req.idempotencyKey != ""
	for attempt := 0; ; attempt++ {
		httpReq, err := http.NewRequestWithContext(ctx, req.method, target, bodyReader(payload))
		if err != nil {
			return "", fmt.Errorf("building the %s %s request: %w", req.method, req.path, err)
		}
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
		httpReq.Header.Set("Accept", "application/json")
		httpReq.Header.Set("User-Agent", c.userAgent)
		if payload != nil {
			httpReq.Header.Set("Content-Type", "application/json")
		}
		if req.idempotencyKey != "" {
			httpReq.Header.Set("Idempotency-Key", req.idempotencyKey)
		}

		started := time.Now()
		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			if safeToRetry && attempt < c.maxRetries {
				wait := c.backoff(attempt)
				tflog.Debug(ctx, "Upvane API request failed, retrying", map[string]any{"method": req.method, "path": req.path, "attempt": attempt + 1, "error": err.Error(), "wait": wait.String()})
				if err := c.Sleep(ctx, wait); err != nil {
					return "", err
				}
				continue
			}
			return "", &TransportError{Method: req.method, Path: req.path, Err: err}
		}

		requestID := resp.Header.Get("X-Request-Id")
		tflog.Debug(ctx, "Upvane API request", map[string]any{
			"method": req.method, "path": req.path, "status": resp.StatusCode, "request_id": requestID,
			"attempt": attempt + 1, "duration_ms": time.Since(started).Milliseconds(),
		})

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			cursor, err := decodeSuccess(resp, req.out)
			if err != nil {
				return "", fmt.Errorf("decoding the response of %s %s (request %s): %w", req.method, req.path, requestID, err)
			}
			return cursor, nil
		}

		apiErr := decodeError(resp, req.method, req.path)
		if attempt < c.maxRetries && shouldRetry(resp.StatusCode, safeToRetry) {
			wait := c.backoff(attempt)
			if after, ok := retryAfter(resp.Header.Get("Retry-After")); ok {
				wait = after
			}
			tflog.Debug(ctx, "Upvane API request will be retried", map[string]any{"method": req.method, "path": req.path, "status": resp.StatusCode, "request_id": requestID, "wait": wait.String()})
			if err := c.Sleep(ctx, wait); err != nil {
				return "", err
			}
			continue
		}
		return "", apiErr
	}
}

func bodyReader(payload []byte) io.Reader {
	if payload == nil {
		return nil
	}
	return bytes.NewReader(payload)
}

func isIdempotent(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete, http.MethodOptions:
		return true
	}
	return false
}

// shouldRetry: 429 is rejected before the request is processed, so every method may retry it. 5xx only when the
// request is idempotent (or carries an Idempotency-Key, which the API forgets after a 5xx so the retry runs again).
func shouldRetry(status int, safeToRetry bool) bool {
	if status == http.StatusTooManyRequests {
		return true
	}
	switch status {
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return safeToRetry
	}
	return false
}

// backoff is exponential with jitter: base*2^attempt, capped, randomised between 50% and 100%.
func (c *Client) backoff(attempt int) time.Duration {
	d := float64(c.minBackoff) * math.Pow(2, float64(attempt))
	if d > float64(c.maxBackoff) {
		d = float64(c.maxBackoff)
	}
	half := d / 2
	return time.Duration(half + mathrand.Float64()*half)
}

// retryAfter parses Retry-After as seconds or an HTTP date.
func retryAfter(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	var wait time.Duration
	if seconds, err := strconv.Atoi(value); err == nil {
		wait = time.Duration(seconds) * time.Second
	} else if at, err := http.ParseTime(value); err == nil {
		wait = time.Until(at)
	} else {
		return 0, false
	}
	if wait < 0 {
		wait = 0
	}
	if wait > maxRetryAfter {
		wait = maxRetryAfter
	}
	return wait, true
}

func decodeSuccess(resp *http.Response, out any) (string, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode == http.StatusNoContent || len(bytes.TrimSpace(body)) == 0 {
		return "", nil
	}
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return "", fmt.Errorf("the API did not return JSON (HTTP %d): %w", resp.StatusCode, err)
	}
	if out != nil && len(env.Data) > 0 {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return "", err
		}
	}
	if env.NextCursor != nil {
		return *env.NextCursor, nil
	}
	return "", nil
}

func decodeError(resp *http.Response, method, path string) *Error {
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyInMemory))
	apiErr := &Error{Method: method, Path: path, StatusCode: resp.StatusCode, RequestID: resp.Header.Get("X-Request-Id")}
	var parsed struct {
		Error     string          `json:"error"`
		Code      string          `json:"code"`
		Details   json.RawMessage `json:"details"`
		RequestID string          `json:"request_id"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil && (parsed.Error != "" || parsed.Code != "") {
		apiErr.Message = parsed.Error
		apiErr.Code = parsed.Code
		apiErr.Details = parsed.Details
		if apiErr.RequestID == "" {
			apiErr.RequestID = parsed.RequestID
		}
		return apiErr
	}
	apiErr.Message = fmt.Sprintf("the server answered HTTP %d without an Upvane error body", resp.StatusCode)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
		apiErr.Message += "; check base_url (it must point at the API root, such as " + DefaultBaseURL + ") and that this endpoint is available"
	}
	return apiErr
}

func sleepContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}
