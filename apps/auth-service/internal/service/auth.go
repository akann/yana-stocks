package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/akann/yana-stocks/auth-service/internal/config"
	"github.com/akann/yana-stocks/auth-service/internal/db"
	"github.com/akann/yana-stocks/auth-service/internal/email"
	kafkapub "github.com/akann/yana-stocks/auth-service/internal/kafka"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrEmailTaken         = errors.New("email already registered")
	ErrInvalidToken       = errors.New("invalid or expired token")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrEmailNotVerified   = errors.New("email not verified")
	ErrUserNotFound       = errors.New("user not found")
	ErrWrongPassword      = errors.New("current password is incorrect")
)

type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

type MeResponse struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
}

type AuthService struct {
	cfg       *config.Config
	queries   *db.Queries
	redis     *redis.Client
	emailer   *email.Sender
	publisher *kafkapub.Publisher
}

func NewAuthService(cfg *config.Config, queries *db.Queries, rdb *redis.Client, emailer *email.Sender, publisher *kafkapub.Publisher) *AuthService {
	return &AuthService{cfg: cfg, queries: queries, redis: rdb, emailer: emailer, publisher: publisher}
}

func (s *AuthService) Register(ctx context.Context, emailAddr, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	token, err := randomHex(20)
	if err != nil {
		return err
	}

	user, err := s.queries.CreateUserWithCredential(ctx, emailAddr, string(hash), token)
	if err != nil {
		if isDuplicateKeyError(err) {
			return ErrEmailTaken
		}
		return err
	}

	go func() {
		if err := s.publisher.PublishUserRegistered(context.Background(), user.ID, user.Email); err != nil {
			log.Printf("kafka publish users.registered failed: %v", err)
		}
	}()

	go func() {
		if err := s.emailer.SendVerification(emailAddr, s.cfg.FrontendURL, token); err != nil {
			log.Printf("verification email failed for %s: %v", emailAddr, err)
		}
	}()

	return nil
}

func (s *AuthService) VerifyEmail(ctx context.Context, token string) error {
	user, err := s.queries.GetUserByVerificationToken(ctx, token)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidToken
		}
		return err
	}
	return s.queries.VerifyUser(ctx, user.ID)
}

func (s *AuthService) Login(ctx context.Context, emailAddr, password string) (*TokenPair, error) {
	user, err := s.queries.GetUserByEmailWithCredential(ctx, emailAddr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	if !user.IsVerified {
		return nil, ErrEmailNotVerified
	}

	return s.issueTokens(ctx, user.ID, user.Email)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*TokenPair, error) {
	key := refreshKey(refreshToken)
	userID, err := s.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, ErrInvalidToken
	}

	user, err := s.queries.GetUserByID(ctx, userID)
	if err != nil {
		return nil, ErrUserNotFound
	}

	s.redis.Del(ctx, key)

	return s.issueTokens(ctx, user.ID, user.Email)
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	s.redis.Del(ctx, refreshKey(refreshToken))
	return nil
}

func (s *AuthService) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	user, err := s.queries.GetUserWithCredentialByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(currentPassword)); err != nil {
		return ErrWrongPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.queries.UpdatePasswordHash(ctx, userID, string(hash))
}

func (s *AuthService) DeleteAccount(ctx context.Context, userID, password string) error {
	user, err := s.queries.GetUserWithCredentialByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return ErrWrongPassword
	}
	return s.queries.DeleteUser(ctx, userID)
}

func (s *AuthService) Me(ctx context.Context, userID string) (*MeResponse, error) {
	user, err := s.queries.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &MeResponse{UserID: user.ID, Email: user.Email}, nil
}

func (s *AuthService) issueTokens(ctx context.Context, userID, emailAddr string) (*TokenPair, error) {
	accessToken, err := s.signJWT(userID, emailAddr)
	if err != nil {
		return nil, err
	}

	refreshToken, err := randomHex(40)
	if err != nil {
		return nil, err
	}

	ttl := s.cfg.JWTRefreshExpiresIn
	if err := s.redis.Set(ctx, refreshKey(refreshToken), userID, ttl).Err(); err != nil {
		return nil, err
	}

	return &TokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, nil
}

func (s *AuthService) signJWT(userID, emailAddr string) (string, error) {
	claims := jwt.MapClaims{
		"sub":   userID,
		"email": emailAddr,
		"iss":   "yana-stocks",
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(s.cfg.JWTExpiresIn).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

func refreshKey(token string) string {
	return fmt.Sprintf("refresh:%s", token)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func isDuplicateKeyError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint"))
}
