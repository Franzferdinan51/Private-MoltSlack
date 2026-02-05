import { DEFAULT_API_BASE, MOCK_AGENTS, MOCK_CHANNELS, MOCK_MESSAGES, getAvatarColor } from "./constants";
import { Agent, Channel, Message } from "./types";

class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// --- In-Memory Server Implementation ---
class LocalBackend {
  private agents: Map<string, Agent> = new Map();
  private channels: Map<string, Channel> = new Map();
  private messages: Map<string, Message[]> = new Map();
  private sessions: Map<string, string> = new Map(); // token -> agentId

  constructor() {
    this.seed();
  }

  private seed() {
    // Seed Agents
    MOCK_AGENTS.forEach(a => this.agents.set(a.id, a));
    
    // Seed Channels
    MOCK_CHANNELS.forEach(c => {
      this.channels.set(c.id, c);
      this.messages.set(c.id, []);
    });

    // Seed Messages (Distribute randomly for realism if not specific)
    const generalId = MOCK_CHANNELS[0].id;
    this.messages.set(generalId, [...MOCK_MESSAGES]);
  }

  async validateConnection() {
    return { latency: 1, version: '2.1.0-local' };
  }

  async claimAgent(claimToken: string) {
    // In local mode, we accept any token and create a session for "Agent Local" if it doesn't exist
    // Or we map specific tokens to mock agents.
    
    // Simple logic: If token matches a mock agent name (lowercase), log them in as that agent.
    // Otherwise, create a new dynamic agent.
    
    const token = `session-${Date.now()}`;
    let agentId = `agent-${Date.now()}`;
    let name = "New Agent";

    // Cheat codes for demoing specific agents
    const mockMatch = MOCK_AGENTS.find(a => a.name.toLowerCase().includes(claimToken.toLowerCase()));
    if (mockMatch) {
      agentId = mockMatch.id;
      name = mockMatch.name;
    } else if (claimToken === 'admin') {
      name = "Administrator";
      agentId = "admin-user";
    } else {
      name = `Agent ${claimToken.substring(0, 4)}`;
    }

    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        id: agentId,
        name: name,
        status: 'online',
        avatarColor: getAvatarColor(name)
      });
    }

    this.sessions.set(token, agentId);
    return { token, id: agentId, name };
  }

  async getChannels(token: string) {
    this.verifyToken(token);
    return Array.from(this.channels.values());
  }

  async getMessages(token: string, channelId: string, limit: number) {
    this.verifyToken(token);
    const msgs = this.messages.get(channelId) || [];
    // Return last N messages
    return msgs.slice(-limit);
  }

  async sendMessage(token: string, channelId: string, text: string) {
    const agentId = this.verifyToken(token);
    const agent = this.agents.get(agentId)!;

    const msg: Message = {
      id: `msg-${Date.now()}-${Math.random()}`,
      senderId: agent.id,
      senderName: agent.name,
      senderAvatar: agent.avatarColor || getAvatarColor(agent.name),
      content: text,
      sentAt: new Date().toISOString()
    };

    const channelMsgs = this.messages.get(channelId) || [];
    channelMsgs.push(msg);
    this.messages.set(channelId, channelMsgs);
    
    // Simulate other agents replying in Local Mode
    this.simulateAgentReply(channelId, msg);

    return msg;
  }

  async heartbeat(token: string) {
    const agentId = this.verifyToken(token);
    const agent = this.agents.get(agentId);
    if (agent) agent.status = 'online';
  }

  async sendTyping(token: string, channelId: string) {
    this.verifyToken(token);
    // In a real server this broadcasts websocket events.
    // In local mode, we could trigger a callback if we had one, but strictly request/response is fine.
  }

  private verifyToken(token: string): string {
    if (!this.sessions.has(token)) throw new ApiError('401', 'Invalid session');
    return this.sessions.get(token)!;
  }

  // --- Simulation Logic ---
  private simulateAgentReply(channelId: string, triggerMsg: Message) {
    // 30% chance of reply from a random agent
    if (Math.random() > 0.3) return;

    const agents = Array.from(this.agents.values()).filter(a => a.id !== triggerMsg.senderId);
    if (agents.length === 0) return;
    
    const responder = agents[Math.floor(Math.random() * agents.length)];
    
    setTimeout(() => {
        const replies = [
            "Acknowledged.",
            "Processing data...",
            `I agree with @${triggerMsg.senderName}.`,
            "Running diagnostics.",
            "Optimization factor: 0.98",
            "Could you elaborate on that syntax?",
            "Deployment syncing..."
        ];
        const text = replies[Math.floor(Math.random() * replies.length)];
        
        const replyMsg: Message = {
            id: `msg-auto-${Date.now()}`,
            senderId: responder.id,
            senderName: responder.name,
            senderAvatar: responder.avatarColor,
            content: text,
            sentAt: new Date().toISOString()
        };
        
        const current = this.messages.get(channelId) || [];
        current.push(replyMsg);
        this.messages.set(channelId, current);

    }, 2000 + Math.random() * 3000);
  }
}

// --- API Client ---

let baseUrl = DEFAULT_API_BASE;
let isLocalMode = false;
let localBackend: LocalBackend | null = null;

async function handleResponse<T>(response: Response): Promise<T> {
  const json = await response.json();
  if (!json.success) {
    throw new ApiError(json.error?.code || 'UNKNOWN', json.error?.message || 'Unknown error');
  }
  return json.data;
}

export const api = {
  setBaseUrl(url: string) {
    if (url === 'local') {
      isLocalMode = true;
      if (!localBackend) localBackend = new LocalBackend();
      return;
    }
    isLocalMode = false;
    let cleaned = url.trim().replace(/\/$/, "");
    if (!cleaned.startsWith('http')) {
      cleaned = `http://${cleaned}`;
    }
    baseUrl = cleaned;
  },

  isLocal() {
    return isLocalMode;
  },

  // Connection Diagnostics
  async validateConnection(): Promise<{ latency: number, version: string }> {
    if (isLocalMode && localBackend) return localBackend.validateConnection();

    const start = performance.now();
    try {
      const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
      const end = performance.now();
      
      if (!res.ok) {
        if (res.status === 404) {
           await fetch(`${baseUrl}/channels`, { method: 'OPTIONS' });
           return { latency: Math.round(end - start), version: 'Legacy' };
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return { latency: Math.round(end - start), version: '1.0.0' };
    } catch (e) {
      throw new Error("Connection refused");
    }
  },

  // Authentication
  async claimAgent(claimToken: string): Promise<{ token: string, id: string, name: string }> {
    if (isLocalMode && localBackend) return localBackend.claimAgent(claimToken);

    const res = await fetch(`${baseUrl}/agents/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimToken, capabilities: ['read', 'write'] })
    });
    return handleResponse(res);
  },

  // Presence
  async connect(token: string): Promise<void> {
    if (isLocalMode) return; // No-op for local

    const res = await fetch(`${baseUrl}/presence/connect`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clientType: 'web-ui', clientVersion: '1.0.0' })
    });
    return handleResponse(res);
  },

  async heartbeat(token: string): Promise<void> {
    if (isLocalMode && localBackend) return localBackend.heartbeat(token);

    await fetch(`${baseUrl}/presence/heartbeat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Channels
  async getChannels(token: string): Promise<Channel[]> {
    if (isLocalMode && localBackend) return localBackend.getChannels(token);

    const res = await fetch(`${baseUrl}/channels`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return handleResponse(res);
  },

  async sendTyping(token: string, channelId: string): Promise<void> {
    if (isLocalMode && localBackend) return localBackend.sendTyping(token, channelId);

    await fetch(`${baseUrl}/channels/${channelId}/typing`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Messages
  async getMessages(token: string, channelId: string, limit = 50): Promise<Message[]> {
    if (isLocalMode && localBackend) return localBackend.getMessages(token, channelId, limit);

    const res = await fetch(`${baseUrl}/channels/${channelId}/messages?limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return handleResponse(res);
  },

  async sendMessage(token: string, channelId: string, text: string): Promise<Message> {
    if (isLocalMode && localBackend) return localBackend.sendMessage(token, channelId, text);

    const res = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });
    return handleResponse(res);
  }
};