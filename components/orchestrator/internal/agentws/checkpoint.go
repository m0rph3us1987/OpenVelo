package agentws

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Manager struct {
	mu               sync.RWMutex
	activeAgents     map[int64]*websocket.Conn
	stoppedJobs      map[int64]bool
	wssShuttingDown  bool
}

var DefaultManager = NewManager()

func NewManager() *Manager {
	return &Manager{
		activeAgents: make(map[int64]*websocket.Conn),
		stoppedJobs:  make(map[int64]bool),
	}
}

func (m *Manager) SetShuttingDown(value bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.wssShuttingDown = value
}

func (m *Manager) IsShuttingDown() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.wssShuttingDown
}

func (m *Manager) MarkJobAsStoppedByUser(jobID int64) {
	m.mu.Lock()
	m.stoppedJobs[jobID] = true
	ws, exists := m.activeAgents[jobID]
	m.mu.Unlock()

	if exists && ws != nil {
		ws.Close()
	}
}

func (m *Manager) IsJobStopped(jobID int64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.stoppedJobs[jobID]
}

func (m *Manager) ClearStoppedJob(jobID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.stoppedJobs, jobID)
}

func (m *Manager) RegisterAgent(jobID int64, conn *websocket.Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.activeAgents[jobID] = conn
}

func (m *Manager) UnregisterAgent(jobID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.activeAgents, jobID)
}

func (m *Manager) CheckpointAllAgents() {
	m.mu.RLock()
	agents := make(map[int64]*websocket.Conn)
	for k, v := range m.activeAgents {
		agents[k] = v
	}
	m.mu.RUnlock()

	var wg sync.WaitGroup
	for jobID, conn := range agents {
		wg.Add(1)
		go func(jID int64, c *websocket.Conn) {
			defer wg.Done()
			m.CheckpointAgent(jID, c)
		}(jobID, conn)
	}
	wg.Wait()
}

func (m *Manager) CheckpointAgent(jobID int64, conn *websocket.Conn) {
	if conn == nil {
		return
	}
	done := make(chan struct{})
	timer := time.NewTimer(60 * time.Second)
	defer timer.Stop()

	msg := map[string]string{"type": "checkpoint"}
	data, _ := json.Marshal(msg)
	_ = conn.WriteMessage(websocket.TextMessage, data)

	go func() {
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				close(done)
				return
			}
			var payload struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(message, &payload); err == nil {
				if payload.Type == "checkpoint_done" {
					fmt.Printf("[JOB %d] Checkpoint acknowledged.\n", jobID)
					close(done)
					return
				}
			}
		}
	}()

	select {
	case <-done:
	case <-timer.C:
		fmt.Printf("[JOB %d] Checkpoint grace period elapsed.\n", jobID)
	}
}
