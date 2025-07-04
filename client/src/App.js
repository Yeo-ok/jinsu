import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './App.css'; // CSS 파일을 import

const SERVER_URL = 'http://localhost:3001'; // 서버 주소

function App() {
  const [socket, setSocket] = useState(null);
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [currentRoomId, setCurrentRoomId] = useState('');
  const [players, setPlayers] = useState([]);
  const [hostId, setHostId] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4); // 기본 4명
  const [gameState, setGameState] = useState(null);
  const [bidAmount, setBidAmount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('roomCreated', (data) => {
      setCurrentRoomId(data.roomId);
      setPlayers(data.players);
      setHostId(data.host);
      setMaxPlayers(data.maxPlayers); // maxPlayers 추가
      setError('');
    });

    newSocket.on('joinedRoom', (data) => {
      setCurrentRoomId(data.roomId);
      setPlayers(data.players);
      setHostId(data.host);
      setMaxPlayers(data.maxPlayers); // maxPlayers 추가
      setError('');
    });

    newSocket.on('roomUpdate', (data) => {
      setPlayers(data.players);
      setHostId(data.host);
      setGameState(data.gameState);
      setMaxPlayers(data.maxPlayers); // maxPlayers 추가
    });

    newSocket.on('playerUpdate', (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    newSocket.on('hostUpdate', (newHostId) => {
      setHostId(newHostId);
    });

    newSocket.on('gameStarted', () => {
      console.log('Game has started!');
      setError('');
    });

    newSocket.on('gameStateUpdate', (state) => {
      setGameState(state);
      setError('');
    });

    newSocket.on('gameEnd', (finalState) => {
      setGameState(finalState);
      console.log('Game has ended!', finalState);
      setError('');
    });

    newSocket.on('error', (data) => {
      setError(data.message);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setCurrentRoomId('');
      setPlayers([]);
      setHostId('');
      setGameState(null);
      setError('서버와 연결이 끊어졌습니다.');
    });

    return () => newSocket.disconnect();
  }, []);

  const handleCreateRoom = () => {
    if (socket && username) {
      socket.emit('createRoom', { username, maxPlayers });
    } else {
      setError('사용자 이름과 최대 플레이어 수를 입력해주세요.');
    }
  };

  const handleJoinRoom = () => {
    if (socket && username && roomId) {
      socket.emit('joinRoom', { roomId, username });
    } else {
      setError('사용자 이름과 방 코드를 입력해주세요.');
    }
  };

  const handleStartGame = () => {
    if (socket && currentRoomId && socket.id === hostId) {
      socket.emit('startGame', currentRoomId);
    } else {
      setError('게임은 방장만 시작할 수 있습니다.');
    }
  };

  const handlePlaceBid = () => {
    if (socket && currentRoomId && bidAmount > 0) {
      socket.emit('placeBid', { roomId: currentRoomId, bid: parseInt(bidAmount, 10) });
      setBidAmount(0); // 입찰 후 초기화
    } else {
      setError('유효한 입찰 금액을 입력해주세요.');
    }
  };

  const isHost = socket && socket.id === hostId;
  const myPlayerData = gameState?.playerData[socket?.id];

  return (
    <div className="App">
      <header className="App-header">
        <h1>더 지니어스: 마이너스 경매</h1>
      </header>

      {error && <div className="error-message">{error}</div>}

      {!currentRoomId ? (
        <div className="lobby">
          <h2>게임 시작</h2>
          <input
            type="text"
            placeholder="사용자 이름"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <div className="room-creation">
            <input
              type="number"
              placeholder="최대 플레이어 수 (2-8)"
              min="2"
              max="8"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
            />
            <button onClick={handleCreateRoom}>방 만들기</button>
          </div>
          <div className="room-join">
            <input
              type="text"
              placeholder="방 코드"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            />
            <button onClick={handleJoinRoom}>방 참가</button>
          </div>
        </div>
      ) : (
        <div className="game-room">
          <h2>방 코드: {currentRoomId}</h2>
          <h3>플레이어 ({players.length}/{maxPlayers})</h3>
          <ul className="player-list">
            {players.map((p) => (
              <li key={p.id}>
                {p.username} {p.id === hostId && '(방장)'} {p.id === socket.id && '(나)'}
              </li>
            ))}
          </ul>

          {gameState && gameState.isGameOver ? (
            <div className="game-over">
              <h3>게임 종료!</h3>
              <h4>최종 점수:</h4>
              <ul className="score-list">
                {gameState.finalScores.map((score) => (
                  <li key={score.id}>
                    {score.username}: 점수 {score.score} (가넷 {score.garnets}, 카드: {score.numbers.join(', ')})
                  </li>
                ))}
              </ul>
              <p>가장 낮은 점수를 가진 플레이어가 승리합니다!</p>
            </div>
          ) : (
            <>
              {isHost && !gameState && players.length >= 2 && (
                <button onClick={handleStartGame} className="start-game-button">게임 시작</button>
              )}

              {gameState && (
                <div className="game-board">
                  <h3>현재 라운드: {gameState.round}</h3>
                  {gameState.currentAuction.number !== null && (
                    <div className="current-auction">
                      <h4>경매 중인 숫자: <span className="auction-number">{gameState.currentAuction.number}</span></h4>
                      <p>내 가넷: {myPlayerData?.garnets}</p>
                      <div className="bid-section">
                        <input
                          type="number"
                          placeholder="입찰 금액"
                          min="1"
                          value={bidAmount}
                          onChange={(e) => setBidAmount(e.target.value)}
                          disabled={gameState.currentAuction.bids[socket.id]} // 이미 입찰했으면 비활성화
                        />
                        <button onClick={handlePlaceBid} disabled={gameState.currentAuction.bids[socket.id]}>
                          입찰하기
                        </button>
                      </div>
                      <p>입찰 현황: {Object.keys(gameState.currentAuction.bids).length} / {players.length} 명 입찰</p>
                    </div>
                  )}

                  <div className="game-log">
                    <h4>게임 로그</h4>
                    <ul>
                      {gameState.log.map((log, index) => (
                        <li key={index}>{log}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="player-status">
                    <h4>플레이어 현황</h4>
                    <ul>
                      {Object.entries(gameState.playerData).map(([id, data]) => (
                        <li key={id}>
                          {data.username}: 가넷 {data.garnets}, 카드 [{data.numbers.join(', ')}]
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;