import 'package:flutter/material.dart';
import 'package:zetroq_chat/zetroq_chat.dart';

// Bot -> Install in the ZetroQ panel. For push, add firebase_messaging, then:
//   chat.registerPushToken(await FirebaseMessaging.instance.getToken() ?? '');
//   FirebaseMessaging.onMessageOpenedApp.listen((m) {
//     final push = ZetroqPush.parse(m.data);
//     if (push != null) chat.open(push.conversationId);
//   });
final chat = ZetroqChat(botToken: 'YOUR_WIDGET_TOKEN', appDomain: 'app.example.com');

void main() => runApp(MaterialApp(home: Scaffold(body: SafeArea(child: ZetroqChatScreen(chat: chat)))));
