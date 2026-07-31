import { describe, expect, it } from 'vitest'
import { getOptionalJiraIssueLinkFlag } from './worktree-jira-issue-link'

function flags(entries: Record<string, string | boolean>): Map<string, string | boolean> {
  return new Map(Object.entries(entries))
}

describe('getOptionalJiraIssueLinkFlag', () => {
  it('is undefined when the flag is absent, so set leaves the link alone', () => {
    expect(getOptionalJiraIssueLinkFlag(flags({}), 'jira')).toBeUndefined()
  })

  it('accepts a bare issue key and leaves the site to the active one', () => {
    expect(getOptionalJiraIssueLinkFlag(flags({ jira: 'PROJ-123' }), 'jira')).toEqual({
      clear: false,
      issueKey: 'PROJ-123',
      origin: null
    })
  })

  it('uppercases the key so proj-123 and PROJ-123 link the same issue', () => {
    expect(getOptionalJiraIssueLinkFlag(flags({ jira: 'proj-123' }), 'jira')).toMatchObject({
      issueKey: 'PROJ-123'
    })
  })

  it('pins the site when the value is a URL', () => {
    expect(
      getOptionalJiraIssueLinkFlag(
        flags({ jira: 'https://acme.atlassian.net/browse/PROJ-9' }),
        'jira'
      )
    ).toEqual({
      clear: false,
      issueKey: 'PROJ-9',
      origin: 'https://acme.atlassian.net'
    })
  })

  it('clears the link with null when the caller allows it', () => {
    expect(
      getOptionalJiraIssueLinkFlag(flags({ jira: 'null' }), 'jira', { allowNull: true })
    ).toEqual({
      clear: true
    })
  })

  it('rejects null where clearing makes no sense, like on create', () => {
    expect(() => getOptionalJiraIssueLinkFlag(flags({ jira: 'null' }), 'jira')).toThrow(
      /Omit --jira on create/
    )
  })

  it('rejects values that are neither a key nor an issue URL', () => {
    // Why: a bare project name or a Jira URL that is not an issue would
    // otherwise be stored as a key and render a dead link on the card.
    for (const bad of ['PROJ', 'not a key', 'https://acme.atlassian.net/projects/PROJ']) {
      expect(() => getOptionalJiraIssueLinkFlag(flags({ jira: bad }), 'jira')).toThrow(
        /Pass a Jira issue key/
      )
    }
  })

  it('rejects a flag passed without a value', () => {
    expect(() => getOptionalJiraIssueLinkFlag(flags({ jira: true }), 'jira')).toThrow(
      /Missing value for --jira/
    )
  })
})
