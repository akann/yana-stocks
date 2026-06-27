package handler

// Request types

type RegisterRequest struct {
	Email    string `json:"email" example:"user@example.com"`
	Password string `json:"password" example:"s3cr3tPass1"`
}

type VerifyEmailRequest struct {
	Token string `json:"token" example:"3f9a2d1c4b5e6a7f8d9c0b1a2e3f4d5c6b7a8e9f0c1d2b3a"`
}

type LoginRequest struct {
	Email    string `json:"email" example:"user@example.com"`
	Password string `json:"password" example:"s3cr3tPass1"`
}

type MFAVerifyLoginRequest struct {
	MFAToken string `json:"mfaToken" example:"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"`
	Code     string `json:"code" example:"123456"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" example:"a3f9b2e1d4c76a85b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refreshToken" example:"a3f9b2e1d4c76a85b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" example:"oldPass123"`
	NewPassword     string `json:"newPassword" example:"newPass456"`
}

type DeleteAccountRequest struct {
	Password string `json:"password" example:"s3cr3tPass1"`
}

type PasswordResetRequestBody struct {
	Email string `json:"email" example:"user@example.com"`
}

type ResetPasswordRequest struct {
	Token       string `json:"token" example:"3f9a2d1c4b5e6a7f8d9c0b1a2e3f4d5c"`
	NewPassword string `json:"newPassword" example:"newPass456"`
}

type MFAEnableRequest struct {
	Code string `json:"code" example:"123456"`
}

// Response types

type MessageResponse struct {
	Message string `json:"message" example:"check your inbox to verify your email"`
}

type ErrorResponse struct {
	Error string `json:"error" example:"email and password are required"`
}

type TokenPairResponse struct {
	AccessToken  string `json:"accessToken" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2NTU0NDAwMDAiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJpc3MiOiJ5YW5hLXN0b2NrcyIsImlhdCI6MTcwNTMyNDgwMCwiZXhwIjoxNzA1MzI1NzAwfQ.sig"`
	RefreshToken string `json:"refreshToken" example:"a3f9b2e1d4c76a85b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"`
}

type MFAChallengeResponse struct {
	MFARequired bool   `json:"mfaRequired" example:"true"`
	MFAToken    string `json:"mfaToken" example:"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"`
}

type MeSwaggerResponse struct {
	UserID string `json:"userId" example:"550e8400-e29b-41d4-a716-446655440000"`
	Email  string `json:"email" example:"user@example.com"`
}

type MFAStatusResponse struct {
	Enabled bool `json:"enabled" example:"false"`
}

type MFASetupResponse struct {
	OTPAuthURL string `json:"otpAuthURL" example:"otpauth://totp/yana-stocks:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=yana-stocks"`
	Secret     string `json:"secret" example:"JBSWY3DPEHPK3PXP"`
}
