package wsclient

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"openvelo/orchestrator/internal/config"
)

type MessageHandler func(data []byte)

type Client struct {
	mu                 sync.Mutex
	ws                 *websocket.Conn
	connectedProjectID int64
	handlers           []MessageHandler
	sendChan           chan []byte
	stopChan           chan struct{}
	reconnectAttempts  int
}

var DefaultClient *Client
var once sync.Once

func GetClient() *Client {
	once.Do(func() {
		DefaultClient = NewClient()
	})
	return DefaultClient
}

func NewClient() *Client {
	return &Client{
		handlers: make([]MessageHandler, 0),
		sendChan: make(chan []byte, 256),
		stopChan: make(chan struct{}),
	}
}

func (c *Client) OnMessage(handler MessageHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers = append(c.handlers, handler)
}

func (c *Client) Send(msg interface{}) bool {
	c.mu.Lock()
	conn := c.ws
	c.mu.Unlock()

	if conn == nil {
		return false
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return false
	}

	select {
	case c.sendChan <- data:
		return true
	default:
		fmt.Println("[WS] Warning: send channel full, dropping message")
		return false
	}
}

func (c *Client) GetNextJobs(count int) bool {
	c.mu.Lock()
	pid := c.connectedProjectID
	c.mu.Unlock()
	if pid == 0 {
		return false
	}
	return c.Send(map[string]interface{}{
		"type":      "get_next_jobs",
		"count":     count,
		"projectId": pid,
	})
}

func (c *Client) Connect(projectID int64) {
	c.mu.Lock()
	c.connectedProjectID = projectID
	c.mu.Unlock()
	go c.connectLoop()
}

func (c *Client) connectLoop() {
	for {
		select {
		case <-c.stopChan:
			return
		default:
		}

		c.mu.Lock()
		pid := c.connectedProjectID
		cfg := config.Instance.GetSnapshot()
		c.mu.Unlock()

		url := fmt.Sprintf("%s/api/orchestrator/ws?projectId=%d", cfg.WebUIURL, pid)
		fmt.Printf("[WS] Connecting to web-ui at %s...\n", url)

		dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
		conn, _, err := dialer.Dial(url, http.Header{})
		if err != nil {
			c.reconnectAttempts++
			delay := time.Duration(math.Min(float64(1000*math.Pow(2, float64(c.reconnectAttempts))), 30000)) * time.Millisecond
			fmt.Printf("[WS] Connection error: %v. Reconnecting in %v (attempt %d)...\n", err, delay, c.reconnectAttempts)
			time.Sleep(delay)
			continue
		}

		c.mu.Lock()
		c.ws = conn
		c.reconnectAttempts = 0
		c.mu.Unlock()

		fmt.Println("[WS] Connected to web-ui.")
		c.Send(map[string]interface{}{
			"type":      "hello",
			"projectId": pid,
		})

		connDone := make(chan struct{})
		go c.writeLoop(conn, connDone)
		c.readLoop(conn)

		close(connDone)
		c.mu.Lock()
		c.ws = nil
		c.mu.Unlock()

		fmt.Println("[WS] Connection to web-ui closed.")
		time.Sleep(1 * time.Second)
	}
}

func (c *Client) readLoop(conn *websocket.Conn) {
	conn.SetPingHandler(func(appData string) error {
		return conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(5*time.Second))
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}
		c.mu.Lock()
		handlers := make([]MessageHandler, len(c.handlers))
		copy(handlers, c.handlers)
		c.mu.Unlock()

		for _, handler := range handlers {
			handler(message)
		}
	}
}

func (c *Client) writeLoop(conn *websocket.Conn, connDone chan struct{}) {
	for {
		select {
		case <-connDone:
			return
		case data := <-c.sendChan:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		}
	}
}
