import 'package:flutter/material.dart';

import 'chat.dart';
import 'client.dart';

/// Ready-made chat screen.
/// [onPickFile] picks a file (e.g. file_picker) that is uploaded to ZetroQ
/// (POST /upload) and sent as a link. [onAttach] (optional, older API) is your
/// own picker + upload returning the link to send.
class ZetroqChatScreen extends StatefulWidget {
  const ZetroqChatScreen({super.key, required this.chat, this.onPickFile, this.onAttach});

  final ZetroqChat chat;
  final Future<ZetroqFile?> Function()? onPickFile;
  final Future<String?> Function()? onAttach;

  @override
  State<ZetroqChatScreen> createState() => _ZetroqChatScreenState();
}

class _ZetroqChatScreenState extends State<ZetroqChatScreen> {
  final _text = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (!widget.chat.ready) widget.chat.start();
  }

  Color _color(String key, Color fallback) {
    final appearance = (widget.chat.settings['appearance'] as Map<String, dynamic>?) ?? widget.chat.settings;
    final v = appearance[key];
    if (v is String && v.startsWith('#') && v.length == 7) return Color(int.parse('FF${v.substring(1)}', radix: 16));
    return fallback;
  }

  void _submit(String value) {
    _text.clear();
    widget.chat.send(value);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.chat,
      builder: (context, _) {
        final chat = widget.chat;
        final primary = _color('primaryColor', Theme.of(context).colorScheme.primary);
        if (chat.error != null && !chat.ready) {
          return Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(chat.error!),
              TextButton(onPressed: chat.start, child: const Text('Retry')),
            ]),
          );
        }
        if (!chat.ready) return const Center(child: CircularProgressIndicator());
        final items = chat.messages.reversed.toList();
        return Column(children: [
          Expanded(
            child: ListView.builder(
              reverse: true,
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              itemBuilder: (context, i) {
                final m = items[i];
                return Align(
                  alignment: m.mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
                  child: Container(
                    constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: m.mine ? primary : Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(m.content, style: TextStyle(color: m.mine ? Colors.white : null)),
                      if (m.mine && m.status != 'sent')
                        Text(m.status == 'queued' ? 'Waiting for network' : 'Sending',
                            style: const TextStyle(fontSize: 11, color: Colors.white70)),
                    ]),
                  ),
                );
              },
            ),
          ),
          if (chat.quickReplies.isNotEmpty)
            Wrap(spacing: 6, children: [
              for (final q in chat.quickReplies) ActionChip(label: Text(q), onPressed: () => _submit(q)),
            ]),
          SafeArea(
            top: false,
            child: Row(children: [
              if (widget.onPickFile != null || widget.onAttach != null)
                IconButton(
                  tooltip: 'Attach a file',
                  icon: const Icon(Icons.attach_file),
                  onPressed: () async {
                    if (widget.onAttach != null) {
                      final link = await widget.onAttach!();
                      if (link != null) _submit(link);
                      return;
                    }
                    final file = await widget.onPickFile!();
                    if (file == null) return;
                    try {
                      await widget.chat.sendAttachment(file);
                    } catch (_) {
                      if (context.mounted) {
                        ScaffoldMessenger.maybeOf(context)
                            ?.showSnackBar(const SnackBar(content: Text('Could not upload that file')));
                      }
                    }
                  },
                ),
              Expanded(
                child: TextField(
                  controller: _text,
                  minLines: 1,
                  maxLines: 4,
                  decoration: const InputDecoration(hintText: 'Type a message', border: InputBorder.none),
                  onSubmitted: _submit,
                ),
              ),
              IconButton(tooltip: 'Send', icon: Icon(Icons.send, color: primary), onPressed: () => _submit(_text.text)),
            ]),
          ),
        ]);
      },
    );
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }
}
