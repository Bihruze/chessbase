export const chessBaseCapturesAbi = [
  {
    "inputs": [
      { "internalType": "uint32", "name": "moveNumber", "type": "uint32" },
      { "internalType": "string", "name": "san", "type": "string" },
      { "internalType": "string", "name": "square", "type": "string" }
    ],
    "name": "logCapture",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "account", "type": "address" }
    ],
    "name": "getPlayer",
    "outputs": [
      {
        "components": [
          { "internalType": "uint32", "name": "totalCaptures", "type": "uint32" },
          { "internalType": "uint32", "name": "lastMoveNumber", "type": "uint32" },
          { "internalType": "uint64", "name": "lastCaptureAt", "type": "uint64" },
          { "internalType": "string", "name": "lastSan", "type": "string" },
          { "internalType": "string", "name": "lastSquare", "type": "string" }
        ],
        "internalType": "struct ChessBaseCaptures.PlayerStats",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "limit", "type": "uint256" }
    ],
    "name": "getLeaderboard",
    "outputs": [
      {
        "components": [
          { "internalType": "address", "name": "player", "type": "address" },
          {
            "components": [
              { "internalType": "uint32", "name": "totalCaptures", "type": "uint32" },
              { "internalType": "uint32", "name": "lastMoveNumber", "type": "uint32" },
              { "internalType": "uint64", "name": "lastCaptureAt", "type": "uint64" },
              { "internalType": "string", "name": "lastSan", "type": "string" },
              { "internalType": "string", "name": "lastSquare", "type": "string" }
            ],
            "internalType": "struct ChessBaseCaptures.PlayerStats",
            "name": "stats",
            "type": "tuple"
          }
        ],
        "internalType": "struct ChessBaseCaptures.LeaderboardEntry[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "player", "type": "address" },
      { "indexed": false, "internalType": "uint32", "name": "moveNumber", "type": "uint32" },
      { "indexed": false, "internalType": "string", "name": "san", "type": "string" },
      { "indexed": false, "internalType": "string", "name": "square", "type": "string" },
      { "indexed": false, "internalType": "uint64", "name": "timestamp", "type": "uint64" }
    ],
    "name": "CaptureLogged",
    "type": "event"
  }
] as const
