export const shortenHex = (value: string, segment = 4) =>
  value.length > segment * 2 + 2
    ? `${value.slice(0, segment + 2)}…${value.slice(-segment)}`
    : value
