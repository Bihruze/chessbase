// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ChessBaseCaptures {
    struct PlayerStats {
        uint32 totalCaptures;
        uint32 lastMoveNumber;
        uint64 lastCaptureAt;
        string lastSan;
        string lastSquare;
    }

    struct LeaderboardEntry {
        address player;
        PlayerStats stats;
    }

    mapping(address => PlayerStats) private _stats;
    mapping(address => bool) private _isPlayer;
    address[] private _players;

    event CaptureLogged(
        address indexed player,
        uint32 moveNumber,
        string san,
        string square,
        uint64 timestamp
    );

    function logCapture(uint32 moveNumber, string calldata san, string calldata square) external {
        PlayerStats storage player = _stats[msg.sender];
        if (!_isPlayer[msg.sender]) {
            _isPlayer[msg.sender] = true;
            _players.push(msg.sender);
        }

        unchecked {
            player.totalCaptures += 1;
        }

        player.lastMoveNumber = moveNumber;
        player.lastSan = san;
        player.lastSquare = square;
        player.lastCaptureAt = uint64(block.timestamp);

        emit CaptureLogged(msg.sender, moveNumber, san, square, player.lastCaptureAt);
    }

    function getPlayer(address account) external view returns (PlayerStats memory) {
        return _stats[account];
    }

    function getLeaderboard(uint256 limit) external view returns (LeaderboardEntry[] memory entries) {
        if (limit == 0) {
            limit = 10;
        }
        if (limit > _players.length) {
            limit = _players.length;
        }

        entries = new LeaderboardEntry[](limit);
        address[] memory snapshot = _players;

        for (uint256 i = 0; i < limit; i++) {
            uint256 bestIndex = i;
            for (uint256 j = i + 1; j < snapshot.length; j++) {
                if (_stats[snapshot[j]].totalCaptures > _stats[snapshot[bestIndex]].totalCaptures) {
                    bestIndex = j;
                }
            }
            (snapshot[i], snapshot[bestIndex]) = (snapshot[bestIndex], snapshot[i]);
            entries[i] = LeaderboardEntry({
                player: snapshot[i],
                stats: _stats[snapshot[i]]
            });
        }
    }
}
