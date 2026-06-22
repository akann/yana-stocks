package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/akann/yana-stocks/auth-service/internal/middleware"
	"github.com/akann/yana-stocks/auth-service/internal/service"
)

// mockAuthService satisfies authServicer with configurable per-test fns.
type mockAuthService struct {
	loginFn                func(ctx context.Context, email, password string) (*service.LoginResult, error)
	verifyMFALoginFn       func(ctx context.Context, mfaToken, code string) (*service.TokenPair, error)
	changePasswordFn       func(ctx context.Context, userID, current, next string) error
	deleteAccountFn        func(ctx context.Context, userID, password string) error
	requestPasswordResetFn func(ctx context.Context, email string) error
	resetPasswordFn        func(ctx context.Context, token, newPassword string) error
	getMFAStatusFn         func(ctx context.Context, userID string) (bool, error)
	setupMFAFn             func(ctx context.Context, userID, email string) (*service.MFASetupResult, error)
	verifyAndEnableMFAFn   func(ctx context.Context, userID, code string) error
	disableMFAFn           func(ctx context.Context, userID string) error
}

func (m *mockAuthService) Register(_ context.Context, _, _ string) error { return nil }
func (m *mockAuthService) VerifyEmail(_ context.Context, _ string) error  { return nil }
func (m *mockAuthService) Login(ctx context.Context, email, password string) (*service.LoginResult, error) {
	if m.loginFn != nil {
		return m.loginFn(ctx, email, password)
	}
	return &service.LoginResult{Tokens: &service.TokenPair{}}, nil
}
func (m *mockAuthService) VerifyMFALogin(ctx context.Context, mfaToken, code string) (*service.TokenPair, error) {
	if m.verifyMFALoginFn != nil {
		return m.verifyMFALoginFn(ctx, mfaToken, code)
	}
	return &service.TokenPair{}, nil
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
func (m *mockAuthService) RequestPasswordReset(ctx context.Context, email string) error {
	if m.requestPasswordResetFn != nil {
		return m.requestPasswordResetFn(ctx, email)
	}
	return nil
}
func (m *mockAuthService) ResetPassword(ctx context.Context, token, newPassword string) error {
	if m.resetPasswordFn != nil {
		return m.resetPasswordFn(ctx, token, newPassword)
	}
	return nil
}
func (m *mockAuthService) GetMFAStatus(ctx context.Context, userID string) (bool, error) {
	if m.getMFAStatusFn != nil {
		return m.getMFAStatusFn(ctx, userID)
	}
	return false, nil
}
func (m *mockAuthService) SetupMFA(ctx context.Context, userID, email string) (*service.MFASetupResult, error) {
	if m.setupMFAFn != nil {
		return m.setupMFAFn(ctx, userID, email)
	}
	return &service.MFASetupResult{OTPAuthURL: "otpauth://totp/test", Secret: "SECRET"}, nil
}
func (m *mockAuthService) VerifyAndEnableMFA(ctx context.Context, userID, code string) error {
	if m.verifyAndEnableMFAFn != nil {
		return m.verifyAndEnableMFAFn(ctx, userID, code)
	}
	return nil
}
func (m *mockAuthService) DisableMFA(ctx context.Context, userID string) error {
	if m.disableMFAFn != nil {
		return m.disableMFAFn(ctx, userID)
	}
	return nil
}

// --- request helpers ---

func postJSON(path string, body any) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(http.MethodPost, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	return r
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

func withUser(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.ContextKeyUserID, userID)
	return r.WithContext(ctx)
}

func withUserAndEmail(r *http.Request, userID, email string) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.ContextKeyUserID, userID)
	ctx = context.WithValue(ctx, middleware.ContextKeyEmail, email)
	return r.WithContext(ctx)
}

func decodeBody(t *testing.T, body *bytes.Buffer) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(body).Decode(&m); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	return m
}

// --- Login ---

func TestLogin(t *testing.T) {
	tests := []struct {
		name       string
		body       any
		svcFn      func(context.Context, string, string) (*service.LoginResult, error)
		wantStatus int
		check      func(t *testing.T, body map[string]any)
	}{
		{
			name:       "missing email returns 400",
			body:       map[string]string{"password": "pass1234"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing password returns 400",
			body:       map[string]string{"email": "user@example.com"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid credentials returns 401",
			body:       map[string]string{"email": "user@example.com", "password": "wrong"},
			svcFn:      func(_ context.Context, _, _ string) (*service.LoginResult, error) { return nil, service.ErrInvalidCredentials },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "unverified email returns 403",
			body:       map[string]string{"email": "user@example.com", "password": "pass1234"},
			svcFn:      func(_ context.Context, _, _ string) (*service.LoginResult, error) { return nil, service.ErrEmailNotVerified },
			wantStatus: http.StatusForbidden,
		},
		{
			name: "MFA required returns 200 with mfaRequired and mfaToken",
			body: map[string]string{"email": "user@example.com", "password": "pass1234"},
			svcFn: func(_ context.Context, _, _ string) (*service.LoginResult, error) {
				return &service.LoginResult{MFARequired: true, MFAToken: "tok123"}, nil
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body map[string]any) {
				t.Helper()
				if body["mfaRequired"] != true {
					t.Errorf("mfaRequired = %v, want true", body["mfaRequired"])
				}
				if body["mfaToken"] != "tok123" {
					t.Errorf("mfaToken = %v, want tok123", body["mfaToken"])
				}
				if _, ok := body["accessToken"]; ok {
					t.Error("accessToken should not be present when MFA is required")
				}
			},
		},
		{
			name: "successful login without MFA returns tokens",
			body: map[string]string{"email": "user@example.com", "password": "pass1234"},
			svcFn: func(_ context.Context, _, _ string) (*service.LoginResult, error) {
				return &service.LoginResult{Tokens: &service.TokenPair{AccessToken: "at", RefreshToken: "rt"}}, nil
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body map[string]any) {
				t.Helper()
				if body["accessToken"] != "at" {
					t.Errorf("accessToken = %v, want at", body["accessToken"])
				}
				if _, ok := body["mfaRequired"]; ok {
					t.Error("mfaRequired should not be present on direct login")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{loginFn: tt.svcFn}}
			w := httptest.NewRecorder()
			h.Login(w, postJSON("/api/auth/login", tt.body))
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
			if tt.check != nil {
				tt.check(t, decodeBody(t, w.Body))
			}
		})
	}
}

// --- VerifyMFALogin ---

func TestVerifyMFALogin(t *testing.T) {
	tests := []struct {
		name       string
		body       any
		svcFn      func(context.Context, string, string) (*service.TokenPair, error)
		wantStatus int
		check      func(t *testing.T, body map[string]any)
	}{
		{
			name:       "missing mfaToken returns 400",
			body:       map[string]string{"code": "123456"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing code returns 400",
			body:       map[string]string{"mfaToken": "tok123"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid or expired MFA session returns 401",
			body:       map[string]string{"mfaToken": "expired", "code": "123456"},
			svcFn:      func(_ context.Context, _, _ string) (*service.TokenPair, error) { return nil, service.ErrInvalidToken },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "invalid TOTP code returns 401",
			body:       map[string]string{"mfaToken": "tok123", "code": "000000"},
			svcFn:      func(_ context.Context, _, _ string) (*service.TokenPair, error) { return nil, errors.New("invalid TOTP code") },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "valid code returns tokens",
			body: map[string]string{"mfaToken": "tok123", "code": "654321"},
			svcFn: func(_ context.Context, _, _ string) (*service.TokenPair, error) {
				return &service.TokenPair{AccessToken: "at", RefreshToken: "rt"}, nil
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body map[string]any) {
				t.Helper()
				if body["accessToken"] != "at" {
					t.Errorf("accessToken = %v, want at", body["accessToken"])
				}
				if body["refreshToken"] != "rt" {
					t.Errorf("refreshToken = %v, want rt", body["refreshToken"])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{verifyMFALoginFn: tt.svcFn}}
			w := httptest.NewRecorder()
			h.VerifyMFALogin(w, postJSON("/api/auth/mfa/verify", tt.body))
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
			if tt.check != nil {
				tt.check(t, decodeBody(t, w.Body))
			}
		})
	}
}

// --- GetMFAStatus ---

func TestGetMFAStatus(t *testing.T) {
	tests := []struct {
		name       string
		userID     string
		svcFn      func(context.Context, string) (bool, error)
		wantStatus int
		wantBody   map[string]any
	}{
		{
			name:       "no userID in context returns 401",
			userID:     "",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "MFA disabled returns enabled:false",
			userID:     "user-1",
			svcFn:      func(_ context.Context, _ string) (bool, error) { return false, nil },
			wantStatus: http.StatusOK,
			wantBody:   map[string]any{"enabled": false},
		},
		{
			name:       "MFA enabled returns enabled:true",
			userID:     "user-1",
			svcFn:      func(_ context.Context, _ string) (bool, error) { return true, nil },
			wantStatus: http.StatusOK,
			wantBody:   map[string]any{"enabled": true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{getMFAStatusFn: tt.svcFn}}
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/auth/mfa", nil)
			if tt.userID != "" {
				req = withUser(req, tt.userID)
			}
			h.GetMFAStatus(w, req)
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
			if tt.wantBody != nil {
				body := decodeBody(t, w.Body)
				for k, v := range tt.wantBody {
					if body[k] != v {
						t.Errorf("body[%q] = %v, want %v", k, body[k], v)
					}
				}
			}
		})
	}
}

// --- SetupMFA ---

func TestSetupMFA(t *testing.T) {
	tests := []struct {
		name       string
		userID     string
		svcFn      func(context.Context, string, string) (*service.MFASetupResult, error)
		wantStatus int
		check      func(t *testing.T, body map[string]any)
	}{
		{
			name:       "no userID in context returns 401",
			userID:     "",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "service error returns 500",
			userID:     "user-1",
			svcFn:      func(_ context.Context, _, _ string) (*service.MFASetupResult, error) { return nil, errors.New("redis error") },
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:   "valid request returns otpAuthURL and secret",
			userID: "user-1",
			svcFn: func(_ context.Context, _, _ string) (*service.MFASetupResult, error) {
				return &service.MFASetupResult{OTPAuthURL: "otpauth://totp/test?secret=ABC", Secret: "ABC"}, nil
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body map[string]any) {
				t.Helper()
				if body["otpAuthURL"] != "otpauth://totp/test?secret=ABC" {
					t.Errorf("otpAuthURL = %v", body["otpAuthURL"])
				}
				if body["secret"] != "ABC" {
					t.Errorf("secret = %v", body["secret"])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{setupMFAFn: tt.svcFn}}
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/auth/mfa/setup", nil)
			if tt.userID != "" {
				req = withUserAndEmail(req, tt.userID, "user@example.com")
			}
			h.SetupMFA(w, req)
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
			if tt.check != nil {
				tt.check(t, decodeBody(t, w.Body))
			}
		})
	}
}

// --- EnableMFA ---

func TestEnableMFA(t *testing.T) {
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
			body:       map[string]string{"code": "123456"},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing code returns 400",
			userID:     "user-1",
			body:       map[string]string{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid TOTP code returns 400",
			userID:     "user-1",
			body:       map[string]string{"code": "000000"},
			svcFn:      func(_ context.Context, _, _ string) error { return errors.New("invalid TOTP code") },
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "expired setup session returns 400",
			userID:     "user-1",
			body:       map[string]string{"code": "123456"},
			svcFn:      func(_ context.Context, _, _ string) error { return errors.New("MFA setup session expired — please start over") },
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "valid code enables MFA and returns 200",
			userID:     "user-1",
			body:       map[string]string{"code": "654321"},
			svcFn:      func(_ context.Context, _, _ string) error { return nil },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{verifyAndEnableMFAFn: tt.svcFn}}
			w := httptest.NewRecorder()
			req := postJSON("/api/auth/mfa/enable", tt.body)
			if tt.userID != "" {
				req = withUser(req, tt.userID)
			}
			h.EnableMFA(w, req)
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

// --- DisableMFA ---

func TestDisableMFA(t *testing.T) {
	tests := []struct {
		name       string
		userID     string
		svcFn      func(context.Context, string) error
		wantStatus int
	}{
		{
			name:       "no userID in context returns 401",
			userID:     "",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "service error returns 500",
			userID:     "user-1",
			svcFn:      func(_ context.Context, _ string) error { return errors.New("db error") },
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "valid request disables MFA and returns 200",
			userID:     "user-1",
			svcFn:      func(_ context.Context, _ string) error { return nil },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{disableMFAFn: tt.svcFn}}
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodDelete, "/api/auth/mfa", nil)
			if tt.userID != "" {
				req = withUser(req, tt.userID)
			}
			h.DisableMFA(w, req)
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

// --- ChangePassword ---

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
			name:       "wrong current password returns 401",
			userID:     "user-1",
			body:       map[string]string{"currentPassword": "wrong", "newPassword": "new12345"},
			svcFn:      func(_ context.Context, _, _, _ string) error { return service.ErrWrongPassword },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "user not found returns 404",
			userID:     "user-1",
			body:       map[string]string{"currentPassword": "old12345", "newPassword": "new12345"},
			svcFn:      func(_ context.Context, _, _, _ string) error { return service.ErrUserNotFound },
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

// --- DeleteAccount ---

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

// --- RequestPasswordReset ---

func TestRequestPasswordReset(t *testing.T) {
	tests := []struct {
		name       string
		body       any
		svcFn      func(context.Context, string) error
		wantStatus int
	}{
		{
			name:       "missing email returns 400",
			body:       map[string]string{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "always returns 200 even when email not found",
			body:       map[string]string{"email": "notfound@example.com"},
			wantStatus: http.StatusOK,
		},
		{
			name:       "returns 200 on success",
			body:       map[string]string{"email": "user@example.com"},
			svcFn:      func(_ context.Context, _ string) error { return nil },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{requestPasswordResetFn: tt.svcFn}}
			w := httptest.NewRecorder()
			h.RequestPasswordReset(w, postJSON("/api/auth/password/reset-request", tt.body))
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

// --- ResetPassword ---

func TestResetPassword(t *testing.T) {
	tests := []struct {
		name       string
		body       any
		svcFn      func(context.Context, string, string) error
		wantStatus int
	}{
		{
			name:       "missing token returns 400",
			body:       map[string]string{"newPassword": "newpass12345"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing newPassword returns 400",
			body:       map[string]string{"token": "abc123"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "short newPassword returns 400",
			body:       map[string]string{"token": "abc123", "newPassword": "short"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid or expired token returns 400",
			body:       map[string]string{"token": "expired", "newPassword": "newpass12345"},
			svcFn:      func(_ context.Context, _, _ string) error { return service.ErrInvalidToken },
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "valid request returns 200",
			body:       map[string]string{"token": "validtoken", "newPassword": "newpass12345"},
			svcFn:      func(_ context.Context, _, _ string) error { return nil },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AuthHandler{svc: &mockAuthService{resetPasswordFn: tt.svcFn}}
			w := httptest.NewRecorder()
			h.ResetPassword(w, postJSON("/api/auth/password/reset", tt.body))
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}
