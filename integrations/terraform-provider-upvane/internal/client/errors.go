package client

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// Error is a non-2xx answer from the API. Code is the machine code of the `{ error, code }` body ("not_found",
// "conflict", "invalid_request", …); it is empty when the server did not send an Upvane error body.
type Error struct {
	Method     string
	Path       string
	StatusCode int
	Code       string
	Message    string
	Details    json.RawMessage
	RequestID  string
}

func (e *Error) Error() string {
	var b strings.Builder
	message := strings.TrimSpace(e.Message)
	if message == "" {
		message = http.StatusText(e.StatusCode)
	}
	b.WriteString(message)
	if details := e.detailLines(); details != "" {
		b.WriteString("\n")
		b.WriteString(details)
	}
	status := fmt.Sprintf("HTTP %d", e.StatusCode)
	if e.Code != "" {
		status += " " + e.Code
	}
	fmt.Fprintf(&b, "\n\n(%s on %s %s", status, e.Method, e.Path)
	if e.RequestID != "" {
		fmt.Fprintf(&b, ", request id %s", e.RequestID)
	}
	b.WriteString(")")
	return b.String()
}

// detailLines renders validation details (`[{ path, message }]`) as one line per field.
func (e *Error) detailLines() string {
	if len(e.Details) == 0 {
		return ""
	}
	var items []struct {
		Path    string `json:"path"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(e.Details, &items); err != nil || len(items) <= 1 {
		return ""
	}
	lines := make([]string, 0, len(items))
	for _, item := range items {
		lines = append(lines, fmt.Sprintf("  - %s: %s", item.Path, item.Message))
	}
	return strings.Join(lines, "\n")
}

// TransportError wraps network failures (DNS, connection refused, timeouts).
type TransportError struct {
	Method string
	Path   string
	Err    error
}

func (e *TransportError) Error() string {
	return fmt.Sprintf("could not reach the Upvane API (%s %s): %v", e.Method, e.Path, e.Err)
}

func (e *TransportError) Unwrap() error { return e.Err }

// AsError returns the *Error inside err, if any.
func AsError(err error) (*Error, bool) {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr, true
	}
	return nil, false
}

// IsNotFound reports a JSON `not_found` answer. A 404 without an Upvane error body (a wrong base_url, a proxy page)
// is deliberately not "not found": treating it so would make Terraform forget resources that still exist.
func IsNotFound(err error) bool {
	apiErr, ok := AsError(err)
	return ok && apiErr.StatusCode == http.StatusNotFound && apiErr.Code == "not_found"
}

// IsConflict reports a 409 `conflict` answer (for example, completing a maintenance window that already ended).
func IsConflict(err error) bool {
	apiErr, ok := AsError(err)
	return ok && apiErr.StatusCode == http.StatusConflict && apiErr.Code == "conflict"
}

// IsAuth reports 401 and 403 answers.
func IsAuth(err error) bool {
	apiErr, ok := AsError(err)
	return ok && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden)
}
