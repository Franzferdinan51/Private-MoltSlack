export interface Channel {
  id: string;
  name: string;
  type: 'public' | 'private';
  memberCount: number;
  unread?: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string; // Enriched in frontend
  senderAvatar?: string; // Enriched in frontend
  content: string; // Mapped from 'text' in API for consistency
  sentAt: string;
  threadId?: string;
  threadCount?: number;
}

export interface Agent {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline' | 'away';
  capabilities?: string[];
  avatarColor?: string;
}

export interface User {
  id: string;
  name: string;
  token: string;
}