import * as React from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useZetroqChat } from './ChatProvider';
import type { AttachmentPicker, ChatMessage } from './types';

export interface ChatScreenProps {
  /** Optional file picker; the chosen file is uploaded and sent as a link message. */
  pickAttachment?: AttachmentPicker;
  /** Optional own upload returning a public URL. Default: ZetroQ `POST /upload` (size / type limits apply). */
  uploadAttachment?: (file: { uri: string; name: string; mimeType: string }) => Promise<string>;
  placeholder?: string;
}

export function ChatScreen({ pickAttachment, uploadAttachment, placeholder = 'Type a message' }: ChatScreenProps): React.ReactElement {
  const { state, send, session } = useZetroqChat();
  const [text, setText] = React.useState('');
  const { theme } = state;

  if (state.error && !state.ready) {
    return React.createElement(
      View,
      { style: [styles.center, { backgroundColor: theme.backgroundColor }] },
      React.createElement(Text, { style: { color: theme.textColor } }, state.error),
      React.createElement(
        Pressable,
        { accessibilityRole: 'button', accessibilityLabel: 'Retry', onPress: () => void session.start(), style: [styles.chip, { borderColor: theme.primaryColor }] },
        React.createElement(Text, { style: { color: theme.primaryColor } }, 'Retry'),
      ),
    );
  }
  if (!state.ready) {
    return React.createElement(View, { style: styles.center }, React.createElement(ActivityIndicator, { color: theme.primaryColor }));
  }

  const submit = (value: string): void => {
    if (!value.trim()) return;
    setText('');
    void send(value);
  };

  const attach = async (): Promise<void> => {
    if (!pickAttachment) return;
    const file = await pickAttachment();
    if (!file) return;
    try {
      const url = uploadAttachment ? await uploadAttachment(file) : (await session.upload(file)).url;
      submit(`${file.name}: ${url}`);
    } catch {
      submit(`${file.name} (upload failed)`);
    }
  };

  const renderItem = ({ item }: { item: ChatMessage }): React.ReactElement => {
    const mine = item.role === 'user';
    return React.createElement(
      View,
      {
        style: [
          styles.bubble,
          mine ? styles.mine : styles.theirs,
          { backgroundColor: mine ? theme.bubbleUser : theme.bubbleBot },
        ],
        accessibilityLabel: `${mine ? 'You' : 'Agent'}: ${item.content}`,
      },
      React.createElement(Text, { style: { color: mine ? '#ffffff' : theme.textColor, fontFamily: theme.fontFamily } }, item.content),
      mine && item.status && item.status !== 'sent'
        ? React.createElement(Text, { style: styles.status }, item.status === 'queued' ? 'Waiting for network' : 'Sending')
        : null,
    );
  };

  return React.createElement(
    KeyboardAvoidingView,
    { behavior: Platform.OS === 'ios' ? 'padding' : undefined, style: [styles.root, { backgroundColor: theme.backgroundColor }] },
    React.createElement(FlatList, {
      data: [...state.messages].reverse(),
      inverted: true,
      keyExtractor: (m: ChatMessage) => m.id || m.clientMessageId || m.createdAt,
      renderItem: renderItem as (info: { item: never }) => React.ReactElement,
      contentContainerStyle: styles.list,
    }),
    state.quickReplies.length > 0
      ? React.createElement(
          View,
          { style: styles.chips },
          ...state.quickReplies.map((q) =>
            React.createElement(
              Pressable,
              { key: q, accessibilityRole: 'button', accessibilityLabel: q, onPress: () => submit(q), style: [styles.chip, { borderColor: theme.primaryColor }] },
              React.createElement(Text, { style: { color: theme.primaryColor } }, q),
            ),
          ),
        )
      : null,
    React.createElement(
      View,
      { style: styles.composer },
      pickAttachment
        ? React.createElement(
            Pressable,
            { accessibilityRole: 'button', accessibilityLabel: 'Attach a file', onPress: () => void attach(), style: styles.iconBtn },
            React.createElement(Text, { style: { color: theme.primaryColor, fontSize: 20 } }, '+'),
          )
        : null,
      React.createElement(TextInput, {
        value: text,
        onChangeText: setText,
        placeholder,
        placeholderTextColor: '#9ca3af',
        accessibilityLabel: 'Message',
        multiline: true,
        style: [styles.input, { color: theme.textColor, textAlign: theme.rtl ? 'right' : 'left' }],
      }),
      React.createElement(
        Pressable,
        { accessibilityRole: 'button', accessibilityLabel: 'Send', onPress: () => submit(text), style: [styles.send, { backgroundColor: theme.primaryColor }] },
        React.createElement(Text, { style: { color: '#ffffff', fontWeight: '600' } }, 'Send'),
      ),
    ),
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 12 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 4 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  status: { color: '#e5e7eb', fontSize: 11, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, margin: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 10 },
  send: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginLeft: 6 },
});
