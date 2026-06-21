package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/akann/yana-stocks/auth-service/internal/middleware"
	"github.com/akann/yana-stocks/auth-service/internal/service"
)

// mockAuthService satisfies authServicer with configurable per-test fns.
type mockAuthService struct {
	changePasswordFn func(ctx context.Context, userID, current, next string) error
	deleteAccountFn  func(ctx context.Context, userID, password string) error
}

func (m *mockAuthService) Register(_ context.Context, _, _ string) error { return nil }
func (m *mockAuthService) VerifyEmail(_ context.Context, _ string) error  { return nil }
func (m *mockAuthService) Login(_ context.Context, _, _ string) (*service.TokenPair, error) {
	return nil, nil
}
func (m *mockAuthService) Refresh(_ context.Context, _ string) (*service.TokenPair, error) {
	return nil, nil
}
func (m *mockAuthService) Logout(_ context.Context, _ string) error { return nil }
func (m *mockAuthService) Me(_ context.Context, _ string) (*service.MeResponse, error) {
	return nil, nil
}
func (m *mockAuthService) ChangePassword(ctx context.Context, userID, current, next string) error {
	if m.changePasswordFn != nil {
		return m.changePasswordFn(ctx, userID, current, next)
	}
	return nil
}
func (m *mockAuthService) DeleteAccount(ctx context.Context, userID, password string) error {
	if m.deleteAccountFn != nil {
		return m.deleteAccountFn(ctx, userID, password)
	}
	return nil
}

func deleteWithUser(body any, userID string) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(http.MethodDelete, "/api/auth/account", &buf)
	r.Header.Set("Content-Type", "application/json")
	if userID != "" {
		ctx := context.WithValue(r.Context(), middleware.ContextKeyUserID, userID)
		r = r.WithContext(ctx)
	}
	return r
}

func putWithUser(body any, userID string) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(http.MethodPut, "/api/auth/password", &buf)
	r.Header.Set("Content-Type", "application/json")
	if userID != "" {
		ctx := context.WithValue(r.Context(), middleware.ContextKeyUserID, userID)
		r = r.WithContext(ctx)
	}
	return r
}

func TestChangePassword(t *testing.T) {
	tests := []struct {
		name       string
		userID     string
		body       any
		svcFn      func(context.Context, string, string, string) error
		wantStatus int
	}{
		{
			name:       "no userID in context returns 401",
			userID:     "",
			body:       map[string]string{"currentPassword": "old12345", "newPassword": "new12345"},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing currentPassword returns 400",
			userID:     "user-1",
			body:       map[string]string{"newPassword": "new12345"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing newPassword returns 400",
			userID:     "user-1",
			body:       map[string]string{"currentPassword": "old12345"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "newPassword shorter than 8 chars returns 400",
			userID:     "user-1",
			body:       map[string]string{"currentPassword": "old12345", "newPassword": "short"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:   "wrong current password returns 401",
			userID: "user-1",
			body:   map[string]string{"currentPassword": "wrong", "newPassword": "new12345"},
			svcFn:  func(_ context.Context, _, _, _ string) error { return service.ErrWrongPassword },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:   "user not found returns 404",
			userID: "user-1",
			body:   map[string]string{"currentPassword": "old12345", "newPassword": "new12345"},
			svcFn:  func(_ context.Context, _, _, _ string) error { return service.ErrUserNotFound },
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "valid request returns 200",
			userID:     "user-1",
			body:       map[string]string{"currentPassword": "old12345", "newPassword": "new12345"},
			svcFn:      func(_ context.Context, _, _, _ string) error { return nil },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{changePasswordFn: tt.svcFn}}

			w := httptest.NewRecorder()
			h.ChangePassword(w, putWithUser(tt.body, tt.userID))

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

func TestDeleteAccount(t *testing.T) {
	tests := []struct {
		name       string
		userID     string
		body       any
		svcFn      func(context.Context, string, string) error
		wantStatus int
	}{
		{
			name:       "no userID in context returns 401",
			userID:     "",
			body:       map[string]string{"password": "pass12345"},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing password returns 400",
			userID:     "user-1",
			body:       map[string]string{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "wrong password returns 401",
			userID:     "user-1",
			body:       map[string]string{"password": "wrong"},
			svcFn:      func(_ context.Context, _, _ string) error { return service.ErrWrongPassword },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "user not found returns 404",
			userID:     "user-1",
			body:       map[string]string{"password": "pass12345"},
			svcFn:      func(_ context.Context, _, _ string) error { return service.ErrUserNotFound },
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "valid request returns 200",
			userID:     "user-1",
			body:       map[string]string{"password": "pass12345"},
			svcFn:      func(_ context.Context, _, _ string) error { return nil },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{deleteAccountFn: tt.svcFn}}

			w := httptest.NewRecorder()
			h.DeleteAccount(w, deleteWithUser(tt.body, tt.userID))

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}
