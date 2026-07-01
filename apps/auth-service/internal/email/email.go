package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Sender struct {
	apiURL string
	apiKey string
	client *http.Client
}

func NewSender(apiURL, apiKey string) *Sender {
	return &Sender{
		apiURL: apiURL,
		apiKey: apiKey,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

type sendEmailRequest struct {
	To       []string          `json:"to"`
	Subject  string            `json:"subject"`
	HTML     string            `json:"html"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

func (s *Sender) send(to, subject, html string) error {
	payload := sendEmailRequest{
		To:       []string{to},
		Subject:  subject,
		HTML:     html,
		Metadata: map[string]string{"sourceService": "auth-service"},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal email request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, s.apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build email request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", s.apiKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("send email request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("email-api returned status %d", resp.StatusCode)
	}
	return nil
}

func (s *Sender) SendPasswordReset(to, frontendURL, token string) error {
	link := fmt.Sprintf("%s/reset-password?token=%s", frontendURL, token)
	body := fmt.Sprintf(`<p>You requested a password reset for your yana-stocks account.</p>
<p><a href="%s">Reset your password</a></p>
<p>Or copy this link: %s</p>
<p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`, link, link)

	return s.send(to, "Reset your yana-stocks password", body)
}

func (s *Sender) SendVerification(to, frontendURL, token string) error {
	link := fmt.Sprintf("%s/verify?token=%s", frontendURL, token)
	body := fmt.Sprintf(`<p>Thanks for signing up to yana-stocks.</p>
<p><a href="%s">Verify your email address</a></p>
<p>Or copy this link: %s</p>`, link, link)

	return s.send(to, "Verify your yana-stocks account", body)
}
