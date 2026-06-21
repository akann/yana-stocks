package email

import (
	"fmt"

	"gopkg.in/gomail.v2"
)

type Sender struct {
	host     string
	port     int
	username string
	password string
	from     string
}

func NewSender(host string, port int, username, password, from string) *Sender {
	return &Sender{host: host, port: port, username: username, password: password, from: from}
}

func (s *Sender) SendPasswordReset(to, frontendURL, token string) error {
	link := fmt.Sprintf("%s/reset-password?token=%s", frontendURL, token)
	body := fmt.Sprintf(`<p>You requested a password reset for your yana-stocks account.</p>
<p><a href="%s">Reset your password</a></p>
<p>Or copy this link: %s</p>
<p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`, link, link)

	m := gomail.NewMessage()
	m.SetHeader("From", s.from)
	m.SetHeader("To", to)
	m.SetHeader("Subject", "Reset your yana-stocks password")
	m.SetBody("text/html", body)

	d := gomail.NewDialer(s.host, s.port, s.username, s.password)
	return d.DialAndSend(m)
}

func (s *Sender) SendVerification(to, frontendURL, token string) error {
	link := fmt.Sprintf("%s/verify?token=%s", frontendURL, token)
	body := fmt.Sprintf(`<p>Thanks for signing up to yana-stocks.</p>
<p><a href="%s">Verify your email address</a></p>
<p>Or copy this link: %s</p>`, link, link)

	m := gomail.NewMessage()
	m.SetHeader("From", s.from)
	m.SetHeader("To", to)
	m.SetHeader("Subject", "Verify your yana-stocks account")
	m.SetBody("text/html", body)

	d := gomail.NewDialer(s.host, s.port, s.username, s.password)
	return d.DialAndSend(m)
}
