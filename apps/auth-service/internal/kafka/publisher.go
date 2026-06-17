package kafka

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

const topicUsersRegistered = "users.registered"

type UserRegisteredEvent struct {
	UserID    string    `json:"userId"`
	Email     string    `json:"email"`
	Timestamp time.Time `json:"timestamp"`
}

type Publisher struct {
	writer *kafka.Writer
}

func NewPublisher(brokers string) *Publisher {
	return &Publisher{
		writer: &kafka.Writer{
			Addr:         kafka.TCP(strings.Split(brokers, ",")...),
			Balancer:     &kafka.LeastBytes{},
			RequiredAcks: kafka.RequireOne,
			Async:        true,
		},
	}
}

func (p *Publisher) PublishUserRegistered(ctx context.Context, userID, email string) error {
	payload, err := json.Marshal(UserRegisteredEvent{
		UserID:    userID,
		Email:     email,
		Timestamp: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	return p.writer.WriteMessages(ctx, kafka.Message{
		Topic: topicUsersRegistered,
		Key:   []byte(userID),
		Value: payload,
	})
}

func (p *Publisher) Close() error {
	return p.writer.Close()
}
