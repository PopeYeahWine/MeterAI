// AI Provider definitions with categories and versions

export type ProviderCategory =
  | 'coding'      // AI for coding/development
  | 'chat'        // General chat/assistant
  | 'image'       // Image generation
  | 'video'       // Video generation
  | 'audio'       // Audio/Music generation
  | 'multimodal'  // Multiple capabilities

export type ProviderTier = 'free' | 'pro' | 'enterprise' | 'api'

// Tracking implementation status
export type TrackingStatus =
  | 'available'              // Already implemented (e.g., Claude Pro/Max)
  | 'coming-soon'            // Faisable - Official API available, implementation planned
  | 'roadmap'                // Complexe - Requires workarounds or limited API
  | 'partnership'            // Manuel/Impossible - Awaiting or seeking partnership

export interface ProviderDefinition {
  id: string
  brand: string        // Company/Brand name (e.g., "Anthropic", "OpenAI")
  name: string         // Product version name (e.g., "Claude Pro/Max", "ChatGPT Plus/Pro")
  icon: string
  color: string
  category: ProviderCategory
  tier: ProviderTier
  website: string
  hasUsageApi: boolean
  usageMethod?: string // How usage is tracked (e.g., "oauth", "api-key", "none")
  parentId?: string    // For grouping related providers (e.g., all Claude variants)
  trackingStatus: TrackingStatus // Implementation status for usage tracking
}

// All supported AI providers - versions with same config are merged
export const AI_PROVIDERS: ProviderDefinition[] = [
  // ========== CODING / DEVELOPMENT ==========

  // Anthropic Claude (Pro/Max merged - same OAuth tracking via Claude Code)
  {
    id: 'claude-pro-max',
    brand: 'Anthropic',
    name: 'Claude Pro/Max',
    icon: 'C',
    color: '#d97706',
    category: 'coding',
    tier: 'pro',
    website: 'https://claude.ai',
    hasUsageApi: true,
    usageMethod: 'oauth',
    parentId: 'anthropic',
    trackingStatus: 'available'
  },
  // Claude API (separate - uses API key billing) - Faisable
  {
    id: 'claude-api',
    brand: 'Anthropic',
    name: 'Claude API',
    icon: 'C',
    color: '#d97706',
    category: 'coding',
    tier: 'api',
    website: 'https://anthropic.com',
    hasUsageApi: true,
    usageMethod: 'api-key',
    parentId: 'anthropic',
    trackingStatus: 'coming-soon'
  },

  // OpenAI (Plus/Pro merged - NO official API for subscription usage) - Impossible
  {
    id: 'chatgpt-plus-pro',
    brand: 'OpenAI',
    name: 'ChatGPT Plus/Pro',
    icon: 'O',
    color: '#10a37f',
    category: 'coding',
    tier: 'pro',
    website: 'https://chat.openai.com',
    hasUsageApi: false,
    usageMethod: 'none',
    parentId: 'openai',
    trackingStatus: 'partnership'
  },
  // OpenAI API (separate billing) - Available
  {
    id: 'openai-api',
    brand: 'OpenAI',
    name: 'OpenAI API',
    icon: 'O',
    color: '#10a37f',
    category: 'coding',
    tier: 'api',
    website: 'https://openai.com',
    hasUsageApi: true,
    usageMethod: 'api-key',
    parentId: 'openai',
    trackingStatus: 'available'
  },

  // GitHub Copilot (Individual/Business merged) - Complexe (API v7 avec limites)
  {
    id: 'copilot',
    brand: 'GitHub',
    name: 'Copilot',
    icon: 'GH',
    color: '#238636',
    category: 'coding',
    tier: 'pro',
    website: 'https://github.com/features/copilot',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'roadmap'
  },

  // Cursor AI (Pro only - dashboard only) - Manuel
  {
    id: 'cursor-pro',
    brand: 'Cursor',
    name: 'Cursor Pro',
    icon: 'Cu',
    color: '#7c3aed',
    category: 'coding',
    tier: 'pro',
    website: 'https://cursor.sh',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Tabnine - Impossible (no public API)
  {
    id: 'tabnine-pro',
    brand: 'Tabnine',
    name: 'Tabnine Pro',
    icon: 'Tb',
    color: '#ca4c28',
    category: 'coding',
    tier: 'pro',
    website: 'https://tabnine.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Amazon Q - Complexe (via AWS Billing API, config requise)
  {
    id: 'amazon-q',
    brand: 'Amazon',
    name: 'Q Developer',
    icon: 'AQ',
    color: '#ff9900',
    category: 'coding',
    tier: 'pro',
    website: 'https://aws.amazon.com/q/developer',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'roadmap'
  },

  // Replit - Impossible (no public API for usage)
  {
    id: 'replit-core',
    brand: 'Replit',
    name: 'Replit Core',
    icon: 'R',
    color: '#f26207',
    category: 'coding',
    tier: 'pro',
    website: 'https://replit.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // ========== CHAT / GENERAL ASSISTANT ==========

  // Google Gemini (Advanced only) - Manuel (dashboard only)
  {
    id: 'gemini-advanced',
    brand: 'Google',
    name: 'Gemini Advanced',
    icon: 'G',
    color: '#4285f4',
    category: 'chat',
    tier: 'pro',
    website: 'https://gemini.google.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Mistral (Le Chat Pro/API merged) - Faisable pour API
  {
    id: 'mistral',
    brand: 'Mistral',
    name: 'Le Chat/API',
    icon: 'M',
    color: '#f54e42',
    category: 'chat',
    tier: 'pro',
    website: 'https://chat.mistral.ai',
    hasUsageApi: true,
    usageMethod: 'api-key',
    trackingStatus: 'coming-soon'
  },

  // Perplexity - Manuel (dashboard only, API is separate)
  {
    id: 'perplexity-pro',
    brand: 'Perplexity',
    name: 'Perplexity Pro',
    icon: 'Px',
    color: '#1fb8cd',
    category: 'chat',
    tier: 'pro',
    website: 'https://perplexity.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // xAI Grok - Manuel (dashboard only)
  {
    id: 'grok',
    brand: 'xAI',
    name: 'Grok Premium+',
    icon: 'X',
    color: '#1da1f2',
    category: 'chat',
    tier: 'pro',
    website: 'https://x.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Poe - Impossible (no public API)
  {
    id: 'poe',
    brand: 'Quora',
    name: 'Poe Subscription',
    icon: 'Po',
    color: '#6366f1',
    category: 'chat',
    tier: 'pro',
    website: 'https://poe.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // ========== IMAGE GENERATION ==========

  // Midjourney (Standard/Pro merged) - Manuel (dashboard only)
  {
    id: 'midjourney',
    brand: 'Midjourney',
    name: 'MJ Standard/Pro',
    icon: 'Mj',
    color: '#0a0a0a',
    category: 'image',
    tier: 'pro',
    website: 'https://midjourney.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // DALL-E (via ChatGPT - no separate tracking) - Impossible
  {
    id: 'dalle',
    brand: 'OpenAI',
    name: 'DALL-E 3',
    icon: 'DE',
    color: '#10a37f',
    category: 'image',
    tier: 'pro',
    website: 'https://openai.com/dall-e-3',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Stable Diffusion - Faisable (API officielle)
  {
    id: 'stability',
    brand: 'Stability',
    name: 'Stability/DreamStudio',
    icon: 'SD',
    color: '#8b5cf6',
    category: 'image',
    tier: 'pro',
    website: 'https://stability.ai',
    hasUsageApi: true,
    usageMethod: 'api-key',
    trackingStatus: 'coming-soon'
  },

  // Leonardo - Manuel (dashboard only)
  {
    id: 'leonardo',
    brand: 'Leonardo',
    name: 'Leonardo AI',
    icon: 'Le',
    color: '#7c3aed',
    category: 'image',
    tier: 'pro',
    website: 'https://leonardo.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Ideogram - Manuel (dashboard only)
  {
    id: 'ideogram',
    brand: 'Ideogram',
    name: 'Ideogram Plus',
    icon: 'Id',
    color: '#ec4899',
    category: 'image',
    tier: 'pro',
    website: 'https://ideogram.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Adobe Firefly - Impossible (inclus dans CC, pas de tracking séparé)
  {
    id: 'firefly',
    brand: 'Adobe',
    name: 'Firefly (CC)',
    icon: 'Ff',
    color: '#ff0000',
    category: 'image',
    tier: 'pro',
    website: 'https://firefly.adobe.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Flux - Complexe (API via Replicate/Fal.ai, pas direct)
  {
    id: 'flux',
    brand: 'Black Forest',
    name: 'Flux Pro',
    icon: 'Fx',
    color: '#f59e0b',
    category: 'image',
    tier: 'api',
    website: 'https://blackforestlabs.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'roadmap'
  },

  // ========== VIDEO GENERATION ==========

  // Runway (Pro/Unlimited merged) - Faisable (API officielle)
  {
    id: 'runway',
    brand: 'Runway',
    name: 'Runway Pro/Unlimited',
    icon: 'Rw',
    color: '#00d4aa',
    category: 'video',
    tier: 'pro',
    website: 'https://runway.ml',
    hasUsageApi: true,
    usageMethod: 'api-key',
    trackingStatus: 'coming-soon'
  },

  // Pika - Manuel (dashboard only)
  {
    id: 'pika',
    brand: 'Pika',
    name: 'Pika Pro',
    icon: 'Pk',
    color: '#a855f7',
    category: 'video',
    tier: 'pro',
    website: 'https://pika.art',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Luma - Manuel (dashboard only)
  {
    id: 'luma',
    brand: 'Luma',
    name: 'Dream Machine',
    icon: 'Lu',
    color: '#3b82f6',
    category: 'video',
    tier: 'pro',
    website: 'https://lumalabs.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Kling - Impossible (Chinese platform, no international API)
  {
    id: 'kling',
    brand: 'Kuaishou',
    name: 'Kling Pro',
    icon: 'Kl',
    color: '#ef4444',
    category: 'video',
    tier: 'pro',
    website: 'https://klingai.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // Sora - Impossible (inclus dans ChatGPT Plus, pas de tracking séparé)
  {
    id: 'sora',
    brand: 'OpenAI',
    name: 'Sora',
    icon: 'So',
    color: '#10a37f',
    category: 'video',
    tier: 'pro',
    website: 'https://openai.com/sora',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // ========== AUDIO / MUSIC ==========

  // Suno (Pro/Premier merged) - Complexe (API non-officielle)
  {
    id: 'suno',
    brand: 'Suno',
    name: 'Suno Pro/Premier',
    icon: 'Su',
    color: '#f43f5e',
    category: 'audio',
    tier: 'pro',
    website: 'https://suno.ai',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'roadmap'
  },

  // Udio - Manuel (dashboard only)
  {
    id: 'udio',
    brand: 'Udio',
    name: 'Udio Pro',
    icon: 'Ud',
    color: '#06b6d4',
    category: 'audio',
    tier: 'pro',
    website: 'https://udio.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },

  // ElevenLabs (Creator/Pro merged) - Faisable (API officielle)
  {
    id: 'elevenlabs',
    brand: 'ElevenLabs',
    name: 'ElevenLabs',
    icon: '11',
    color: '#f97316',
    category: 'audio',
    tier: 'pro',
    website: 'https://elevenlabs.io',
    hasUsageApi: true,
    usageMethod: 'api-key',
    trackingStatus: 'coming-soon'
  },

  // Mubert - Impossible (no public API for usage)
  {
    id: 'mubert',
    brand: 'Mubert',
    name: 'Mubert Pro',
    icon: 'Mb',
    color: '#8b5cf6',
    category: 'audio',
    tier: 'pro',
    website: 'https://mubert.com',
    hasUsageApi: false,
    usageMethod: 'none',
    trackingStatus: 'partnership'
  },
]

// Category display info with SVG icon paths
export const CATEGORY_INFO: Record<ProviderCategory, { name: string; iconPath: string; color: string }> = {
  coding: {
    name: 'Coding & Development',
    iconPath: 'M16 18l6-6-6-6M8 6l-6 6 6 6', // code brackets
    color: '#22c55e'
  },
  chat: {
    name: 'Chat & Assistant',
    iconPath: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', // message bubble
    color: '#3b82f6'
  },
  image: {
    name: 'Image Generation',
    iconPath: 'M4 16l4.586-4.586a2 2 0 0 1 2.828 0L16 16m-2-2l1.586-1.586a2 2 0 0 1 2.828 0L20 14m-6-6h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z', // image
    color: '#ec4899'
  },
  video: {
    name: 'Video Generation',
    iconPath: 'M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z', // video
    color: '#a855f7'
  },
  audio: {
    name: 'Audio & Music',
    iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z', // music note
    color: '#f59e0b'
  },
  multimodal: {
    name: 'Multimodal',
    iconPath: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', // layers
    color: '#06b6d4'
  },
}

// Helper functions
export const getProviderById = (id: string): ProviderDefinition | undefined => {
  return AI_PROVIDERS.find(p => p.id === id)
}

export const getProvidersByCategory = (category: ProviderCategory): ProviderDefinition[] => {
  return AI_PROVIDERS.filter(p => p.category === category)
}

export const getAllCategories = (): ProviderCategory[] => {
  return [...new Set(AI_PROVIDERS.map(p => p.category))]
}

// Get the main/default provider for a parent ID (for backward compatibility)
export const getMainProvider = (parentId: string): ProviderDefinition | undefined => {
  return AI_PROVIDERS.find(p => p.parentId === parentId || p.id === parentId)
}

// Badge display info for tracking status
export const TRACKING_STATUS_INFO: Record<TrackingStatus, { label: string; color: string; bgColor: string }> = {
  'available': {
    label: 'Available',
    color: '#22c55e',      // green
    bgColor: 'rgba(34, 197, 94, 0.15)'
  },
  'coming-soon': {
    label: 'Coming soon!',
    color: '#f97316',      // orange
    bgColor: 'rgba(249, 115, 22, 0.15)'
  },
  'roadmap': {
    label: 'Planned',
    color: '#3b82f6',      // blue
    bgColor: 'rgba(59, 130, 246, 0.15)'
  },
  'partnership': {
    label: 'Awaiting partnership',
    color: '#8b5cf6',      // violet
    bgColor: 'rgba(139, 92, 246, 0.15)'
  }
}

// Get badge info for a provider
export const getTrackingStatusBadge = (status: TrackingStatus) => {
  return TRACKING_STATUS_INFO[status]
}
