package kafka

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

const topicUsersRegistered = "users.registered"

// kafkaHeaderCarrier adapts kafka-go's []kafka.Header (a slice, not a map) to
// propagation.TextMapCarrier so otel.GetTextMapPropagator().Inject can write a
// W3C traceparent header onto an outgoing message. There's no official OTel
// instrumentation package for segmentio/kafka-go (unlike kafkajs/confluent-kafka),
// so this is hand-rolled — the consuming side just needs a standard
// traceparent header, regardless of what produced it.
type kafkaHeaderCarrier struct {
	headers *[]kafka.Header
}

func (c kafkaHeaderCarrier) Get(key string) string {
	for _, h := range *c.headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

func (c kafkaHeaderCarrier) Set(key, value string) {
	for i, h := range *c.headers {
		if h.Key == key {
			(*c.headers)[i].Value = []byte(value)
			return
		}
	}
	*c.headers = append(*c.headers, kafka.Header{Key: key, Value: []byte(value)})
}

func (c kafkaHeaderCarrier) Keys() []string {
	keys := make([]string, len(*c.headers))
	for i, h := range *c.headers {
		keys[i] = h.Key
	}
	return keys
}

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

	ctx, span := otel.Tracer("auth-service/kafka").Start(ctx, "send "+topicUsersRegistered,
		trace.WithSpanKind(trace.SpanKindProducer),
	)
	defer span.End()

	var headers []kafka.Header
	otel.GetTextMapPropagator().Inject(ctx, kafkaHeaderCarrier{headers: &headers})

	err = p.writer.WriteMessages(ctx, kafka.Message{
		Topic:   topicUsersRegistered,
		Key:     []byte(userID),
		Value:   payload,
		Headers: headers,
	})
	if err != nil {
		span.RecordError(err)
	}
	return err
}

func (p *Publisher) Close() error {
	return p.writer.Close()
}
