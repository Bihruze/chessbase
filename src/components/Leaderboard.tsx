import type { ElementType } from 'react'
import type { LeaderboardEntry } from '../hooks/useLeaderboard'
import { shortenHex } from '../utils/strings'

type LeaderboardProps = {
  entries: LeaderboardEntry[]
  variant?: 'standalone' | 'embedded'
}

export function Leaderboard({ entries, variant = 'standalone' }: LeaderboardProps) {
  const Container: ElementType = variant === 'standalone' ? 'section' : 'div'
  const ariaLabel = 'Capture leaderboard'

  if (!entries.length) {
    return (
      <Container className={variant === 'standalone' ? 'ledger' : 'info-card__empty'} aria-label={ariaLabel}>
        {variant === 'standalone' ? <h3>Leaderboard</h3> : null}
        <p className="timeline__empty">No captures yet. Log the first one!</p>
      </Container>
    )
  }

  return (
    <Container className={variant === 'standalone' ? 'ledger' : 'leaderboard-embedded'} aria-label={ariaLabel}>
      {variant === 'standalone' ? <h3>Leaderboard</h3> : null}
      <ul>
        {entries.map((entry, index) => (
          <li key={entry.player}>
            <div className="ledger__details">
              <span className="ledger__move">#{index + 1} · {shortenHex(entry.player, 4)}</span>
              <span className="ledger__san">
                {entry.totalCaptures} captures
                <span className="ledger__square">
                  {entry.lastSan ? `Last: ${entry.lastSan} @${entry.lastSquare}` : 'First capture pending'}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Container>
  )
}
