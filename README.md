# chat-room

A Claude Code mod that keeps long chats manageable.

- **Usage button in every chat**: a band above the prompt shows how full the context window is and the session cost, with a `Usage` button that opens the Chat room pane (context bar, tokens, rate-limit windows, cost).
- **Summarize long chats**: once a chat passes 15 turns or 60% context, the band adds `Summarize`. The summary (goal, done so far, open items, key facts) appears in the pane.
- **More chat room**: `Free room` compacts the conversation, keeping goals, decisions, and exact names and numbers, so you can keep chatting. At 80% you get a nudge.

Commands: `/chat-usage`, `/summarize`, `/room`. Pane hotkeys: `r` refresh, `s` summarize, `f` free room.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install chat-room --marketplace banerjeetara-tech/chat-room
```

From a shell:

```
claude plugin install chat-room --marketplace banerjeetara-tech/chat-room
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `banerjeetara-tech/chat-room`, then Add plugin.
