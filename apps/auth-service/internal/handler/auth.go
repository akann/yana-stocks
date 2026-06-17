package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/akann/yana-stocks/auth-service/internal/middleware"
	"github.com/akann/yana-stocks/auth-service/internal/service"
)

type AuthHandler struct {
	svc *service.AuthService
}

func NewAuthHandler(svc *service.AuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
}

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

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" {
		jsonError(w, "email and password are required", http.StatusBadRequest)
		return
	}

	tokens, err := h.svc.Login(r.Context(), body.Email, body.Password)
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

	jsonOK(w, tokens, http.StatusOK)
}

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
