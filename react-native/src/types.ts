export type Platform = 'ios' | 'android' | 'web';

export interface ChatMessage {
  id: string;
  clientMessageId?: string;
  role: 'user' | 'assistant' | 'bot' | 'agent' | 'system';
  content: string;
  createdAt: string;
  status?: 'queued' | 'sending' | 'sent' | 'failed';
  quickReplies?: string[];
  attachment?: { url: string; name: string; mimeType?: string };
}

export interface ChatTheme {
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  bubbleUser: string;
  bubbleBot: string;
  fontFamily?: string;
  rtl?: boolean;
}

export interface ZetroqConfig {
  /** The bot's widget token (Bot -> Install in the ZetroQ panel). */
  botToken: string;
  /** API base, default https://api.zetroq.com/api/v1 */
  apiBase?: string;
  /** Sent as X-Embed-Domain so a bot domain allowlist can admit the app. */
  appDomain?: string;
  /** Persistent storage (AsyncStorage works). Memory only when omitted. */
  storage?: KeyValueStorage;
  fetchImpl?: typeof fetch;
  /** Optional own upload (return a public URL). Default: ZetroQ `POST /upload`. */
  uploadAttachment?: (file: PickedFile) => Promise<string>;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

/** Plug any picker (expo-document-picker, react-native-image-picker ...). */
export type AttachmentPicker = () => Promise<PickedFile | null>;
