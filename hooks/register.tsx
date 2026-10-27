import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Summary, Usage } from '../types'

const PANE = 'chat-room'
const TITLE = 'Chat room'
// A chat counts as "long" past either mark; the band then offers a summary.
const LONG_TURNS = 15
const LONG_PERCENT = 60
// Past this the context is nearly full, and the band nudges to free room.
const FULL_PERCENT = 80

const usage = atom({ plugin: 'chat-room', key: 'usage' } as const, null, {
  shape: 'usage-1',
})
const summary = atom({ plugin: 'chat-room', key: 'summary' } as const, null, {
  shape: 'summary-1',
})
const busy = atom({ plugin: 'chat-room', key: 'busy' } as const, null)
const isBandHidden = atom(
  { plugin: 'chat-room', key: 'isBandHidden' } as const,
  false,
)

const SUMMARY_PROMPT = [
  'Summarize our conversation so far for me, the user. Do not call any tools.',
  'Use these markdown sections, each short and concrete:',
  '## Goal — what I am trying to do.',
  '## Done so far — key steps, decisions and results.',
  '## Open items — unanswered questions, next steps.',
  '## Key facts — names, files, numbers, commands worth remembering.',
  'Keep it under 300 words.',
].join('\n')

const COMPACT_INSTRUCTIONS =
  'Keep the goal, decisions made, open items, and exact file paths, names and numbers.'

async function refreshUsage($: EngineInterface): Promise<Usage> {
  const u = await $.session.usage()
  const next: Usage = {
    percent: u.context.percent ?? null,
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    costUsd: u.cost?.usd ?? null,
    limits: u.rateLimits.map(l => ({
      kind: l.kind,
      percentUsed: l.percentUsed,
      resetsAt: l.resetsAt,
    })),
  }
  await update($, usage, () => next)

  return next
}

async function summarize($: EngineInterface): Promise<void> {
  if ((await read($, busy)) !== null) {
    return
  }
  await update($, busy, () => 'Summarizing…')
  try {
    const reply = await $.model.fork({ prompt: SUMMARY_PROMPT })
    if (reply.isAnswered) {
      const entry: Summary = {
        text: reply.text,
        at: await $.clock.now(),
        turns: await $.session.turns(),
      }
      await update($, summary, () => entry)
      $.ui.toast('Chat summary ready in the Chat room pane')
    } else {
      $.ui.toast(
        reply.reason === 'nothing-to-fork'
          ? 'Nothing to summarize yet'
          : `Summary failed: ${reply.reason}`,
      )
    }
  } finally {
    await update($, busy, () => null)
  }
}

async function freeRoom($: EngineInterface): Promise<void> {
  if ((await read($, busy)) !== null) {
    return
  }
  await update($, busy, () => 'Freeing up room…')
  try {
    const before = (await read($, usage))?.percent
    const result = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
    if ('skip' in result && result.skip !== undefined) {
      $.ui.toast(`Not compacted: ${result.skip}`)
      return
    }
    const after = (await refreshUsage($)).percent
    $.ui.toast(
      before != null && after != null
        ? `Room freed: context ${before}% → ${after}%`
        : 'Chat compacted: more room to keep going',
    )
  } catch {
    $.ui.toast('Wait for the current reply to finish, then try again')
  } finally {
    await update($, busy, () => null)
  }
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

const fmtTokens = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'chat-usage',
      description: 'Show context, rate-limit and cost usage for this chat',
    })
    await $.command.register({
      name: 'summarize',
      description: 'Summarize this chat into the Chat room pane',
    })
    await $.command.register({
      name: 'room',
      description: 'Compact this chat to free up context room',
    })
    await refreshUsage($)
    // Seat the pane beside the chat in every session.
    void openPane($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }
    const before = (await read($, usage))?.percent ?? 0
    const now = (await refreshUsage($)).percent ?? 0
    if (now >= FULL_PERCENT && before < FULL_PERCENT) {
      $.ui.toast(`Context ${now}% full: press "Free room" or run /room`)
    }

    return result
  })

  on('command.run', { command: 'chat-usage' }, async $ => {
    const u = await refreshUsage($)
    await openPane($)
    const parts = [
      u.percent != null ? `context ${u.percent}% used` : 'context: no reading yet',
      u.costUsd != null ? `cost $${u.costUsd.toFixed(2)}` : null,
      ...u.limits.map(l => `${l.kind} limit ${Math.round(l.percentUsed)}%`),
    ].filter(Boolean)

    return { text: `Usage: ${parts.join(', ')}.` }
  })

  on('command.run', { command: 'summarize' }, async $ => {
    await openPane($)
    void summarize($)

    return { text: 'Summarizing this chat into the Chat room pane…' }
  })

  on('command.run', { command: 'room' }, async $ => {
    await openPane($)
    // Compaction runs between turns, so start it once this command's turn ends.
    void $.clock.sleep(250).then(() => freeRoom($))

    return { text: 'Freeing up context room…' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const u = await read($, usage)
    const working = await read($, busy)
    const percent = u?.percent ?? null
    const turns = await $.session.turns()
    const isLong = turns >= LONG_TURNS || (percent ?? 0) >= LONG_PERCENT
    const isFull = (percent ?? 0) >= FULL_PERCENT

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={isFull ? 'warning' : undefined} dimColor={!isFull}>
          {percent != null ? `Context ${percent}%` : 'Context —'}
          {u?.costUsd != null ? ` · $${u.costUsd.toFixed(2)}` : ''}
          {working ? ` · ${working}` : ''}
        </Text>
        <Button key="usage" label="Usage" onPress={() => openPane($)} />
        {isLong && (
          <Button
            key="summarize"
            label="Summarize"
            onPress={() => {
              void openPane($)
              return summarize($)
            }}
          />
        )}
        {isLong && (
          <Button
            key="room"
            label="Free room"
            variant={isFull ? 'primary' : undefined}
            onPress={() => freeRoom($)}
          />
        )}
        <Button
          key="hide"
          label="×"
          plain
          onPress={() => update($, isBandHidden, () => true)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const u = await read($, usage)
    const s = await read($, summary)
    const working = await read($, busy)
    const width = Math.max(10, Math.min(40, (e.props.bodyColumns ?? 40) - 12))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Usage</Text>
          {u === null || u.percent === null ? (
            <Text dimColor>No reading yet: send a message first.</Text>
          ) : (
            <Text>
              {bar(u.percent, width)} {u.percent}%
            </Text>
          )}
          {u?.tokens != null && (
            <Text dimColor>
              {fmtTokens(u.tokens)} of {fmtTokens(u.window)} tokens in context
            </Text>
          )}
          {u?.costUsd != null && (
            <Text dimColor>Session cost: ${u.costUsd.toFixed(2)}</Text>
          )}
          {u?.limits.map(l => (
            <Text dimColor>
              {l.kind.replace(/_/g, ' ')} limit: {Math.round(l.percentUsed)}%
              {l.resetsAt ? ` (resets ${l.resetsAt})` : ''}
            </Text>
          ))}
        </Box>

        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refreshUsage($)} />
          <Button key="pane-summarize" label="Summarize chat" hotkey="s" onPress={() => summarize($)} />
          <Button
            key="pane-room"
            label="Free room"
            hotkey="f"
            variant={(u?.percent ?? 0) >= FULL_PERCENT ? 'primary' : undefined}
            onPress={() => freeRoom($)}
          />
          <Button
            key="show-band"
            label="Show band"
            onPress={() => update($, isBandHidden, () => false)}
          />
        </Box>
        {working && <Text color="warning">{working}</Text>}

        <Box flexDirection="column">
          <Text bold>Summary</Text>
          {s === null ? (
            <Text dimColor>
              No summary yet. Press "Summarize chat" (or run /summarize).
            </Text>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>As of turn {s.turns}</Text>
              <Markdown text={s.text} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
