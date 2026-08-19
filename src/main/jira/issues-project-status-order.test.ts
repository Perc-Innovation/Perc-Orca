import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraClientForSite } from './authenticated-request'

const {
  clearTokenMock,
  getClientsMock,
  isAuthErrorMock,
  jiraRequestMock,
  jiraRequestBinaryMock,
  acquireMock,
  releaseMock
} = vi.hoisted(() => ({
  clearTokenMock: vi.fn(),
  getClientsMock: vi.fn(),
  isAuthErrorMock: vi.fn(),
  jiraRequestMock: vi.fn(),
  jiraRequestBinaryMock: vi.fn(),
  acquireMock: vi.fn().mockResolvedValue(undefined),
  releaseMock: vi.fn()
}))

vi.mock('./request-queue', () => ({ acquire: acquireMock, release: releaseMock }))

vi.mock('./authenticated-request', () => ({
  apiBasePath: (site: { authType?: string }) =>
    site.authType === 'server' ? '/rest/api/2' : '/rest/api/3',
  jiraRequest: (...args: unknown[]) => jiraRequestMock(...args),
  jiraRequestBinary: (...args: unknown[]) => jiraRequestBinaryMock(...args),
  JiraApiError: class JiraApiError extends Error {
    status: number | null
    constructor(message: string, status: number | null = null) {
      super(message)
      this.status = status
    }
  }
}))

vi.mock('./client', () => ({
  clearToken: (...args: unknown[]) => clearTokenMock(...args),
  getClients: (...args: unknown[]) => getClientsMock(...args),
  isAuthError: (...args: unknown[]) => isAuthErrorMock(...args)
}))

function makeEntry(id = 'site-1'): JiraClientForSite {
  return {
    site: {
      id,
      siteUrl: 'https://example.atlassian.net',
      email: 'ada@example.com',
      displayName: 'Example Jira',
      accountId: 'account-1'
    },
    authorization: 'Basic token'
  }
}

describe('Jira issue operations', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    isAuthErrorMock.mockReturnValue(false)
    getClientsMock.mockReturnValue([makeEntry()])
    acquireMock.mockResolvedValue(undefined)
    releaseMock.mockImplementation(() => {})
    jiraRequestBinaryMock.mockReset()
    jiraRequestMock.mockReset()
    const { _resetAttachmentImageCache } = await import('./attachment-image-cache')
    _resetAttachmentImageCache()
  })

  describe('getProjectStatusOrder', () => {
    it('returns an empty order when no clients are available', async () => {
      getClientsMock.mockReturnValue([])
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).resolves.toEqual({
        statusIdsByColumn: []
      })
    })

    it('returns an empty order when an omitted site resolves to multiple clients', async () => {
      getClientsMock.mockReturnValue([makeEntry('site-1'), makeEntry('site-2')])
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP')).resolves.toEqual({ statusIdsByColumn: [] })
      expect(jiraRequestMock).not.toHaveBeenCalled()
    })

    it('returns an empty order when the project has no accessible board', async () => {
      jiraRequestMock.mockResolvedValueOnce({ values: [] })
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP & OPS', 'site-1')).resolves.toEqual({
        statusIdsByColumn: []
      })
      expect(String(jiraRequestMock.mock.calls[0][1])).toContain(
        '/rest/agile/1.0/board?projectKeyOrId=ALP+%26+OPS&maxResults=2'
      )
    })

    it('keeps alphabetical fallback when a project has multiple boards', async () => {
      jiraRequestMock.mockResolvedValueOnce({
        total: 2,
        values: [{ id: 42 }, { id: 43 }]
      })
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).resolves.toEqual({
        statusIdsByColumn: []
      })
      expect(jiraRequestMock).toHaveBeenCalledTimes(1)
    })

    it('keeps alphabetical fallback when Jira reports another board page', async () => {
      jiraRequestMock.mockResolvedValueOnce({
        isLast: false,
        values: [{ id: 42 }]
      })
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).resolves.toEqual({
        statusIdsByColumn: []
      })
      expect(jiraRequestMock).toHaveBeenCalledTimes(1)
    })

    it('returns status IDs grouped by Jira board column order', async () => {
      jiraRequestMock
        .mockResolvedValueOnce({ total: 1, values: [{ id: 42 }] })
        .mockResolvedValueOnce({
          columnConfig: {
            columns: [
              { statuses: [{ id: '1' }, { id: '2' }] },
              { statuses: [{ id: '3' }, { id: '2' }] },
              { statuses: [] }
            ]
          }
        })
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).resolves.toEqual({
        statusIdsByColumn: [['1', '2'], ['3']]
      })
      expect(jiraRequestMock.mock.calls[1]?.[1]).toBe('/rest/agile/1.0/board/42/configuration')
    })

    it('includes named board columns so empty lanes can render', async () => {
      jiraRequestMock
        .mockResolvedValueOnce({ total: 1, values: [{ id: 42 }] })
        .mockResolvedValueOnce({
          columnConfig: {
            columns: [
              { name: 'To Do', statuses: [{ id: '1' }] },
              { name: 'Done', statuses: [{ id: '3' }] },
              { name: 'Ghost', statuses: [] }
            ]
          }
        })
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).resolves.toEqual({
        statusIdsByColumn: [['1'], ['3']],
        columns: [
          { name: 'To Do', statusIds: ['1'] },
          { name: 'Done', statusIds: ['3'] }
        ]
      })
    })

    it('clears the token and surfaces credential failures', async () => {
      const authError = new Error('Unauthorized')
      isAuthErrorMock.mockReturnValue(true)
      jiraRequestMock.mockRejectedValueOnce(authError)
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).rejects.toThrow('Unauthorized')
      expect(clearTokenMock).toHaveBeenCalledWith('site-1')
    })

    it('falls back to an empty order on operational errors', async () => {
      jiraRequestMock.mockRejectedValueOnce(new Error('Service Unavailable'))
      const { getProjectStatusOrder } = await import('./issues')

      await expect(getProjectStatusOrder('ALP', 'site-1')).resolves.toEqual({
        statusIdsByColumn: []
      })
    })
  })
})
