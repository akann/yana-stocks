package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/akann/yana-stocks/auth-service/internal/middleware"
	"github.com/akann/yana-stocks/auth-service/internal/service"
)

type authServicer interface {
	Register(ctx context.Context, email, password string) error
	VerifyEmail(ctx context.Context, token string) error
	Login(ctx context.Context, email, password string) (*service.LoginResult, error)
	VerifyMFALogin(ctx context.Context, mfaToken, code string) (*service.TokenPair, error)
	Refresh(ctx context.Context, refreshToken string) (*service.TokenPair, error)
	Logout(ctx context.Context, refreshToken string) error
	Me(ctx context.Context, userID string) (*service.MeResponse, error)
	ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error
	DeleteAccount(ctx context.Context, userID, password string) error
	RequestPasswordReset(ctx context.Context, email string) error
	ResetPassword(ctx context.Context, token, newPassword string) error
	GetMFAStatus(ctx context.Context, userID string) (bool, error)
	SetupMFA(ctx context.Context, userID, email string) (*service.MFASetupResult, error)
	VerifyAndEnableMFA(ctx context.Context, userID, code string) error
	DisableMFA(ctx context.Context, userID string) error
}

type AuthHandler struct {
	svc authServicer
}

func NewAuthHandler(svc *service.AuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
}

// Register godoc
// @Summary      Register a new user
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      RegisterRequest  true  "Email and password"
// @Success      201   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      409   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/register [post]
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" {
		jsonError(w, "email and password are required", http.StatusBadRequest)
		return
	}
	if len(body.Password) < 8 {
		jsonError(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	if err := h.svc.Register(r.Context(), body.Email, body.Password); err != nil {
		if errors.Is(err, service.ErrEmailTaken) {
			jsonError(w, "email already registered", http.StatusConflict)
			return
		}
		jsonError(w, "registration failed", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"message": "check your inbox to verify your email"}, http.StatusCreated)
}

// Verify godoc
// @Summary      Verify email address
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      VerifyEmailRequest  true  "Verification token from email"
// @Success      200   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/verify [post]
func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		jsonError(w, "token is required", http.StatusBadRequest)
		return
	}

	if err := h.svc.VerifyEmail(r.Context(), body.Token); err != nil {
		if errors.Is(err, service.ErrInvalidToken) {
			jsonError(w, "invalid or expired token", http.StatusBadRequest)
			return
		}
		jsonError(w, "verification failed", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"message": "email verified, you can now log in"}, http.StatusOK)
}

// Login godoc
// @Summary      Login with email and password
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      LoginRequest       true  "Credentials"
// @Success      200   {object}  TokenPairResponse  "Tokens issued (or MFA challenge if MFA is enabled)"
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      403   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/login [post]
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" {
		jsonError(w, "email and password are required", http.StatusBadRequest)
		return
	}

	result, err := h.svc.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidCredentials):
			jsonError(w, "invalid email or password", http.StatusUnauthorized)
		case errors.Is(err, service.ErrEmailNotVerified):
			jsonError(w, "please verify your email before logging in", http.StatusForbidden)
		default:
			jsonError(w, "login failed", http.StatusInternalServerError)
		}
		return
	}

	if result.MFARequired {
		jsonOK(w, map[string]any{"mfaRequired": true, "mfaToken": result.MFAToken}, http.StatusOK)
		return
	}

	jsonOK(w, result.Tokens, http.StatusOK)
}

// VerifyMFALogin godoc
// @Summary      Complete MFA login with TOTP code
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      MFAVerifyLoginRequest  true  "MFA session token and 6-digit TOTP code"
// @Success      200   {object}  TokenPairResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/mfa/verify [post]
func (h *AuthHandler) VerifyMFALogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MFAToken string `json:"mfaToken"`
		Code     string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MFAToken == "" || body.Code == "" {
		jsonError(w, "mfaToken and code are required", http.StatusBadRequest)
		return
	}

	tokens, err := h.svc.VerifyMFALogin(r.Context(), body.MFAToken, body.Code)
	if err != nil {
		if errors.Is(err, service.ErrInvalidToken) {
			jsonError(w, "invalid or expired MFA session", http.StatusUnauthorized)
			return
		}
		jsonError(w, err.Error(), http.StatusUnauthorized)
		return
	}

	jsonOK(w, tokens, http.StatusOK)
}

// Refresh godoc
// @Summary      Rotate refresh token and issue new access token
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      RefreshRequest    true  "Current refresh token"
// @Success      200   {object}  TokenPairResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/refresh [post]
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		jsonError(w, "refreshToken is required", http.StatusBadRequest)
		return
	}

	tokens, err := h.svc.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		if errors.Is(err, service.ErrInvalidToken) {
			jsonError(w, "invalid or expired refresh token", http.StatusUnauthorized)
			return
		}
		jsonError(w, "refresh failed", http.StatusInternalServerError)
		return
	}

	jsonOK(w, tokens, http.StatusOK)
}

// Logout godoc
// @Summary      Invalidate refresh token
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      LogoutRequest   true  "Refresh token to revoke"
// @Success      200   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Router       /api/auth/logout [post]
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		jsonError(w, "refreshToken is required", http.StatusBadRequest)
		return
	}

	h.svc.Logout(r.Context(), body.RefreshToken)
	jsonOK(w, map[string]string{"message": "logged out"}, http.StatusOK)
}

// ChangePassword godoc
// @Summary      Change password (JWT required)
// @Tags         auth
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      ChangePasswordRequest  true  "Current and new password"
// @Success      200   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/password [put]
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.CurrentPassword == "" || body.NewPassword == "" {
		jsonError(w, "currentPassword and newPassword are required", http.StatusBadRequest)
		return
	}
	if len(body.NewPassword) < 8 {
		jsonError(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	if err := h.svc.ChangePassword(r.Context(), userID, body.CurrentPassword, body.NewPassword); err != nil {
		switch {
		case errors.Is(err, service.ErrWrongPassword):
			jsonError(w, "current password is incorrect", http.StatusUnauthorized)
		case errors.Is(err, service.ErrUserNotFound):
			jsonError(w, "user not found", http.StatusNotFound)
		default:
			jsonError(w, "failed to change password", http.StatusInternalServerError)
		}
		return
	}

	jsonOK(w, map[string]string{"message": "password updated"}, http.StatusOK)
}

// DeleteAccount godoc
// @Summary      Delete account permanently (JWT required)
// @Tags         auth
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      DeleteAccountRequest  true  "Password confirmation"
// @Success      200   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/account [delete]
func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		jsonError(w, "password is required", http.StatusBadRequest)
		return
	}

	if err := h.svc.DeleteAccount(r.Context(), userID, body.Password); err != nil {
		switch {
		case errors.Is(err, service.ErrWrongPassword):
			jsonError(w, "incorrect password", http.StatusUnauthorized)
		case errors.Is(err, service.ErrUserNotFound):
			jsonError(w, "user not found", http.StatusNotFound)
		default:
			jsonError(w, "failed to delete account", http.StatusInternalServerError)
		}
		return
	}

	jsonOK(w, map[string]string{"message": "account deleted"}, http.StatusOK)
}

// Me godoc
// @Summary      Get current user info (JWT required)
// @Tags         auth
// @Produce      json
// @Security     BearerAuth
// @Success      200   {object}  MeSwaggerResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      404   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/me [get]
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	me, err := h.svc.Me(r.Context(), userID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			jsonError(w, "user not found", http.StatusNotFound)
			return
		}
		jsonError(w, "failed to fetch user", http.StatusInternalServerError)
		return
	}

	jsonOK(w, me, http.StatusOK)
}

// RequestPasswordReset godoc
// @Summary      Request a password reset email
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      PasswordResetRequestBody  true  "Registered email address"
// @Success      200   {object}  MessageResponse           "Always 200 — no email enumeration"
// @Failure      400   {object}  ErrorResponse
// @Router       /api/auth/password/reset-request [post]
func (h *AuthHandler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
		jsonError(w, "email is required", http.StatusBadRequest)
		return
	}

	// Always 200 — don't reveal whether the email is registered.
	_ = h.svc.RequestPasswordReset(r.Context(), body.Email)
	jsonOK(w, map[string]string{"message": "if that email is registered you will receive a reset link"}, http.StatusOK)
}

// ResetPassword godoc
// @Summary      Reset password using emailed token
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      ResetPasswordRequest  true  "Reset token and new password"
// @Success      200   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /api/auth/password/reset [post]
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token       string `json:"token"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" || body.NewPassword == "" {
		jsonError(w, "token and newPassword are required", http.StatusBadRequest)
		return
	}
	if len(body.NewPassword) < 8 {
		jsonError(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	if err := h.svc.ResetPassword(r.Context(), body.Token, body.NewPassword); err != nil {
		if errors.Is(err, service.ErrInvalidToken) {
			jsonError(w, "invalid or expired reset link", http.StatusBadRequest)
			return
		}
		jsonError(w, "password reset failed", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"message": "password reset successfully"}, http.StatusOK)
}

// GetMFAStatus godoc
// @Summary      Get MFA enabled status (JWT required)
// @Tags         mfa
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  MFAStatusResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /api/auth/mfa [get]
func (h *AuthHandler) GetMFAStatus(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	enabled, err := h.svc.GetMFAStatus(r.Context(), userID)
	if err != nil {
		jsonError(w, "failed to get MFA status", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]bool{"enabled": enabled}, http.StatusOK)
}

// SetupMFA godoc
// @Summary      Generate TOTP secret for MFA setup (JWT required)
// @Tags         mfa
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  MFASetupResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /api/auth/mfa/setup [post]
func (h *AuthHandler) SetupMFA(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	email, _ := r.Context().Value(middleware.ContextKeyEmail).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	result, err := h.svc.SetupMFA(r.Context(), userID, email)
	if err != nil {
		jsonError(w, "failed to generate MFA secret", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"otpAuthURL": result.OTPAuthURL, "secret": result.Secret}, http.StatusOK)
}

// EnableMFA godoc
// @Summary      Verify TOTP code and enable MFA (JWT required)
// @Tags         mfa
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      MFAEnableRequest  true  "6-digit TOTP code from authenticator app"
// @Success      200   {object}  MessageResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Router       /api/auth/mfa/enable [post]
func (h *AuthHandler) EnableMFA(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		jsonError(w, "code is required", http.StatusBadRequest)
		return
	}
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := h.svc.VerifyAndEnableMFA(r.Context(), userID, body.Code); err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonOK(w, map[string]string{"message": "MFA enabled"}, http.StatusOK)
}

// DisableMFA godoc
// @Summary      Disable MFA (JWT required)
// @Tags         mfa
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  MessageResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /api/auth/mfa [delete]
func (h *AuthHandler) DisableMFA(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middleware.ContextKeyUserID).(string)
	if userID == "" {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := h.svc.DisableMFA(r.Context(), userID); err != nil {
		jsonError(w, "failed to disable MFA", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"message": "MFA disabled"}, http.StatusOK)
}

func jsonOK(w http.ResponseWriter, body any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
