import { describe, expect, it } from 'vitest'
import { hostedReviewInfoFromGitHubPRInfo } from './hosted-review-github'
import type { PRInfo } from './github/pull-request-types'

const pr: PRInfo = {
  number: 12,
  title: 'Add queue badges',
  state: 'open',
  url: 'https://github.com/acme/orca/pull/12',
  checksStatus: 'pending',
  updatedAt: '2026-05-12T00:00:00.000Z',
  mergeable: 'MERGEABLE',
  headSha: 'abc123'
}

describe('hostedReviewInfoFromGitHubPRInfo', () => {
  it('maps PRInfo into sidebar hosted review metadata', () => {
    const githubRepository = { owner: 'upstream', repo: 'orca' }
    const review = hostedReviewInfoFromGitHubPRInfo({ ...pr, prRepo: githubRepository })

    expect(review).toMatchObject({
      provider: 'github',
      number: 12,
      title: 'Add queue badges',
      state: 'open',
      status: 'pending',
      mergeable: 'MERGEABLE',
      headSha: 'abc123',
      githubRepository
    })
  })

  it('conserva los hermanos y el destino al cruzar PRInfo → HostedReviewInfo', () => {
    // Why: este mapper es el único puente al renderer. Copiaba campo por campo
    // y se comía `siblings` y `baseRefName`, así que el lookup los traía y la
    // tarjeta nunca los veía. El test de arriba usa toMatchObject, que por
    // definición no detecta un campo que falta — por eso hace falta este.
    const review = hostedReviewInfoFromGitHubPRInfo({
      ...pr,
      baseRefName: 'stage',
      siblings: [
        {
          number: 251,
          url: 'https://github.com/acme/orca/pull/251',
          baseRef: 'RELEASE/v1.14.0',
          state: 'open'
        }
      ]
    })

    expect(review.baseRefName).toBe('stage')
    expect(review.siblings).toEqual([
      {
        number: 251,
        url: 'https://github.com/acme/orca/pull/251',
        baseRef: 'RELEASE/v1.14.0',
        state: 'open'
      }
    ])
    // Sin hermanos la clave no se agrega: una review sola no es una lista de una.
    expect(hostedReviewInfoFromGitHubPRInfo(pr).siblings).toBeUndefined()
  })
})
