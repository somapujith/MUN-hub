import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { consoleNotificationsAdapter } from './console-adapter'

const ORIGINAL_OUTBOX = process.env.EMAIL_OUTBOX_FILE
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

let tmpDir: string | undefined

afterEach(async () => {
  if (ORIGINAL_OUTBOX === undefined) delete process.env.EMAIL_OUTBOX_FILE
  else process.env.EMAIL_OUTBOX_FILE = ORIGINAL_OUTBOX
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('consoleNotificationsAdapter', () => {
  it('does not throw or write anywhere when EMAIL_OUTBOX_FILE is unset', async () => {
    delete process.env.EMAIL_OUTBOX_FILE
    await expect(
      consoleNotificationsAdapter.send({ to: 'a@test.dev', subject: 'x', body: 'y' }),
    ).resolves.toBeUndefined()
  })

  it('appends a JSON line per message to EMAIL_OUTBOX_FILE when set', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'mun-hub-outbox-'))
    const outboxFile = path.join(tmpDir, 'outbox.jsonl')
    process.env.EMAIL_OUTBOX_FILE = outboxFile

    await consoleNotificationsAdapter.send({ to: 'a@test.dev', subject: 'First', body: 'body one' })
    await consoleNotificationsAdapter.send({ to: 'b@test.dev', subject: 'Second', body: 'body two', html: '<p>two</p>' })

    const lines = (await readFile(outboxFile, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0])
    expect(first).toMatchObject({ to: 'a@test.dev', subject: 'First', text: 'body one', html: null })
    expect(typeof first.sentAt).toBe('string')

    const second = JSON.parse(lines[1])
    expect(second).toMatchObject({ to: 'b@test.dev', subject: 'Second', text: 'body two', html: '<p>two</p>' })
  })

  it('never writes to the outbox in production, even when EMAIL_OUTBOX_FILE is set', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'mun-hub-outbox-'))
    const outboxFile = path.join(tmpDir, 'outbox.jsonl')
    process.env.EMAIL_OUTBOX_FILE = outboxFile
    process.env.NODE_ENV = 'production'

    await consoleNotificationsAdapter.send({ to: 'a@test.dev', subject: 'x', body: 'y' })

    await expect(readFile(outboxFile, 'utf8')).rejects.toThrow()
  })
})
